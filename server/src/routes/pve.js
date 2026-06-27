import { Router } from 'express';
import * as store from '../pveStore.js';
import * as pve from '../pveService.js';
import { pveStream } from '../pveClient.js';
import * as restoreStore from '../restoreStore.js';

export const pveRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function raw(req, res) {
  const h = store.getPveRaw(req.params.id);
  if (!h) { res.status(404).json({ error: 'Conexión PVE no encontrada' }); return null; }
  return h;
}

// --- CRUD de conexiones PVE ---
pveRouter.get('/', (req, res) => res.json(store.listPve()));

pveRouter.post('/', wrap(async (req, res) => {
  if (!req.body.host) return res.status(400).json({ error: 'Falta el campo host' });
  res.json(store.addPve(req.body));
}));

pveRouter.put('/:id', wrap(async (req, res) => {
  const u = store.updatePve(req.params.id, req.body);
  if (!u) return res.status(404).json({ error: 'Conexión PVE no encontrada' });
  res.json(u);
}));

pveRouter.delete('/:id', wrap(async (req, res) => {
  if (!store.deletePve(req.params.id)) return res.status(404).json({ error: 'Conexión PVE no encontrada' });
  res.json({ ok: true });
}));

pveRouter.post('/:id/default', wrap(async (req, res) => {
  if (!store.setDefaultPve(req.params.id)) return res.status(404).json({ error: 'Conexión PVE no encontrada' });
  res.json({ ok: true });
}));

pveRouter.post('/:id/test', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  try {
    const version = await pve.pveVersion(h);
    res.json({ ok: true, version });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
}));

// --- Inventario (nodos / almacenamientos / backups) ---
pveRouter.get('/:id/nodes', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveNodes(h));
}));

pveRouter.get('/:id/nodes/:node/storages', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveStorages(h, req.params.node));
}));

pveRouter.get('/:id/nodes/:node/storages/:storage/backups', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveBackups(h, req.params.node, req.params.storage));
}));

// --- Restauración de VM/CT (acción destructiva) ---
pveRouter.post('/:id/restore', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  const { node, type, vmid, archive, storage, force, start } = req.body || {};
  if (!node || !vmid || !archive) {
    return res.status(400).json({ error: 'Faltan node, vmid o archive' });
  }
  const upid = await pve.pveRestore(h, { node, type, vmid, archive, storage, force, start });
  // Vigilar la tarea para notificar por email al terminar
  try {
    restoreStore.addWatch({
      pveId: req.params.id, upid, node, type: type === 'lxc' ? 'lxc' : 'vm', kind: 'manual',
      pveName: h.name, sourceVmid: String(vmid), targetVmid: String(vmid),
      point: archive, ctime: null,
      startedAt: Math.floor(Date.now() / 1000), startedBy: req.user?.username || '',
    });
  } catch { /* la notificación es best-effort */ }
  res.json({ upid });
}));

// --- Trabajos de copia de seguridad (PVE / vzdump) ---
pveRouter.get('/:id/backup-jobs', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveBackupJobs(h));
}));
pveRouter.get('/:id/guests', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveGuests(h));
}));
pveRouter.post('/:id/backup-jobs', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveCreateBackupJob(h, req.body));
}));
// Lanzar ahora un trabajo de copia ya configurado (vzdump)
pveRouter.post('/:id/backup-jobs/:jobid/run', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json({ results: await pve.pveRunBackupJob(h, req.params.jobid) });
}));
pveRouter.put('/:id/backup-jobs/:jobid', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveUpdateBackupJob(h, req.params.jobid, req.body));
}));
pveRouter.delete('/:id/backup-jobs/:jobid', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveDeleteBackupJob(h, req.params.jobid));
}));

// --- Seguimiento de tareas de PVE ---
pveRouter.get('/:id/tasks/:upid/status', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveTaskStatus(h, req.params.upid));
}));

pveRouter.get('/:id/tasks/:upid/log', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  res.json(await pve.pveTaskLog(h, req.params.upid, {
    start: Number(req.query.start) || 0,
    limit: Number(req.query.limit) || 500,
  }));
}));

// --- Restauración granular de ficheros ---
pveRouter.get('/:id/file-restore/list', wrap(async (req, res) => {
  const h = raw(req, res); if (!h) return;
  const { node, storage, volume, filepath } = req.query;
  if (!node || !storage || !volume) return res.status(400).json({ error: 'Faltan node, storage o volume' });
  res.json(await pve.pveFileList(h, { node, storage, volume, filepath }));
}));

pveRouter.get('/:id/file-restore/download', (req, res) => {
  const h = raw(req, res); if (!h) return;
  const { node, storage, volume, filepath } = req.query;
  if (!node || !storage || !volume || !filepath) {
    return res.status(400).json({ error: 'Faltan node, storage, volume o filepath' });
  }
  const name = (filepath.split('/').filter(Boolean).pop() || 'restore') + '.zip';
  pveStream(
    h,
    {
      path: `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/file-restore/download`,
      query: { volume, filepath },
    },
    res,
    name,
  );
});
