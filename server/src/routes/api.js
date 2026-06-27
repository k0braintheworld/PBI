import { Router } from 'express';
import { resolveAuth } from '../authResolver.js';
import * as pbs from '../pbsService.js';
import { getDefaultPve } from '../pveStore.js';
import { pveGuests } from '../pveService.js';
import { reportsRouter } from './reports.js';

export const apiRouter = Router();

// Todas las rutas de datos resuelven el host activo (cabecera X-PBS-Host
// o el host por defecto) y adjuntan req.auth.
apiRouter.use(resolveAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- General ---------------------------------------------------------------

apiRouter.get('/version', wrap(async (req, res) => {
  res.json(await pbs.getVersion(req.auth));
}));

apiRouter.get('/overview', wrap(async (req, res) => {
  res.json(await pbs.getOverview(req.auth));
}));

apiRouter.get('/dashboard', wrap(async (req, res) => {
  res.json(await pbs.getDashboard(req.auth));
}));

// --- Datastores / snapshots ------------------------------------------------

apiRouter.get('/datastores', wrap(async (req, res) => {
  res.json(await pbs.listDatastores(req.auth));
}));

apiRouter.get('/datastores/:store/status', wrap(async (req, res) => {
  res.json(await pbs.getDatastoreStatus(req.auth, req.params.store));
}));

apiRouter.get('/datastores/:store/snapshots', wrap(async (req, res) => {
  res.json(await pbs.listSnapshots(req.auth, req.params.store));
}));

// --- Jobs (prune | verify | sync) ------------------------------------------

apiRouter.get('/jobs/:kind', wrap(async (req, res) => {
  res.json(await pbs.listJobs(req.auth, req.params.kind));
}));

apiRouter.post('/jobs/:kind', wrap(async (req, res) => {
  res.json(await pbs.createJob(req.auth, req.params.kind, req.body));
}));

apiRouter.put('/jobs/:kind/:id', wrap(async (req, res) => {
  res.json(await pbs.updateJob(req.auth, req.params.kind, req.params.id, req.body));
}));

apiRouter.delete('/jobs/:kind/:id', wrap(async (req, res) => {
  res.json(await pbs.deleteJob(req.auth, req.params.kind, req.params.id));
}));

apiRouter.post('/jobs/:kind/:id/run', wrap(async (req, res) => {
  res.json({ upid: await pbs.runJob(req.auth, req.params.kind, req.params.id) });
}));

// --- Tareas ----------------------------------------------------------------

apiRouter.get('/tasks', wrap(async (req, res) => {
  const { limit, running, store, type } = req.query;
  res.json(await pbs.listTasks(req.auth, {
    limit: limit ? Number(limit) : undefined,
    running: running === '1' || running === 'true',
    store,
    type,
  }));
}));

apiRouter.get('/tasks/:upid/status', wrap(async (req, res) => {
  res.json(await pbs.getTaskStatus(req.auth, req.params.upid));
}));

apiRouter.get('/tasks/:upid/log', wrap(async (req, res) => {
  res.json(await pbs.getTaskLog(req.auth, req.params.upid, {
    start: req.query.start ? Number(req.query.start) : 0,
    limit: req.query.limit ? Number(req.query.limit) : 500,
  }));
}));

// --- Limpieza --------------------------------------------------------------

// Lista de grupos de backup con tamaño, protección y si están huérfanos (su VM ya no existe en PVE)
apiRouter.get('/cleanup/groups', wrap(async (req, res) => {
  const groups = await pbs.getBackupGroups(req.auth);
  let guestIds = null;
  const names = {};
  try {
    const pve = getDefaultPve();
    if (pve) {
      const guests = await pveGuests(pve);
      guestIds = new Set((guests || []).map((g) => String(g.vmid)));
      for (const g of guests || []) names[String(g.vmid)] = g.name;
    }
  } catch { /* PVE opcional */ }

  const enriched = groups.map((g) => ({
    ...g,
    name: names[g.id] || '',
    orphan: (g.type === 'vm' || g.type === 'ct') && guestIds ? !guestIds.has(g.id) : null,
  }));
  res.json({ groups: enriched, pveKnown: !!guestIds });
}));

apiRouter.post('/cleanup/delete-group', wrap(async (req, res) => {
  const { store, type, id } = req.body || {};
  if (!store || !type || !id) return res.status(400).json({ error: 'Faltan store, type o id' });
  res.json(await pbs.deleteBackupGroup(req.auth, store, type, id));
}));

apiRouter.post('/cleanup/delete-snapshot', wrap(async (req, res) => {
  const { store, type, id, time } = req.body || {};
  if (!store || !type || !id || !time) return res.status(400).json({ error: 'Faltan parámetros' });
  res.json(await pbs.deleteSnapshotItem(req.auth, store, type, id, time));
}));

apiRouter.post('/cleanup/gc', wrap(async (req, res) => {
  const { store } = req.body || {};
  if (!store) return res.status(400).json({ error: 'Falta store' });
  res.json({ upid: await pbs.runGarbageCollection(req.auth, store) });
}));

// --- Informes --------------------------------------------------------------

apiRouter.use('/reports', reportsRouter);
