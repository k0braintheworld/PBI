// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { pveCall } from './pveClient.js';

/**
 * Operaciones de recuperación contra Proxmox VE.
 * `pve` es el objeto crudo de la conexión (con tokenId + secret).
 */

export const pveVersion = (pve) => pveCall(pve, { path: '/version' });

export const pveNodes = (pve) => pveCall(pve, { path: '/nodes' });

/** Almacenamientos de un nodo (incluye tipo y contenidos soportados). */
export const pveStorages = (pve, node) =>
  pveCall(pve, { path: `/nodes/${encodeURIComponent(node)}/storage` });

/** Backups (volúmenes) disponibles en un almacenamiento (típicamente el PBS). */
export const pveBackups = (pve, node, storage) =>
  pveCall(pve, {
    path: `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
    query: { content: 'backup' },
  });

/**
 * Restaura una VM o CT desde un volumen de backup.
 * Devuelve el UPID de la tarea de restauración creada en PVE.
 */
export function pveRestore(pve, { node, type, vmid, archive, storage, force, start }) {
  const n = encodeURIComponent(node);
  if (type === 'lxc' || type === 'ct') {
    return pveCall(pve, {
      method: 'POST',
      path: `/nodes/${n}/lxc`,
      body: { vmid, ostemplate: archive, storage, restore: 1, force: force ? 1 : 0, start: start ? 1 : 0 },
    });
  }
  // qemu (vm)
  return pveCall(pve, {
    method: 'POST',
    path: `/nodes/${n}/qemu`,
    body: { vmid, archive, storage, force: force ? 1 : 0, start: start ? 1 : 0 },
  });
}

// --- Trabajos de copia de seguridad (vzdump, a nivel de cluster) ---
export const pveBackupJobs = (pve) => pveCall(pve, { path: '/cluster/backup' });
export const pveGuests = (pve) => pveCall(pve, { path: '/cluster/resources', query: { type: 'vm' } });
export const pveCreateBackupJob = (pve, body) => pveCall(pve, { method: 'POST', path: '/cluster/backup', body });
export const pveUpdateBackupJob = (pve, id, body) =>
  pveCall(pve, { method: 'PUT', path: `/cluster/backup/${encodeURIComponent(id)}`, body });
export const pveDeleteBackupJob = (pve, id) =>
  pveCall(pve, { method: 'DELETE', path: `/cluster/backup/${encodeURIComponent(id)}` });

/**
 * Lanza AHORA un trabajo de copia ya configurado. Proxmox no tiene un "ejecutar
 * job por id" universal, así que tomamos los parámetros del job y arrancamos un
 * `vzdump` en el/los nodo(s) correspondiente(s). Devuelve [{ node, upid|error }].
 */
export async function pveRunBackupJob(pve, jobId) {
  const jobs = await pveBackupJobs(pve);
  const job = (jobs || []).find((j) => j.id === jobId);
  if (!job) throw new Error(`Trabajo de copia no encontrado: ${jobId}`);

  // Solo parámetros válidos de vzdump (no los campos propios del job: id, schedule…)
  const VZ = ['storage', 'mode', 'compress', 'prune-backups', 'notes-template', 'mailto',
    'notification-mode', 'bwlimit', 'pigz', 'zstd', 'performance', 'fleecing', 'protected', 'ionice', 'encrypt'];
  const base = {};
  for (const k of VZ) {
    let v = job[k];
    if (v == null || v === '') continue;
    // PVE devuelve algunos parámetros como objeto (p. ej. prune-backups: {keep-last:5});
    // vzdump los espera como property-string "clave=valor,clave=valor".
    if (typeof v === 'object') v = Object.entries(v).map(([kk, vv]) => `${kk}=${vv}`).join(',');
    base[k] = v;
  }

  // Resolver a qué nodo(s) y con qué cuerpo se lanza el vzdump
  const targets = [];
  if (job.all || job.pool) {
    const nodes = await pveNodes(pve);
    for (const n of nodes || []) {
      const body = { ...base };
      if (job.all) body.all = 1; // si es por pool, ya va en `base`
      targets.push({ node: n.node, body });
    }
  } else if (job.vmid) {
    const wanted = new Set(String(job.vmid).split(',').map((s) => s.trim()).filter(Boolean));
    const guests = await pveGuests(pve);
    const byNode = {};
    for (const g of guests || []) if (wanted.has(String(g.vmid))) (byNode[g.node] = byNode[g.node] || []).push(String(g.vmid));
    if (!Object.keys(byNode).length) throw new Error('No se encontraron las máquinas del trabajo en el clúster');
    for (const [node, vmids] of Object.entries(byNode)) targets.push({ node, body: { ...base, vmid: vmids.join(',') } });
  } else {
    throw new Error('El trabajo no define máquinas (vmid/all/pool)');
  }

  const results = [];
  for (const t of targets) {
    try {
      const upid = await pveCall(pve, { method: 'POST', path: `/nodes/${encodeURIComponent(t.node)}/vzdump`, body: t.body });
      results.push({ node: t.node, upid });
    } catch (e) {
      results.push({ node: t.node, error: e.message });
    }
  }
  if (results.length && results.every((r) => r.error)) {
    throw new Error(results.map((r) => `${r.node}: ${r.error}`).join('; '));
  }
  return results;
}

/**
 * Silencia (o restaura) las notificaciones de email de los trabajos de copia.
 * silence=true -> notification-mode 'legacy-sendmail' sin destinatario (no envía).
 * silence=false -> notification-mode 'auto' (comportamiento por defecto).
 */
export async function pveSilenceBackupJobs(pve, silence) {
  const jobs = await pveBackupJobs(pve);
  let changed = 0;
  for (const j of jobs) {
    const body = { 'notification-mode': silence ? 'legacy-sendmail' : 'auto' };
    if (silence && j.mailto) body.delete = 'mailto';
    try { await pveUpdateBackupJob(pve, j.id, body); changed += 1; } catch { /* seguir con el resto */ }
  }
  return { total: jobs.length, changed };
}

/** Matchers del sistema de notificaciones de PVE (Datacenter → Notifications; PVE 8.1+). */
export const pveListNotificationMatchers = (pve) =>
  pveCall(pve, { path: '/cluster/notifications/matchers' });

export const pveSetNotificationMatcherDisabled = (pve, name, disabled) =>
  pveCall(pve, {
    method: 'PUT',
    path: `/cluster/notifications/matchers/${encodeURIComponent(name)}`,
    body: disabled ? { disable: 1 } : { delete: 'disable' },
  });

// El nodo va embebido en el UPID: UPID:<node>:<pid>:...
const nodeFromUpid = (upid) => (upid || '').split(':')[1] || '';

/**
 * Lista tareas del clúster PVE (recientes + en ejecución). Útil para emparejar
 * un backup en curso con su tarea vzdump (que sí reporta % y log completo).
 * `running`: solo en ejecución. `type`: filtra por tipo (p.ej. 'vzdump').
 */
export async function pveListTasks(pve, { running = false, type } = {}) {
  // /cluster/tasks no acepta filtros; devuelve las tareas recientes + activas
  // de todo el clúster y filtramos en memoria.
  const tasks = await pveCall(pve, { path: '/cluster/tasks' });
  const arr = Array.isArray(tasks) ? tasks : [];
  return arr
    .filter((t) => (!type || t.type === type) && (!running || !t.endtime))
    .map((t) => ({
      upid: t.upid,
      type: t.type,
      id: t.id != null ? String(t.id) : '',
      node: t.node || nodeFromUpid(t.upid),
      user: t.user || '',
      starttime: t.starttime,
      endtime: t.endtime ?? null,
      status: t.status || (t.endtime ? 'stopped' : 'running'),
    }));
}

/** Estado de una tarea de PVE (running/stopped + exitstatus). */
export function pveTaskStatus(pve, upid) {
  const node = nodeFromUpid(upid);
  return pveCall(pve, { path: `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status` });
}

/** Log de una tarea de PVE. */
export function pveTaskLog(pve, upid, { start = 0, limit = 500 } = {}) {
  const node = nodeFromUpid(upid);
  return pveCall(pve, {
    path: `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log`,
    query: { start, limit },
  });
}

/** Detiene (aborta) una tarea en ejecución en PVE (p. ej. un vzdump en curso). */
export function pveStopTask(pve, upid) {
  const node = nodeFromUpid(upid);
  return pveCall(pve, { method: 'DELETE', path: `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}` });
}

/** Lista ficheros del interior de un backup (file-restore de PVE). */
export function pveFileList(pve, { node, storage, volume, filepath }) {
  return pveCall(pve, {
    path: `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/file-restore/list`,
    query: { volume, filepath: filepath || '/' },
  });
}
