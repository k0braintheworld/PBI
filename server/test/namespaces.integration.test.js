// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
// Verificación del soporte de namespaces de PBS contra un PBS FALSO (servidor
// HTTPS que emula los endpoints y registra las peticiones). Comprueba que
// pbsService consulta cada namespace pasando `ns`, agrega los snapshots y
// etiqueta cada uno con su namespace, y que los borrados van al namespace correcto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listNamespaces, listSnapshots, getBackupGroups, deleteSnapshotItem, deleteBackupGroup, getDashboard,
} from '../src/pbsService.js';

let hasOpenssl = true;
function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbi-testcert-'));
  const key = path.join(dir, 'k.pem');
  const crt = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', crt, '-days', '3650', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// Datos de muestra: un snapshot/grupo distinto por namespace (raíz + dos más).
const SNAPS = {
  '': [{ 'backup-type': 'vm', 'backup-id': '100', 'backup-time': 1000, size: 10 }],
  clienteA: [{ 'backup-type': 'vm', 'backup-id': '200', 'backup-time': 2000, size: 20 }],
  clienteB: [{ 'backup-type': 'ct', 'backup-id': '300', 'backup-time': 3000, size: 30 }],
};
const GROUPS = {
  '': [{ 'backup-type': 'vm', 'backup-id': '100', 'backup-count': 1, 'last-backup': 1000 }],
  clienteA: [{ 'backup-type': 'vm', 'backup-id': '200', 'backup-count': 1, 'last-backup': 2000 }],
  clienteB: [{ 'backup-type': 'ct', 'backup-id': '300', 'backup-count': 1, 'last-backup': 3000 }],
};

let server; let auth; let requests = [];
let nsMode = 'full'; // 'full' = con namespaces; 'none' = el endpoint /namespace falla

function fakePbs(key, cert) {
  return https.createServer({ key, cert }, (req, res) => {
    requests.push({ method: req.method, url: req.url });
    const u = new URL(req.url, 'https://x');
    const ns = u.searchParams.get('ns') || '';
    const p = u.pathname;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Connection', 'close'); // evita keepAlive colgando el test
    const send = (data, status = 200) => { res.statusCode = status; res.end(JSON.stringify({ data })); };

    if (p.endsWith('/namespace')) {
      if (nsMode === 'none') return send({ message: 'not found' }, 404);
      return send([{ ns: 'clienteA' }, { ns: 'clienteB' }]); // sin raíz: pbsService debe añadirlo
    }
    if (p.endsWith('/snapshots') && req.method === 'GET') return send(SNAPS[ns] || []);
    if (p.endsWith('/groups') && req.method === 'GET') return send(GROUPS[ns] || []);
    if (p.endsWith('/status')) return send({ total: 1000, used: 100, avail: 900 });
    if (p.endsWith('/gc')) return send({ 'index-data-bytes': 0, 'disk-bytes': 0 });
    if (p.endsWith('/tasks')) return send([]);
    if (p.endsWith('/admin/datastore')) return send([{ store: 'store1' }]);
    if (req.method === 'DELETE') return send(null); // borrado ok
    return send(null);
  });
}

before(async () => {
  let key; let cert;
  try { ({ key, cert } = makeCert()); } catch { hasOpenssl = false; return; }
  server = fakePbs(key, cert);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  auth = { mode: 'token', tokenId: 't@pbs!id', secret: 's', host: `https://127.0.0.1:${port}`, verifyTls: false, node: 'localhost' };
});

after(async () => {
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
});

const skipIfNoSsl = (t) => { if (!hasOpenssl) { t.skip('openssl no disponible'); return true; } return false; };

test('listNamespaces incluye SIEMPRE el raíz y deduplica', async (t) => {
  if (skipIfNoSsl(t)) return;
  nsMode = 'full';
  const nss = await listNamespaces(auth, 'store1');
  assert.deepEqual([...nss].sort(), ['', 'clienteA', 'clienteB']);
});

test('listSnapshots agrega TODOS los namespaces y etiqueta cada snapshot con su ns', async (t) => {
  if (skipIfNoSsl(t)) return;
  nsMode = 'full'; requests = [];
  const snaps = await listSnapshots(auth, 'store1');
  // 3 snapshots: uno por namespace
  assert.equal(snaps.length, 3);
  const byId = Object.fromEntries(snaps.map((s) => [s['backup-id'], s.ns]));
  assert.equal(byId['100'], '');         // raíz
  assert.equal(byId['200'], 'clienteA'); // etiquetado con su namespace
  assert.equal(byId['300'], 'clienteB');
  // y se pidió snapshots pasando ns para los no-raíz
  const snapReqs = requests.filter((r) => r.url.includes('/snapshots'));
  assert.ok(snapReqs.some((r) => r.url.includes('ns=clienteA')));
  assert.ok(snapReqs.some((r) => r.url.includes('ns=clienteB')));
});

test('getBackupGroups etiqueta los grupos con su namespace', async (t) => {
  if (skipIfNoSsl(t)) return;
  nsMode = 'full';
  const groups = await getBackupGroups(auth);
  assert.equal(groups.length, 3);
  const g200 = groups.find((g) => g.id === '200');
  assert.equal(g200.ns, 'clienteA');
  assert.equal(g200.store, 'store1');
});

test('deleteSnapshotItem y deleteBackupGroup dirigen el borrado al namespace correcto', async (t) => {
  if (skipIfNoSsl(t)) return;
  requests = [];
  await deleteSnapshotItem(auth, 'store1', 'vm', '200', 2000, 'clienteA');
  await deleteBackupGroup(auth, 'store1', 'vm', '200', 'clienteA');
  const dels = requests.filter((r) => r.method === 'DELETE');
  assert.ok(dels.every((r) => r.url.includes('ns=clienteA')), `los DELETE deben llevar ns=clienteA: ${JSON.stringify(dels)}`);
  // un borrado en el raíz NO debe añadir ns
  requests = [];
  await deleteSnapshotItem(auth, 'store1', 'vm', '100', 1000, '');
  assert.ok(!requests.some((r) => r.url.includes('ns=')), 'el borrado en raíz no debe llevar ns');
});

test('getDashboard: sin filtro ve todos los namespaces; con filtro solo ese', async (t) => {
  if (skipIfNoSsl(t)) return;
  nsMode = 'full';
  const all = await getDashboard(auth, null);
  assert.deepEqual([...all.namespaces].sort(), ['', 'clienteA', 'clienteB']);
  assert.deepEqual(all.lastBackups.map((b) => b.id).sort(), ['100', '200', '300']);
  const only = await getDashboard(auth, 'clienteA');
  assert.equal(only.selectedNs, 'clienteA');
  assert.deepEqual(only.lastBackups.map((b) => b.id), ['200']); // solo la copia de ese namespace
  assert.deepEqual([...only.namespaces].sort(), ['', 'clienteA', 'clienteB']); // el selector sigue completo
});

test('PBS sin namespaces (endpoint ausente): solo raíz, comportamiento clásico', async (t) => {
  if (skipIfNoSsl(t)) return;
  nsMode = 'none'; requests = [];
  const nss = await listNamespaces(auth, 'store1');
  assert.deepEqual(nss, ['']);
  const snaps = await listSnapshots(auth, 'store1');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]['backup-id'], '100');
  // no se pidió snapshots con ns
  assert.ok(!requests.some((r) => r.url.includes('/snapshots') && r.url.includes('ns=')));
});
