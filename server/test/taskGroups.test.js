// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, collectDue, matchesAnyMember, memberDone, vmidFromTask } from '../src/taskGroups.js';

const group = () => ({
  id: 'g1', name: 'Nocturno', enabled: true, notifyOk: true, maxWaitHours: 24,
  members: [
    { kind: 'backup', scope: 'pve1', ref: 'backup-1', label: 'Críticas' },
    { kind: 'verify', scope: 'host1', ref: 'v-abc', label: 'Verify' },
  ],
});
const expected = { 'backup:pve1:backup-1': ['100', '101'] };
const expectedFor = (m) => expected[`backup:${m.scope}:${m.ref}`] || [];

test('vmidFromTask extrae el VMID del id de tarea de PBS', () => {
  assert.equal(vmidFromTask('store:vm/100'), '100');
  assert.equal(vmidFromTask('store:ct/101'), '101');
  assert.equal(vmidFromTask('algo-sin-vmid'), null);
});

test('un backup termina cuando TODAS sus VMs tienen desenlace (ok o fallo)', () => {
  const groups = [group()]; const cycles = {};
  ingest({ groups, cycles, hostId: 'host1', now: 1000, expectedFor, tasks: [{ type: 'backup', id: 'store:vm/100', endtime: 900, status: 'OK' }] });
  assert.equal(collectDue({ groups, cycles: structuredClone(cycles), now: 1000 }).length, 0);
  ingest({ groups, cycles, hostId: 'host1', now: 1000, expectedFor, tasks: [{ type: 'backup', id: 'store:vm/101', endtime: 950, status: 'err: disk full' }] });
  assert.ok(memberDone(cycles.g1.members['backup:pve1:backup-1']));
});

test('el grupo dispara solo cuando TODOS los miembros terminan; resumen con conteos', () => {
  const groups = [group()]; const cycles = {};
  ingest({ groups, cycles, hostId: 'host1', now: 1000, expectedFor, tasks: [
    { type: 'backup', id: 'store:vm/100', endtime: 900, status: 'OK' },
    { type: 'backup', id: 'store:vm/101', endtime: 950, status: 'err' },
  ] });
  assert.equal(collectDue({ groups, cycles: structuredClone(cycles), now: 1000 }).length, 0); // falta verify
  ingest({ groups, cycles, hostId: 'host1', now: 1000, expectedFor, tasks: [{ type: 'verify', id: 'v-abc', endtime: 980, status: 'OK' }] });
  const due = collectDue({ groups, cycles, now: 1000 });
  assert.equal(due.length, 1);
  assert.equal(due[0].summary.complete, true);
  assert.equal(due[0].summary.totOk, 2);   // VM100 + verify
  assert.equal(due[0].summary.totFail, 1); // VM101
  assert.equal(cycles.g1, undefined);      // ciclo reseteado tras disparar
});

test('timeout: resumen parcial con lo pendiente', () => {
  const groups = [group()]; const cycles = {};
  ingest({ groups, cycles, hostId: 'host1', now: 1000, expectedFor, tasks: [
    { type: 'backup', id: 'store:vm/100', endtime: 900, status: 'OK' },
    { type: 'backup', id: 'store:vm/101', endtime: 900, status: 'OK' },
  ] });
  const due = collectDue({ groups, cycles, now: 1000 + 25 * 3600 });
  assert.equal(due.length, 1);
  assert.equal(due[0].summary.complete, false);
  assert.deepEqual(due[0].summary.members.find((m) => m.kind === 'verify').pending, ['v-abc']);
});

test('matchesAnyMember credita solo las VMs esperadas del job', () => {
  const groups = [group()];
  assert.equal(matchesAnyMember(groups, { type: 'backup', id: 'store:vm/100' }, 'host1', expectedFor), true);
  assert.equal(matchesAnyMember(groups, { type: 'backup', id: 'store:vm/999' }, 'host1', expectedFor), false);
  assert.equal(matchesAnyMember(groups, { type: 'verify', id: 'v-abc' }, 'host1', expectedFor), true);
  assert.equal(matchesAnyMember(groups, { type: 'verify', id: 'v-abc' }, 'otro-host', expectedFor), false);
});
