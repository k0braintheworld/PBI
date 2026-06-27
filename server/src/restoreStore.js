import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Almacén persistente de:
 *  - `jobs`: restauraciones programadas (recurrentes o puntuales).
 *  - `watch`: tareas de restauración en curso pendientes de notificar por email
 *    (tanto manuales como programadas). El vigilante las consulta hasta que
 *    finalizan, envía el email y las elimina.
 *
 * No contiene secretos (las credenciales viven en pveStore, cifradas).
 */

const FILE = path.join(config.dataDir, 'restore.json');
const DEFAULTS = { jobs: [], watch: [] };

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
}
function read() {
  ensure();
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function write(d) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

function normalizeJob(input, id) {
  const s = input.schedule || {};
  return {
    id,
    name: (input.name || '').trim() || `Restauración VM ${input.sourceVmid || ''}`,
    enabled: input.enabled !== false,
    pveId: input.pveId || '',
    node: input.node || '',
    storage: input.storage || '',                 // almacenamiento PBS con los backups
    type: input.type === 'lxc' ? 'lxc' : 'vm',
    sourceVmid: String(input.sourceVmid || ''),
    targetVmid: String(input.targetVmid || input.sourceVmid || ''),
    targetStorage: input.targetStorage || '',      // almacenamiento de discos destino
    force: !!input.force,
    start: !!input.start,
    schedule: {
      type: s.type === 'oneoff' ? 'oneoff' : 'recurring',
      frequency: ['daily', 'weekly', 'monthly'].includes(s.frequency) ? s.frequency : 'weekly',
      weekday: Number(s.weekday) || 1,
      dayOfMonth: Number(s.dayOfMonth) || 1,
      hour: s.hour == null ? 3 : Number(s.hour),
      runAt: s.runAt || '',                        // 'YYYY-MM-DDTHH:mm' para puntual
    },
    lastRun: input.lastRun ?? null,                // clave de periodo (recurrente) o 'done' (puntual)
    lastUpid: input.lastUpid ?? null,
    lastResult: input.lastResult ?? null,          // { ok, status, at, upid, error }
  };
}

export function getConfig() { return read(); }
export function listJobs() { return read().jobs; }
export function getJob(id) { return read().jobs.find((j) => j.id === id) || null; }

export function addJob(input) { const d = read(); const j = normalizeJob(input, crypto.randomUUID()); d.jobs.push(j); write(d); return j; }
export function updateJob(id, input) {
  const d = read(); const i = d.jobs.findIndex((j) => j.id === id);
  if (i === -1) return null;
  d.jobs[i] = normalizeJob({ ...d.jobs[i], ...input }, id);
  write(d); return d.jobs[i];
}
export function deleteJob(id) { const d = read(); const n = d.jobs.length; d.jobs = d.jobs.filter((j) => j.id !== id); write(d); return d.jobs.length < n; }
export function setJobRun(id, patch) { const d = read(); const i = d.jobs.findIndex((j) => j.id === id); if (i === -1) return; d.jobs[i] = { ...d.jobs[i], ...patch }; write(d); }

// --- Cola de tareas de restauración a vigilar/notificar ---
export function listWatch() { return read().watch; }
export function addWatch(entry) { const d = read(); d.watch.push({ id: crypto.randomUUID(), tries: 0, ...entry }); write(d); }
export function updateWatch(id, patch) { const d = read(); const i = d.watch.findIndex((w) => w.id === id); if (i === -1) return; d.watch[i] = { ...d.watch[i], ...patch }; write(d); }
export function removeWatch(id) { const d = read(); d.watch = d.watch.filter((w) => w.id !== id); write(d); }
