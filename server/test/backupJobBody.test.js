// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
// Cubre la lógica de construcción del cuerpo del trabajo de copia (frontend puro).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupJobBody } from '../../web/src/lib/backupJobBody.js';

const baseForm = () => ({
  schedule: '02:00', storage: 'pbs', mode: 'snapshot', enabled: true, comment: '',
  encrypt: false, selAll: false, vmids: new Set(['100']), keep: { daily: 7 },
  bwlimit: '', fleecing: false, fleeceStorage: '', maxWorkers: '',
});

test('editar un trabajo SIN encrypt no intenta borrar encrypt (regresión del bug de PVE)', () => {
  const job = { id: 'backup-1', vmid: '100', comment: 'x' }; // no tiene encrypt
  const body = buildBackupJobBody({ form: { ...baseForm(), comment: 'x' }, job, isNew: false });
  const del = (body.delete || '').split(',');
  assert.ok(!del.includes('encrypt'), `delete no debe incluir encrypt: ${body.delete}`);
});

test('desmarcar encrypt en un trabajo que SÍ lo tenía sí lo borra', () => {
  const job = { id: 'b', vmid: '100', encrypt: 1 };
  const body = buildBackupJobBody({ form: { ...baseForm(), encrypt: false }, job, isNew: false });
  assert.ok((body.delete || '').split(',').includes('encrypt'));
});

test('trabajo nuevo nunca envía delete', () => {
  const body = buildBackupJobBody({ form: { ...baseForm(), selAll: true }, job: {}, isNew: true });
  assert.equal(body.delete, undefined);
  assert.equal(body.all, 1);
});

test('cambiar de vmid a «todas» borra vmid (presente) pero no pool/encrypt (ausentes)', () => {
  const job = { id: 'b', vmid: '100,101' };
  const body = buildBackupJobBody({ form: { ...baseForm(), selAll: true }, job, isNew: false });
  const del = (body.delete || '').split(',');
  assert.ok(del.includes('vmid'));
  assert.ok(!del.includes('pool'));
  assert.ok(!del.includes('encrypt'));
});

test('opciones de rendimiento se serializan como espera PVE', () => {
  const form = { ...baseForm(), bwlimit: '51200', maxWorkers: '2', fleecing: true, fleeceStorage: 'local-lvm' };
  const body = buildBackupJobBody({ form, job: {}, isNew: true });
  assert.equal(body.bwlimit, 51200);
  assert.equal(body.performance, 'max-workers=2');
  assert.equal(body.fleecing, 'enabled=1,storage=local-lvm');
});

test('valores de rendimiento vacíos/0 no se envían y, al editar, se borran si existían', () => {
  const job = { id: 'b', vmid: '100', bwlimit: 51200, performance: 'max-workers=4' };
  const body = buildBackupJobBody({ form: { ...baseForm(), bwlimit: '0', maxWorkers: '' }, job, isNew: false });
  assert.equal(body.bwlimit, undefined);
  assert.equal(body.performance, undefined);
  const del = (body.delete || '').split(',');
  assert.ok(del.includes('bwlimit'));
  assert.ok(del.includes('performance'));
});
