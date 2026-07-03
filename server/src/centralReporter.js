// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import { URL } from 'node:url';
import { listHostsRaw } from './hostStore.js';
import { authForHost } from './authResolver.js';
import { listTasks, listDatastores, listSnapshots, getDatastoreStatus } from './pbsService.js';
import { getDefaultPve } from './pveStore.js';
import { pveGuests } from './pveService.js';
import { getRaw as getReportCfg } from './reportStore.js';
import * as centralStore from './centralStore.js';
import { isCentralUnlocked } from './featureStore.js';
import { excludedSet } from './excludedVms.js';

// Versión de PBI para el informe. Se resuelve de forma robusta: en el paquete .deb
// no se incluye web/src, así que NUNCA se debe importar estáticamente de ahí (rompería
// el arranque). Se usa PBI_VERSION (inyectada por el .deb) y, en desarrollo, se intenta
// leer web/src/version.js dinámicamente.
let _versionCache;
async function resolveVersion() {
  if (_versionCache !== undefined) return _versionCache;
  if (process.env.PBI_VERSION) { _versionCache = process.env.PBI_VERSION; return _versionCache; }
  try { _versionCache = (await import('../../web/src/version.js')).APP_VERSION || ''; }
  catch { _versionCache = ''; }
  return _versionCache;
}

/**
 * Emisor hacia PBI Central. Recolecta el estado agregado de TODOS los hosts PBS de
 * esta sede, lo empaqueta según el contrato "pbi-central/site-status" (v1, ver el
 * repo pbi-central) y lo envía por PUSH saliente al colector. Conexión mTLS: la sede
 * se autentica con su certificado cliente. Solo estado agregado; nunca credenciales
 * ni contenido de backups.
 */

const SCHEMA_ID = 'pbi-central/site-status';
const isOk = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');

let timer = null;
let running = false;

// --- Recolección del estado por host -----------------------------------------

async function collectHost(host, rpoHours) {
  const out = {
    id: host.id,
    name: host.name || host.host,
    reachable: false,
    datastores: [],
    counters: { groups: 0, snapshots: 0, failedVerifications: 0 },
    tasks24h: { ok: 0, failed: 0, running: 0 },
    failures: [],
    rpo: { thresholdHours: rpoHours, outOfRpo: [] },
    unprotected: [],
  };
  try {
    const auth = await authForHost(host);
    const stores = await listDatastores(auth);
    const perStore = await Promise.all(stores.map(async (ds) => {
      const [status, snaps] = await Promise.all([
        getDatastoreStatus(auth, ds.store).catch(() => null),
        listSnapshots(auth, ds.store).catch(() => []),
      ]);
      return { ds, status, snaps };
    }));
    out.reachable = true;

    out.datastores = perStore.map(({ ds, status }) => ({
      store: ds.store,
      usedBytes: status?.used ?? null,
      totalBytes: status?.total ?? null,
      usedPct: status?.total ? Math.round((status.used / status.total) * 100) : null,
    })).filter((d) => d.usedPct != null);

    const allSnaps = perStore.flatMap((p) => p.snaps);
    const groups = new Set(allSnaps.map((s) => `${s['backup-type']}/${s['backup-id']}`));
    out.counters = {
      groups: groups.size,
      snapshots: allSnaps.length,
      failedVerifications: allSnaps.filter((s) => s.verification?.state === 'failed').length,
    };

    // Frescura por grupo (vm/ct) para el RPO
    const now = Math.floor(Date.now() / 1000);
    const byGroup = new Map();
    for (const s of allSnaps) {
      const type = s['backup-type'];
      if (type !== 'vm' && type !== 'ct') continue;
      const k = `${type}/${s['backup-id']}`;
      const t = s['backup-time'] || 0;
      const prev = byGroup.get(k);
      if (!prev || t > prev.last) byGroup.set(k, { type, id: String(s['backup-id']), last: t });
    }
    out._protectedIds = new Set([...byGroup.values()].map((g) => g.id));
    out.rpo.outOfRpo = [...byGroup.values()]
      .filter((g) => now - (g.last || 0) > rpoHours * 3600)
      .map((g) => ({ type: g.type, id: g.id, lastBackup: g.last ? new Date(g.last * 1000).toISOString() : null }));

    // Tareas de las últimas 24 h
    const tasks = await listTasks(auth, { limit: 2000, since: now - 24 * 3600 }).catch(() => []);
    const done = (tasks || []).filter((t) => t.endtime != null && t.endtime > now - 24 * 3600);
    const okc = done.filter((t) => isOk(t.status)).length;
    out.tasks24h = { ok: okc, failed: done.length - okc, running: (tasks || []).filter((t) => t.endtime == null).length };
    out.failures = done.filter((t) => !isOk(t.status)).slice(0, 10)
      .map((t) => ({ type: t.type, id: t.id || '', status: (t.status || '').slice(0, 120), endtime: t.endtime ? new Date(t.endtime * 1000).toISOString() : null }));
  } catch (e) {
    out.reachable = false;
    out.error = e.message;
  }
  return out;
}

