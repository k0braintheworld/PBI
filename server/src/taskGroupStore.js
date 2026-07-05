// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Grupos de tareas para el resumen agrupado por email. En vez de un correo por
 * tarea, el usuario define grupos con miembros concretos (jobs de copia PVE y
 * jobs verify/prune/sync/GC de PBS); cuando TODOS los miembros de un grupo
 * terminan su ejecución (cada uno con desenlace ok o fallo), PBI envía un único
 * correo de resumen del grupo. El estado del ciclo en curso se persiste aquí
 * para sobrevivir a reinicios.
 *
 * Estructura del fichero (task-groups.json, 0600):
 *   { groups: [ { id, name, enabled, notifyOk, maxWaitHours, members: [
 *                   { kind, scope, ref, label } ] } ],
 *     cycles: { [groupId]: { startedAt, members: { [key]: {...} } } } }
 *
 *   kind:  'backup' | 'verify' | 'prune' | 'sync' | 'gc'
 *   scope: id del PVE (backup) o del host PBS (verify/prune/sync/gc)
 *   ref:   id del job (backup/verify/prune/sync) o datastore (gc)
 */

const FILE = path.join(config.dataDir, 'task-groups.json');
const EMPTY = { groups: [], cycles: {} };

const KINDS = ['backup', 'verify', 'prune', 'sync', 'gc'];

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(EMPTY, null, 2), { mode: 0o600 });
}

function readAll() {
  ensure();
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { groups: Array.isArray(d.groups) ? d.groups : [], cycles: d.cycles && typeof d.cycles === 'object' ? d.cycles : {} };
  } catch { return { ...EMPTY }; }
}

function writeAll(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Clave estable de un miembro dentro de un ciclo. */
export const memberKey = (m) => `${m.kind}:${m.scope}:${m.ref}`;

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

function normalizeMember(m) {
  if (!m || !KINDS.includes(m.kind)) throw httpErr(400, `Miembro inválido: ${m?.kind}`);
  if (!m.scope || !m.ref) throw httpErr(400, 'Cada miembro necesita scope (host/PVE) y ref (job/datastore)');
  return { kind: m.kind, scope: String(m.scope), ref: String(m.ref), label: String(m.label || m.ref) };
}

function normalizeGroup(input, id) {
  const members = Array.isArray(input.members) ? input.members.map(normalizeMember) : [];
  if (!input.name || !String(input.name).trim()) throw httpErr(400, 'El grupo necesita un nombre');
  if (!members.length) throw httpErr(400, 'El grupo necesita al menos un miembro');
  return {
    id,
    name: String(input.name).trim(),
    enabled: input.enabled !== false,
    notifyOk: input.notifyOk !== false, // false = avisar solo si algo falló
    maxWaitHours: Math.max(1, Math.min(168, Number(input.maxWaitHours) || 24)),
    members,
  };
}

// --- Grupos (CRUD) ---------------------------------------------------------

export function listGroups() { return readAll().groups; }

export function createGroup(input) {
  const data = readAll();
  const g = normalizeGroup(input, crypto.randomUUID());
  data.groups.push(g);
  writeAll(data);
  return g;
}

export function updateGroup(id, input) {
  const data = readAll();
  const idx = data.groups.findIndex((g) => g.id === id);
  if (idx === -1) throw httpErr(404, 'Grupo no encontrado');
  const g = normalizeGroup({ ...data.groups[idx], ...input }, id);
  data.groups[idx] = g;
  delete data.cycles[id]; // cambiar los miembros invalida el ciclo en curso
  writeAll(data);
  return g;
}

export function deleteGroup(id) {
  const data = readAll();
  data.groups = data.groups.filter((g) => g.id !== id);
  delete data.cycles[id];
  writeAll(data);
  return { ok: true };
}

// --- Estado de ciclo (usado por el evaluador) ------------------------------

export function getCycles() { return readAll().cycles; }

export function setCycles(cycles) {
  const data = readAll();
  data.cycles = cycles || {};
  writeAll(data);
}

/** Conjunto de todas las refs de miembros de tipo backup en grupos habilitados. */
export function enabledGroups() { return readAll().groups.filter((g) => g.enabled && g.members.length); }
