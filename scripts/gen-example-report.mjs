// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
// Genera los ejemplos de docs/examples/ (informe HTML+PDF y notificaciones) con
// datos ficticios, usando el propio motor de PBI. Reejecutar tras cambios de
// formato:  node scripts/gen-example-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../server/src/reportService.js';
import { renderPdf } from '../server/src/reportPdf.js';
import { buildTaskEmail } from '../server/src/mailer.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples');
const TiB = 1024 ** 4;
const GiB = 1024 ** 3;

// Mes ficticio: marzo de 2026
const year = 2026;
const month = 2; // 0-based
const daysInMonth = new Date(year, month + 1, 0).getDate();
const from = Math.floor(new Date(year, month, 1, 0, 0, 0).getTime() / 1000);
const to = Math.floor(new Date(year, month, daysInMonth, 23, 59, 59).getTime() / 1000);

const calendar = [];
for (let day = 1; day <= daysInMonth; day++) {
  const weekday = (new Date(year, month, day).getDay() + 6) % 7;
  let status = 'ok';
  let total = 2 + (day % 3);
  let failed = 0;
  if (day === 12) { status = 'partial'; total = 3; failed = 1; }
  else if (day === 21) { status = 'failed'; total = 2; failed = 2; }
  else if (day === 27) { status = 'none'; total = 0; failed = 0; }
  calendar.push({ day, weekday, status, total, failed });
}

const vmsDef = [
  { vmid: '101', name: 'srv-web', size: 120 * GiB, ok: 31, fail: 0, verify: 'ok' },
  { vmid: '102', name: 'srv-db', size: 340 * GiB, ok: 30, fail: 1, verify: 'ok' },
  { vmid: '103', name: 'srv-archivos', size: Math.round(1.2 * TiB), ok: 31, fail: 0, verify: 'ok' },
  { vmid: '201', name: 'ct-proxy', size: 8 * GiB, ok: 31, fail: 0, verify: null },
  { vmid: '202', name: 'ct-correo', size: 45 * GiB, ok: 29, fail: 2, verify: 'failed' },
];
const names = {};
const vms = [];
const lastSnap = new Map();
for (const v of vmsDef) {
  names[v.vmid] = v.name;
  vms.push({ vmid: v.vmid, count: v.ok + v.fail, ok: v.ok, fail: v.fail, last: to - 3600 });
  lastSnap.set(v.vmid, { size: v.size, verification: v.verify ? { state: v.verify } : undefined, 'backup-id': v.vmid });
}

const backupsLogical = vmsDef.reduce((a, v) => a + v.size, 0) * 9; // varios snapshots por máquina
const totalUsed = Math.round(backupsLogical / 2.8); // PBS deduplica ~2.8×
const totalCap = 21 * TiB;
const okCount = vms.reduce((a, v) => a + v.ok, 0);
const failCount = vms.reduce((a, v) => a + v.fail, 0);

const r = {
  title: 'Informe mensual de copias de seguridad',
  sede: 'Contoso S.L.',
  hostName: 'pbs01',
  from,
  to,
  perDatastore: [{ store: 'nas-backups', used: totalUsed, total: totalCap }],
  totalUsed,
  totalCap,
  backupsLogical,
  dedup: backupsLogical / totalUsed,
  vms,
  names,
  lastSnap,
  backups: okCount + failCount,
  okCount,
  failCount,
  successRate: Math.round((okCount / (okCount + failCount)) * 100),
  failures: [
    { type: 'backup', id: 'nas-backups:ct/202', endtime: to - 86400 * 3, status: 'TASK ERROR: CT is locked (backup)' },
    { type: 'backup', id: 'nas-backups:vm/102', endtime: to - 86400 * 9, status: 'TASK ERROR: got timeout' },
  ],
  calendar,
  monthLabel: new Date(year, month, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
  scope: vmsDef.map((v) => ({ vmid: v.vmid, name: v.name })),
  meta: { reportId: 'PBI-2026-03', emittedAt: '2026-04-01', generatedBy: 'admin', responsable: 'Departamento de Sistemas', restoreTest: '2026-03-15 · VM 101 → VMID 990 (OK)' },
  encryption: { encrypted: true, modes: ['encrypt'] },
  policies: { '*': { schedule: 'Diaria 02:00', retention: '7d / 4s / 6m', mode: 'snapshot' } },
  offsite: { configured: true, remotes: ['pbs-offsite (sync diario)'] },
};

fs.writeFileSync(path.join(OUT, 'informe-mensual.html'), renderHtml(r));
fs.writeFileSync(path.join(OUT, 'informe-mensual.pdf'), await renderPdf(r));

// Notificaciones por email (estado de tarea)
const okMail = buildTaskEmail(
  { type: 'backup', id: 'nas-backups:vm/101', starttime: to - 184, endtime: to, status: 'OK' },
  { hostName: 'pbs01', names: { 101: 'srv-web' }, sede: 'Contoso S.L.', backupMode: 'incremental', encrypted: true },
);
fs.writeFileSync(path.join(OUT, 'notificacion-correcta.html'), okMail.html);

const failMail = buildTaskEmail(
  { type: 'backup', id: 'nas-backups:ct/202', starttime: to - 600, endtime: to - 540, status: 'TASK ERROR: CT is locked (backup)' },
  { hostName: 'pbs01', names: { 202: 'ct-correo' }, sede: 'Contoso S.L.' },
);
fs.writeFileSync(path.join(OUT, 'notificacion-fallo.html'), failMail.html);

console.log('Ejemplos regenerados en docs/examples/');