/** Construye el mensaje completo del contrato para esta sede. */
export async function collectSiteStatus() {
  const cfg = centralStore.getRaw();
  const notify = getReportCfg();
  const rpoHours = 26; // umbral por defecto; el central puede reinterpretarlo
  const hosts = listHostsRaw();

  const hostStates = await Promise.all(hosts.map((h) => collectHost(h, rpoHours)));

  // Nombres de guests de PVE (para outOfRpo/unprotected) + máquinas sin proteger
  const protectedIds = new Set();
  for (const h of hostStates) for (const id of (h._protectedIds || [])) protectedIds.add(id);

  let guestNames = {};
  let unprotected = [];
  try {
    const pve = getDefaultPve();
    if (pve) {
      const excluded = excludedSet();
      const guests = await pveGuests(pve);
      for (const g of guests || []) guestNames[String(g.vmid)] = g.name || '';
      unprotected = (guests || [])
        .filter((g) => !g.template && !protectedIds.has(String(g.vmid)) && !excluded.has(String(g.vmid)))
        .map((g) => ({ vmid: g.vmid, name: cfg.sendMachineNames ? (g.name || '') : '', type: g.type === 'lxc' ? 'ct' : 'vm' }));
    }
  } catch { /* sin PVE: se omite el enriquecimiento */ }

  // Enriquecer nombres (si procede) y repartir "unprotected" al primer host
  for (const h of hostStates) {
    if (cfg.sendMachineNames) for (const m of h.rpo.outOfRpo) m.name = guestNames[m.id] || undefined;
    delete h._protectedIds;
    delete h.error;
  }
  if (hostStates[0]) hostStates[0].unprotected = unprotected;

  // Rollup de sede
  const backups24h = hostStates.reduce((a, h) => ({ ok: a.ok + h.tasks24h.ok, failed: a.failed + h.tasks24h.failed }), { ok: 0, failed: 0 });
  const outOfRpoCount = hostStates.reduce((a, h) => a + h.rpo.outOfRpo.length, 0);
  const worstDatastorePct = hostStates.reduce((m, h) => Math.max(m, ...h.datastores.map((d) => d.usedPct), 0), 0);
  const anyUnreachable = hostStates.some((h) => !h.reachable);
  const status = (backups24h.failed > 0 || anyUnreachable) ? 'fail'
    : (outOfRpoCount > 0 || unprotected.length > 0 || worstDatastorePct >= (notify?.storageAlert?.percent || 85)) ? 'warn'
      : 'ok';

  const pbiVersion = await resolveVersion();
  return {
    schema: SCHEMA_ID,
    version: 1,
    site: {
      id: cfg.siteId || 'sede',
      name: cfg.siteName || getReportCfg()?.sede || 'Sede',
      pbiVersion,
    },
    generatedAt: new Date().toISOString(),
    sequence: centralStore.nextSequence(),
    hosts: hostStates,
    summary: {
      status,
      hostsTotal: hostStates.length,
      hostsReachable: hostStates.filter((h) => h.reachable).length,
      backups24h,
      outOfRpoCount,
      unprotectedCount: unprotected.length,
      worstDatastorePct,
    },
  };
}

