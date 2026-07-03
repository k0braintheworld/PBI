// Cliente de la API del backend PBI (Proxmox Backup Interface).
import { moduleLang } from './i18n.jsx';

// --- Host activo (persistente en el navegador) ---
let activeHostId = localStorage.getItem('pbs.activeHost') || '';

export function getActiveHost() {
  return activeHostId;
}
export function setActiveHost(id) {
  activeHostId = id || '';
  if (activeHostId) localStorage.setItem('pbs.activeHost', activeHostId);
  else localStorage.removeItem('pbs.activeHost');
}

async function req(method, path, body) {
  const opts = { method, headers: { 'X-Requested-With': 'pbi' } }; // anti-CSRF (defensa en profundidad)
  if (activeHostId) opts.headers['X-PBS-Host'] = activeHostId;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    // Sesión caducada/ausente: avisar al gate para volver al login
    if (res.status === 401 && !path.startsWith('/auth')) {
      window.dispatchEvent(new Event('pbp-unauthorized'));
    }
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  return data;
}

export const api = {
  // Autenticación del panel
  authState: () => req('GET', '/auth/state'),
  authLogin: (body) => req('POST', '/auth/login', body),
  authSetup: (body) => req('POST', '/auth/setup', body),
  authLogout: () => req('POST', '/auth/logout'),
  security: () => req('GET', '/security'),
  configImport: (body) => req('POST', '/config-backup/import', body),
  setSecurity: (body) => req('PUT', '/security', body),
  // PBI Central (emisor multi-sede)
  centralGet: () => req('GET', '/central'),
  centralSave: (body) => req('PUT', '/central', body),
  centralTest: () => req('POST', '/central/test'),

  // Mi cuenta (autoservicio)
  accountGet: () => req('GET', '/account'),
  accountPassword: (body) => req('POST', '/account/password', body),
  account2faSetup: () => req('POST', '/account/2fa/setup'),
  account2faEnable: (code) => req('POST', '/account/2fa/enable', { code }),
  account2faDisable: (code) => req('POST', '/account/2fa/disable', { code }),

  // Gestión de usuarios (admin)
  usersList: () => req('GET', '/users'),
  userCreate: (body) => req('POST', '/users', body),
  userUpdate: (id, body) => req('PUT', `/users/${id}`, body),
  userDelete: (id) => req('DELETE', `/users/${id}`),

  // Hosts (configuración persistente)
  hosts: () => req('GET', '/hosts'),
  addHost: (body) => req('POST', '/hosts', body),
  updateHost: (id, body) => req('PUT', `/hosts/${id}`, body),
  deleteHost: (id) => req('DELETE', `/hosts/${id}`),
  setDefaultHost: (id) => req('POST', `/hosts/${id}/default`),
  testHost: (id) => req('POST', `/hosts/${id}/test`),

  // General
  version: () => req('GET', '/version'),
  overview: () => req('GET', '/overview'),
  dashboard: () => req('GET', '/dashboard'),

  // Datastores
  datastores: () => req('GET', '/datastores'),
  snapshots: (store) => req('GET', `/datastores/${encodeURIComponent(store)}/snapshots`),

  // Jobs
  jobs: (kind) => req('GET', `/jobs/${kind}`),
  createJob: (kind, body) => req('POST', `/jobs/${kind}`, body),
  updateJob: (kind, id, body) => req('PUT', `/jobs/${kind}/${encodeURIComponent(id)}`, body),
  deleteJob: (kind, id) => req('DELETE', `/jobs/${kind}/${encodeURIComponent(id)}`),
  runJob: (kind, id) => req('POST', `/jobs/${kind}/${encodeURIComponent(id)}/run`),

  // Tareas
  tasks: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/tasks${q ? `?${q}` : ''}`);
  },
  taskLog: (upid) => req('GET', `/tasks/${encodeURIComponent(upid)}/log`),
  calendar: (from, to) => req('GET', `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  taskStatus: (upid) => req('GET', `/tasks/${encodeURIComponent(upid)}/status`),

  // Proxmox VE / Recuperación
  pveList: () => req('GET', '/pve'),
  pveAdd: (b) => req('POST', '/pve', b),
  pveUpdate: (id, b) => req('PUT', `/pve/${id}`, b),
  pveDelete: (id) => req('DELETE', `/pve/${id}`),
  pveSetDefault: (id) => req('POST', `/pve/${id}/default`),
  pveTest: (id) => req('POST', `/pve/${id}/test`),
  pveNodes: (id) => req('GET', `/pve/${id}/nodes`),
  pveStorages: (id, node) => req('GET', `/pve/${id}/nodes/${encodeURIComponent(node)}/storages`),
  pveBackups: (id, node, storage) =>
    req('GET', `/pve/${id}/nodes/${encodeURIComponent(node)}/storages/${encodeURIComponent(storage)}/backups`),
  pveBackupJobs: (id) => req('GET', `/pve/${id}/backup-jobs`),
  pveGuests: (id) => req('GET', `/pve/${id}/guests`),
  pveCreateBackupJob: (id, body) => req('POST', `/pve/${id}/backup-jobs`, body),
  pveRunBackupJob: (id, jobid) => req('POST', `/pve/${id}/backup-jobs/${encodeURIComponent(jobid)}/run`),
  pveUpdateBackupJob: (id, jobid, body) => req('PUT', `/pve/${id}/backup-jobs/${encodeURIComponent(jobid)}`, body),
  pveDeleteBackupJob: (id, jobid) => req('DELETE', `/pve/${id}/backup-jobs/${encodeURIComponent(jobid)}`),
  pveRestore: (id, body) => req('POST', `/pve/${id}/restore`, body),
  pveTasks: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/pve/${id}/tasks${q ? `?${q}` : ''}`);
  },
  pveTaskStatus: (id, upid) => req('GET', `/pve/${id}/tasks/${encodeURIComponent(upid)}/status`),
  pveTaskLog: (id, upid) => req('GET', `/pve/${id}/tasks/${encodeURIComponent(upid)}/log`),
  pveFileList: (id, params) => req('GET', `/pve/${id}/file-restore/list?${new URLSearchParams(params)}`),
  pveFileDownloadUrl: (id, params) => `/api/pve/${id}/file-restore/download?${new URLSearchParams(params)}`,

  // Auditoría
  auditList: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/audit${q ? `?${q}` : ''}`);
  },
  auditConfig: () => req('GET', '/audit/config'),
  auditConfigSave: (body) => req('PUT', '/audit/config', body),

  // Auto-actualización
  updateCapability: () => req('GET', '/update/capability'),
  updateApply: (body) => req('POST', '/update/apply', body),

  // Restauraciones programadas
  restoreJobs: () => req('GET', '/restore-jobs'),
  restoreJobCreate: (body) => req('POST', '/restore-jobs', body),
  restoreJobUpdate: (id, body) => req('PUT', `/restore-jobs/${id}`, body),
  restoreJobDelete: (id) => req('DELETE', `/restore-jobs/${id}`),
  restoreJobRun: (id) => req('POST', `/restore-jobs/${id}/run`),

  // Limpieza
  cleanupGroups: () => req('GET', '/cleanup/groups'),
  cleanupDeleteGroup: (body) => req('POST', '/cleanup/delete-group', body),
  cleanupDeleteSnapshot: (body) => req('POST', '/cleanup/delete-snapshot', body),
  cleanupGc: (store) => req('POST', '/cleanup/gc', { store }),

  // Notificaciones
  notifyGet: () => req('GET', '/notify'),
  notifySave: (body) => req('PUT', '/notify', body),
  notifyTest: (body) => req('POST', '/notify/test', body),
  notifySilenceProxmox: (enable) => req('POST', '/notify/silence-proxmox', { enable }),

  // Informes
  reportSummary: () => req('GET', '/reports/summary'),
  reportConfigGet: () => req('GET', '/report'),
  reportConfigSave: (body) => req('PUT', '/report', body),
  reportSendNow: () => req('POST', '/report/send'),
  reportPreviewUrl: () => '/api/report/preview',
  reportPreviewPdfUrl: () => '/api/report/preview.pdf',
  reportMachines: () => req('GET', '/report/machines'),
  reportCustomUrl: (params, pdf) => `/api/report/custom${pdf ? '.pdf' : ''}?${new URLSearchParams(params)}`,
  // Las descargas CSV se abren por URL directa: el host va como query param.
  csvUrl: (kind, store) => {
    const p = new URLSearchParams();
    if (store) p.set('store', store);
    if (activeHostId) p.set('host', activeHostId);
    const q = p.toString();
    return `/api/reports/${kind}.csv${q ? `?${q}` : ''}`;
  },
};

// ---- Utilidades de formato ----

export function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(epoch) {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleString(moduleLang() === 'en' ? 'en-GB' : 'es-ES');
}

export function fmtAgo(epoch) {
  if (!epoch) return '—';
  const en = moduleLang() === 'en';
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 60) return en ? 'seconds ago' : 'hace segundos';
  if (s < 3600) return en ? `${Math.floor(s / 60)} min ago` : `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return en ? `${Math.floor(s / 3600)} h ago` : `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (en) return d === 1 ? '1 day ago' : `${d} days ago`;
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function fmtDuration(start, end) {
  if (!start) return '—';
  if (!end) return moduleLang() === 'en' ? 'in progress' : 'en curso';
  const s = end - start;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
