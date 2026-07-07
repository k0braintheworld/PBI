// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Construye el cuerpo que se envía a PVE (/cluster/backup) al crear o editar un
 * trabajo de copia. Lógica PURA y sin dependencias, para poder cubrirla con tests
 * (aquí vivía el bug "delete: unknown option 'encrypt'": se intentaba borrar en
 * PVE una opción que el trabajo no tenía).
 *
 * `form`  — estado del formulario del editor.
 * `job`   — trabajo original de PVE (para saber qué campos existían); {} si es nuevo.
 * `isNew` — true al crear (nunca se envía `delete`).
 */
const KEEP = ['last', 'daily', 'weekly', 'monthly', 'yearly'];

export function buildBackupJobBody({ form, job = {}, isNew }) {
  const keep = form.keep || {};
  const prune = KEEP.map((k) => (keep[k] ? `keep-${k}=${keep[k]}` : null)).filter(Boolean).join(',');

  const body = {
    schedule: form.schedule,
    storage: form.storage,
    mode: form.mode,
    enabled: form.enabled ? 1 : 0,
    comment: form.comment || '',
    compress: 'zstd',
  };
  if (form.encrypt) body.encrypt = 1;
  if (prune) body['prune-backups'] = prune;

  const bw = parseInt(form.bwlimit, 10);
  const hasBw = Number.isFinite(bw) && bw > 0;
  if (hasBw) body.bwlimit = bw;
  if (form.fleecing) body.fleecing = `enabled=1,storage=${form.fleeceStorage}`;
  const mw = parseInt(form.maxWorkers, 10);
  const hasMw = Number.isFinite(mw) && mw > 0;
  if (hasMw) body.performance = `max-workers=${mw}`;

  // Selección de máquinas (all vs vmid): siempre se fija una.
  if (form.selAll) body.all = 1;
  else body.vmid = [...(form.vmids || [])].join(',');

  // Campos opcionales a limpiar. Solo se incluyen en `delete` los que REALMENTE
  // existían en el trabajo: PVE rechaza borrar una opción que el job no tiene.
  const has = (k) => job[k] !== undefined && job[k] !== null && job[k] !== '';
  const maybeDelete = [];
  if (form.selAll) maybeDelete.push('vmid', 'pool'); else maybeDelete.push('all', 'pool');
  if (!prune) maybeDelete.push('prune-backups');
  if (!form.comment) maybeDelete.push('comment');
  if (!form.encrypt) maybeDelete.push('encrypt');
  if (!hasBw) maybeDelete.push('bwlimit');
  if (!form.fleecing) maybeDelete.push('fleecing');
  if (!hasMw) maybeDelete.push('performance');
  if (!isNew) {
    const del = maybeDelete.filter(has);
    if (del.length) body.delete = del.join(',');
  }

  return body;
}