// --- Envío --------------------------------------------------------------------

const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';

function postStatus(cfg, message) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL('/api/ingest', cfg.url); } catch { return reject(new Error('URL del central inválida')); }
    const body = Buffer.from(JSON.stringify(message));
    const isHttps = target.protocol === 'https:';
    // No enviar el estado en claro a un host remoto: si no es https y no es local
    // (desarrollo), se rechaza. El tráfico PBI↔Central debe ir siempre cifrado.
    if (!isHttps && !isLocalHost(target.hostname)) {
      return reject(new Error('El central debe usar https:// — no se envía el estado sin cifrar a un host remoto'));
    }
    const opts = {
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      timeout: 15000,
    };
    if (isHttps) {
      opts.minVersion = 'TLSv1.2'; // suelo mínimo; entre dos Node 22 se usa TLS 1.3
      // mTLS: certificado cliente de la sede. Verificación del servidor:
      //  - con caPath → se fija ESE certificado (pinning). Se sigue exigiendo que el
      //    servidor lo presente (rejectUnauthorized por defecto), pero se omite la
      //    comprobación del nombre/IP, para que funcione un central autofirmado por IP.
      //  - sin caPath → Node valida contra las CAs del sistema (certificado real).
      try {
        if (cfg.clientCertPath) opts.cert = fs.readFileSync(cfg.clientCertPath);
        if (cfg.clientKeyPath) opts.key = fs.readFileSync(cfg.clientKeyPath);
        if (cfg.caPath) {
          opts.ca = fs.readFileSync(cfg.caPath);
          opts.checkServerIdentity = () => undefined; // confiar en el cert fijado, sin comprobar el host
        }
      } catch (e) { return reject(new Error(`No se pudo leer el certificado: ${e.message}`)); }
    }
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode });
        else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout de conexión con el central')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Recolecta y envía una vez. Devuelve { ok, ... } y guarda lastResult. */
export async function sendNow() {
  const cfg = centralStore.getRaw();
  if (!cfg.url || !cfg.siteId) {
    const r = { at: Date.now(), ok: false, error: 'Falta URL del central o site.id' };
    centralStore.setLastResult(r);
    return r;
  }
  try {
    const message = await collectSiteStatus();
    const res = await postStatus(cfg, message);
    const r = { at: Date.now(), ok: true, status: res.status, sequence: message.sequence };
    centralStore.setLastResult(r);
    return r;
  } catch (e) {
    const r = { at: Date.now(), ok: false, error: e.message };
    centralStore.setLastResult(r);
    return r;
  }
}

// --- Bucle --------------------------------------------------------------------

async function tick() {
  if (running) return;
  if (!isCentralUnlocked()) return; // feature bloqueada
  const cfg = centralStore.getRaw();
  if (!cfg.enabled || !cfg.url || !cfg.siteId) return;
  running = true;
  try { await sendNow(); }
  catch (e) { console.error('[central] error en el envío:', e.message); }
  finally { running = false; }
}

export function startCentralReporter() {
  if (timer) return;
  // Comprobación ligera cada minuto; envía si toca según el intervalo configurado.
  let lastSent = 0;
  timer = setInterval(async () => {
    const cfg = centralStore.getRaw();
    if (!cfg.enabled) return;
    const dueMs = (Number(cfg.intervalMinutes) || 10) * 60_000;
    if (Date.now() - lastSent < dueMs) return;
    lastSent = Date.now();
    await tick();
  }, 60_000);
  console.log('  PBI Central: emisor activo (envío según intervalo configurado)');
}
