// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import { resolveAuth } from '../authResolver.js';
import * as pbs from '../pbsService.js';
import { getDefaultPve } from '../pveStore.js';
import { pveGuests } from '../pveService.js';
import { reportsRouter } from './reports.js';
import { requireOperator } from '../session.js';
import { audit } from '../auditLog.js';
import * as excludedVms from '../excludedVms.js';
import { excludedSet } from '../excludedVms.js';
import { createSwrCache } from '../swrCache.js';

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

// Caché stale-while-revalidate por host: si PBS va lento (p. ej. durante un
// backup), el panel sigue mostrando el último estado al instante y se refresca en
// segundo plano, en vez de quedarse "cargando". Clave = id del host activo.
const dashCache = createSwrCache({ freshMs: 8000, staleMs: 60000 });

apiRouter.get('/dashboard', wrap(async (req, res) => {
  const dash = await dashCache.get(req.pbsHost.id, async () => {
    const d = await pbs.getDashboard(req.auth);
    // Máquinas de PVE sin ninguna copia en este PBS (excluye plantillas y las
    // marcadas como "sin copia necesaria").
    try {
      const pve = getDefaultPve();
      if (pve) {
        const ids = new Set(d.protectedIds || []);
        const excluded = excludedSet();
        const guests = await pveGuests(pve);
        d.unprotected = (guests || [])
          .filter((g) => !g.template && !ids.has(String(g.vmid)) && !excluded.has(String(g.vmid)))
          .map((g) => ({ vmid: g.vmid, name: g.name || '', type: g.type }));
      }
    } catch { /* sin PVE o inaccesible: omitir */ }
    return d;
  });
  res.json(dash);
}));

// --- VMs marcadas como "sin copia necesaria" (no cuentan como sin proteger) ----
apiRouter.get('/excluded-vms', (req, res) => res.json(excludedVms.list()));

apiRouter.post('/excluded-vms', requireOperator, wrap(async (req, res) => {
  const out = excludedVms.add(req.body || {});
  dashCache.invalidate(); // el cambio afecta a la lista de "sin proteger" del dashboard
  audit(req, 'excluded_vm.add', String(req.body?.vmid || ''), 'ok', `VM ${req.body?.vmid} marcada sin copia necesaria`);
  res.json(out);
}));

apiRouter.delete('/excluded-vms/:vmid', requireOperator, wrap(async (req, res) => {
  const out = excludedVms.remove(req.params.vmid);
  dashCache.invalidate();
  audit(req, 'excluded_vm.remove', req.params.vmid, 'ok', `VM ${req.params.vmid} vuelve a vigilarse`);
  res.json(out);
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

apiRouter.post('/jobs/:kind', requireOperator, wrap(async (req, res) => {
  const r = await pbs.createJob(req.auth, req.params.kind, req.body);
  audit(req, 'job.create', `${req.params.kind}:${req.body?.id || ''}`, 'ok');
  res.json(r);
}));

apiRouter.put('/jobs/:kind/:id', requireOperator, wrap(async (req, res) => {
  const r = await pbs.updateJob(req.auth, req.params.kind, req.params.id, req.body);
  audit(req, 'job.update', `${req.params.kind}:${req.params.id}`, 'ok');
  res.json(r);
}));

apiRouter.delete('/jobs/:kind/:id', requireOperator, wrap(async (req, res) => {
  const r = await pbs.deleteJob(req.auth, req.params.kind, req.params.id);
  audit(req, 'job.delete', `${req.params.kind}:${req.params.id}`, 'ok');
  res.json(r);
}));

apiRouter.post('/jobs/:kind/:id/run', requireOperator, wrap(async (req, res) => {
  const upid = await pbs.runJob(req.auth, req.params.kind, req.params.id);
  audit(req, 'job.run', `${req.params.kind}:${req.params.id}`, 'ok', String(upid || ''));
  res.json({ upid });
}));

// --- Tareas ----------------------------------------------------------------

apiRouter.get('/tasks', wrap(async (req, res) => {
  const { limit, running, store, type, since, until } = req.query;
  res.json(await pbs.listTasks(req.auth, {
    limit: limit ? Number(limit) : undefined,
    running: running === '1' || running === 'true',
    store,
    type,
    since: since ? Number(since) : undefined,
    until: until ? Number(until) : undefined,
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

// Detener una tarea en ejecución (operador+).
apiRouter.post('/tasks/:upid/stop', requireOperator, wrap(async (req, res) => {
  await pbs.stopTask(req.auth, req.params.upid);
  audit(req, 'task.stop', req.params.upid, 'ok', 'Tarea detenida desde el monitor');
  res.json({ ok: true });
}));

// Calendario de copias por día para un mes/rango (YYYY-MM-DD)
apiRouter.get('/calendar', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Faltan from/to' });
  res.json(await pbs.getBackupCalendar(req.auth, { from, to }));
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

apiRouter.post('/cleanup/delete-group', requireOperator, wrap(async (req, res) => {
  const { store, type, id, ns } = req.body || {};
  if (!store || !type || !id) return res.status(400).json({ error: 'Faltan store, type o id' });
  const r = await pbs.deleteBackupGroup(req.auth, store, type, id, ns);
  audit(req, 'cleanup.delete_group', `${store}/${ns ? `${ns}/` : ''}${type}/${id}`, 'ok');
  res.json(r);
}));

apiRouter.post('/cleanup/delete-snapshot', requireOperator, wrap(async (req, res) => {
  const { store, type, id, time, ns } = req.body || {};
  if (!store || !type || !id || !time) return res.status(400).json({ error: 'Faltan parámetros' });
  const r = await pbs.deleteSnapshotItem(req.auth, store, type, id, time, ns);
  audit(req, 'cleanup.delete_snapshot', `${store}/${ns ? `${ns}/` : ''}${type}/${id}@${time}`, 'ok');
  res.json(r);
}));

apiRouter.post('/cleanup/gc', requireOperator, wrap(async (req, res) => {
  const { store } = req.body || {};
  if (!store) return res.status(400).json({ error: 'Falta store' });
  const upid = await pbs.runGarbageCollection(req.auth, store);
  audit(req, 'cleanup.gc', store, 'ok');
  res.json({ upid });
}));

// Programación del GC (gc-schedule del datastore)
apiRouter.get('/cleanup/gc-schedule', wrap(async (req, res) => {
  const store = req.query.store;
  if (!store) return res.status(400).json({ error: 'Falta store' });
  const cfg = await pbs.getDatastoreConfig(req.auth, store).catch(() => ({}));
  res.json({ store, schedule: cfg?.['gc-schedule'] || '' });
}));

apiRouter.put('/cleanup/gc-schedule', requireOperator, wrap(async (req, res) => {
  const { store, schedule } = req.body || {};
  if (!store) return res.status(400).json({ error: 'Falta store' });
  await pbs.setDatastoreGcSchedule(req.auth, store, schedule);
  audit(req, 'cleanup.gc_schedule', store, 'ok', schedule ? `Programado: ${schedule}` : 'Desactivado');
  res.json({ store, schedule: String(schedule || '').trim() });
}));

// --- Informes --------------------------------------------------------------

apiRouter.use('/reports', reportsRouter);
