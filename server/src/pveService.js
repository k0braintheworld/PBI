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

// El nodo va embebido en el UPID: UPID:<node>:<pid>:...
const nodeFromUpid = (upid) => (upid || '').split(':')[1] || '';

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

/** Lista ficheros del interior de un backup (file-restore de PVE). */
export function pveFileList(pve, { node, storage, volume, filepath }) {
  return pveCall(pve, {
    path: `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/file-restore/list`,
    query: { volume, filepath: filepath || '/' },
  });
}
