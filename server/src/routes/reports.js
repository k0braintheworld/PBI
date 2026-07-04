// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as pbs from '../pbsService.js';

export const reportsRouter = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/reports/summary
 * Resumen ejecutivo del estado de los backups.
 */
reportsRouter.get('/summary', wrap(async (req, res) => {
  const overview = await pbs.getOverview(req.auth);
  const tasks = await pbs.listTasks(req.auth, { limit: 500 });

  const ok2 = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');
  const finished = tasks.filter((t) => t.endtime != null);
  const ok = finished.filter((t) => ok2(t.status)).length;
  const failed = finished.length - ok;
  const running = tasks.filter((t) => t.endtime == null).length;

  const byType = {};
  for (const t of tasks) {
    byType[t.type] = byType[t.type] || { total: 0, ok: 0, failed: 0 };
    byType[t.type].total += 1;
    if (t.endtime != null) {
      if (ok2(t.status)) byType[t.type].ok += 1;
      else byType[t.type].failed += 1;
    }
  }

  const totals = overview.reduce(
    (acc, d) => {
      acc.snapshots += d.snapshotCount;
      acc.failedVerifications += d.failedVerifications;
      acc.capacity += d.status?.total || 0;
      acc.used += d.status?.used || 0;
      return acc;
    },
    { snapshots: 0, failedVerifications: 0, capacity: 0, used: 0 },
  );

  res.json({
    generatedAt: req.now || null,
    datastores: overview,
    totals,
    tasks: { total: tasks.length, ok, failed, running, byType },
  });
}));

// --- Helpers CSV -----------------------------------------------------------

function toCsv(rows, columns) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // Anti inyección de fórmulas: una celda que empiece por = + - @ (o tab/CR) la
    // interpretaría Excel/Sheets como fórmula. Se antepone un apóstrofo para
    // neutralizarla sin alterar el valor visible.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.get(r))).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

const isoFromEpoch = (s) => (s ? new Date(s * 1000).toISOString() : '');

/**
 * GET /api/reports/snapshots.csv?store=<store>
 * Exporta los snapshots (de un datastore o de todos) a CSV.
 */
reportsRouter.get('/snapshots.csv', wrap(async (req, res) => {
  const stores = req.query.store
    ? [req.query.store]
    : (await pbs.listDatastores(req.auth)).map((d) => d.store);

  const rows = [];
  for (const store of stores) {
    const snaps = await pbs.listSnapshots(req.auth, store).catch(() => []);
    for (const s of snaps) rows.push({ store, ...s });
  }

  const csv = toCsv(rows, [
    { label: 'datastore', get: (r) => r.store },
    { label: 'tipo', get: (r) => r['backup-type'] },
    { label: 'id', get: (r) => r['backup-id'] },
    { label: 'fecha', get: (r) => isoFromEpoch(r['backup-time']) },
    { label: 'tamano_bytes', get: (r) => r.size },
    { label: 'propietario', get: (r) => r.owner },
    { label: 'verificacion', get: (r) => r.verification?.state || 'sin verificar' },
    { label: 'comentario', get: (r) => r.comment },
  ]);
  sendCsv(res, 'snapshots.csv', csv);
}));

/**
 * GET /api/reports/tasks.csv
 * Exporta el historial de tareas a CSV.
 */
reportsRouter.get('/tasks.csv', wrap(async (req, res) => {
  const tasks = await pbs.listTasks(req.auth, { limit: 1000 });
  const csv = toCsv(tasks, [
    { label: 'tipo', get: (r) => r.type },
    { label: 'id', get: (r) => r.id },
    { label: 'usuario', get: (r) => r.user },
    { label: 'inicio', get: (r) => isoFromEpoch(r.starttime) },
    { label: 'fin', get: (r) => isoFromEpoch(r.endtime) },
    { label: 'estado', get: (r) => (r.endtime == null ? 'en ejecución' : r.status) },
  ]);
  sendCsv(res, 'tasks.csv', csv);
}));
