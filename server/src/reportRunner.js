// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import * as reportStore from './reportStore.js';
import * as notifyStore from './notifyStore.js';
import { getDefaultHost } from './hostStore.js';
import { authForHost } from './authResolver.js';
import { getDefaultPve } from './pveStore.js';
import { pveGuests, pveBackupJobs } from './pveService.js';
import { computeReport, renderHtml, periodRange } from './reportService.js';
import { renderPdf } from './reportPdf.js';
import { listDatastores, listSnapshots, listJobs } from './pbsService.js';
import { listJobs as listRestoreJobs } from './restoreStore.js';
import { sendMail } from './mailer.js';

/** Última prueba de restauración correcta (de los tests programados de PBI). */
function lastRestoreTestLabel() {
  try {
    const ok = listRestoreJobs().filter((j) => j.lastResult?.ok && j.lastResult?.at);
    const best = ok.sort((a, b) => (b.lastResult.at || 0) - (a.lastResult.at || 0))[0];
    if (!best) return '';
    const d = new Date(best.lastResult.at * 1000).toLocaleDateString('es-ES');
    return `${d} · ${best.type === 'lxc' ? 'CT' : 'VM'} ${best.sourceVmid} → VMID ${best.targetVmid} (OK, automática)`;
  } catch { return ''; }
}

async function guestNames() {
  try {
    const pve = getDefaultPve();
    if (!pve) return {};
    const guests = await pveGuests(pve);
    const map = {};
    for (const g of guests || []) map[String(g.vmid)] = g.name;
    return map;
  } catch { return {}; }
}

const titleFor = (freq) => (freq === 'daily' ? 'Informe diario de copias'
  : freq === 'weekly' ? 'Informe semanal de copias' : 'Informe mensual de copias');

const isoDate = (e) => new Date(e * 1000).toISOString().slice(0, 10);
const pdfName = (r) => `informe-copias-${isoDate(r.from)}_${isoDate(r.to)}.pdf`;

/** Calcula el objeto de datos del informe (compartido por HTML y PDF). */
export async function generateReport(cfg) {
  const host = getDefaultHost();
  if (!host) { const e = new Error('No hay ningún host PBS configurado'); e.status = 409; throw e; }
  const auth = await authForHost(host);
  const names = await guestNames();
  const range = periodRange(cfg.frequency);
  const r = await computeReport(auth, range, { sede: cfg.sede, hostName: host.name, names, title: titleFor(cfg.frequency) });
  return { r, subject: r.subject, html: renderHtml(r) };
}

/** Genera el informe en PDF. Devuelve { subject, buffer, filename }. */
export async function generatePdf(cfg) {
  const { r, subject } = await generateReport(cfg);
  const buffer = await renderPdf(r);
  return { subject, buffer, filename: pdfName(r) };
}

/** Genera y envía el informe por email (HTML + PDF adjunto). Devuelve { to }. */
export async function sendReport(cfg) {
  const smtp = notifyStore.getRaw().smtp;
  const to = cfg.to || smtp.to;
  if (!smtp.host || !to) { const e = new Error('Configura el SMTP (en Notificaciones) y un destinatario'); e.status = 400; throw e; }
  const { r, subject, html } = await generateReport(cfg);
  const buffer = await renderPdf(r);
  await sendMail({ ...smtp, to }, {
    subject, html,
    attachments: [{ filename: pdfName(r), content: buffer, contentType: 'application/pdf' }],
  });
  return { to };
}

/** Lista las máquinas (grupos de backup) del PBS por defecto, con nombre de PVE. */
export async function listMachines() {
  const host = getDefaultHost();
  if (!host) { const e = new Error('No hay ningún host PBS configurado'); e.status = 409; throw e; }
  const auth = await authForHost(host);
  const names = await guestNames();
  const datastores = await listDatastores(auth);
  const groups = new Map();
  for (const ds of datastores) {
    const snaps = await listSnapshots(auth, ds.store).catch(() => []);
    for (const s of snaps) {
      const id = String(s['backup-id']);
      if (!groups.has(id)) groups.set(id, { id, type: s['backup-type'], name: names[id] || '' });
    }
  }
  return [...groups.values()].sort((a, b) => (a.id > b.id ? 1 : -1));
}

const retentionStr = (pb) => {
  if (!pb) return '—';
  const obj = typeof pb === 'string' ? Object.fromEntries(pb.split(',').map((p) => p.split('='))) : pb;
  const L = [['keep-last', 'últimas'], ['keep-daily', 'diarias'], ['keep-weekly', 'semanales'], ['keep-monthly', 'mensuales'], ['keep-yearly', 'anuales']];
  const parts = L.map(([k, l]) => (obj[k] ? `${obj[k]} ${l}` : null)).filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
};

/** Política de copia por vmid, a partir de los trabajos de backup de PVE. */
async function gatherPolicies() {
  try {
    const pve = getDefaultPve();
    if (!pve) return null;
    const jobs = await pveBackupJobs(pve);
    const map = {};
    for (const j of jobs || []) {
      if (!j.enabled) continue;
      const pol = { schedule: j.schedule || '—', retention: retentionStr(j['prune-backups']), mode: j.mode || 'snapshot' };
      if (j.all) map['*'] = pol;
      else String(j.vmid || '').split(',').filter(Boolean).forEach((v) => { map[v] = pol; });
    }
    return map;
  } catch { return null; }
}

/** Copia externa: ¿hay trabajos de sincronización en PBS? */
async function gatherOffsite(auth) {
  try {
    const sync = await listJobs(auth, 'sync');
    return { configured: (sync || []).length > 0, remotes: (sync || []).map((s) => s.remote).filter(Boolean) };
  } catch { return { configured: false, remotes: [] }; }
}

/** Genera un informe a medida (rango y máquinas elegidos). Devuelve {r, html}. */
export async function generateCustomReport({ from, to, vmids, sede, title, responsable, generatedBy, reportId, restoreTest }) {
  const host = getDefaultHost();
  if (!host) { const e = new Error('No hay ningún host PBS configurado'); e.status = 409; throw e; }
  const auth = await authForHost(host);
  const names = await guestNames();
  const [policies, offsite] = await Promise.all([gatherPolicies(), gatherOffsite(auth)]);
  const meta = { reportId, emittedAt: new Date().toLocaleString('es-ES'), generatedBy, responsable, restoreTest: restoreTest || lastRestoreTestLabel() };
  const r = await computeReport(auth, { from, to }, {
    sede, hostName: host.name, names, title: title || 'Informe de copias de seguridad', vmids, meta, policies, offsite,
  });
  return { r, html: renderHtml(r) };
}

export async function generateCustomPdf(opts) {
  const { r } = await generateCustomReport(opts);
  const buffer = await renderPdf(r);
  return { buffer, filename: pdfName(r) };
}

export { reportStore };
