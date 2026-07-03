// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as restoreStore from '../restoreStore.js';
import { runRestoreJobNow } from '../restoreScheduler.js';

/** CRUD de restauraciones programadas + ejecución inmediata. */
export const restoreJobsRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

restoreJobsRouter.get('/', (req, res) => res.json(restoreStore.listJobs()));

restoreJobsRouter.post('/', wrap(async (req, res) => {
  if (!req.body?.pveId || !req.body?.sourceVmid) return res.status(400).json({ error: 'Faltan pveId o VM origen' });
  res.json(restoreStore.addJob(req.body));
}));

restoreJobsRouter.put('/:id', wrap(async (req, res) => {
  const j = restoreStore.updateJob(req.params.id, req.body);
  if (!j) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json(j);
}));

restoreJobsRouter.delete('/:id', wrap(async (req, res) => {
  if (!restoreStore.deleteJob(req.params.id)) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json({ ok: true });
}));

// Ejecutar ahora (lanza la restauración inmediatamente; acción destructiva)
restoreJobsRouter.post('/:id/run', wrap(async (req, res) => {
  const job = restoreStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const upid = await runRestoreJobNow(job);
  res.json({ upid });
}));
