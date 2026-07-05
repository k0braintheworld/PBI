// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { memberKey } from './taskGroupStore.js';

/**
 * Evaluador de grupos de tareas (lógica pura y testable). El notifier le entrega
 * las tareas completadas de cada host y una función para resolver los VMIDs
 * esperados de un miembro de tipo backup; el evaluador acumula el estado del
 * ciclo y decide cuándo un grupo está listo para su correo de resumen.
 *
 * Un miembro se considera "terminado" cuando cada unidad tiene desenlace:
 *  - backup: cada VMID esperado tiene una copia completada (ok) o fallida.
 *  - verify/prune/sync/gc: la tarea correspondiente ha finalizado (ok o fallo).
 * Cuando TODOS los miembros terminan → resumen "completo". Si vence maxWaitHours
 * desde el inicio del ciclo sin completarse → resumen "parcial" (con lo pendiente).
 */

const isOk = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');

// Alias de worker types de PBS a las cinco categorías que maneja PBI.
const KIND_ALIASES = {
  backup: ['backup'],
  verify: ['verify', 'verification', 'verificationjob'],
  prune: ['prune', 'prunejob'],
  sync: ['sync', 'syncjob'],
  gc: ['garbage_collection', 'gc'],
};
const typeMatchesKind = (type, kind) => (KIND_ALIASES[kind] || [kind]).includes(String(type || '').toLowerCase());

/** Extrae el VMID de un task.id de PBS del estilo "store:vm/100" o "…-ct-101". */
export const vmidFromTask = (id) => {
  const m = /(?:vm|ct|qemu|lxc)[/-](\d+)/i.exec(id || '') || /:(\d+)(?:\/|$)/.exec(id || '');
  return m ? m[1] : null;
};
/** Decodifica el datastore de un task.id de GC (suele ser el propio nombre). */
const storeFromTask = (id) => String(id || '').split(':')[0] || String(id || '');

/**
 * ¿Esta tarea completada corresponde a este miembro?
 * Para backup devuelve el VMID (para cotejar con el conjunto esperado); para el
 * resto devuelve true/false. `hostId` es el host PBS donde se vio la tarea.
 */
function matchTaskToMember(member, task, hostId) {
  if (member.kind === 'backup') {
    if (!typeMatchesKind(task.type, 'backup')) return null;
    return vmidFromTask(task.id); // el llamador comprueba si está en el conjunto esperado
  }
  if (member.scope !== hostId) return false;
  if (!typeMatchesKind(task.type, member.kind)) return false;
  if (member.kind === 'gc') return storeFromTask(task.id) === member.ref;
  // verify/prune/sync: la tarea programada lleva el id del job en su worker id.
  const tid = String(task.id || '');
  return tid === member.ref || tid.includes(member.ref);
}

/**
 * ¿Esta tarea (en este host) pertenece a algún miembro de algún grupo habilitado?
 * Se usa para NO enviar el email individual de una tarea que ya cubre un grupo.
 * Para backups requiere que el VMID esté en el conjunto esperado del miembro.
 */
export function matchesAnyMember(groups, task, hostId, expectedFor) {
  for (const g of groups) {
    for (const m of g.members) {
      const match = matchTaskToMember(m, task, hostId);
      if (match === false || match == null) continue;
      if (m.kind === 'backup') {
        const expected = (expectedFor(m) || []).map(String);
        if (expected.includes(String(match))) return true;
      } else return true;
    }
  }
  return false;
}

function ensureCycle(cycles, group, expectedFor, now) {
  if (!cycles[group.id]) cycles[group.id] = { startedAt: now, members: {} };
  const cyc = cycles[group.id];
  for (const m of group.members) {
    const k = memberKey(m);
    if (!cyc.members[k]) {
      const expected = m.kind === 'backup' ? (expectedFor(m) || []) : null;
      cyc.members[k] = { kind: m.kind, label: m.label, ref: m.ref, expected, ok: [], fail: [] };
    }
  }
  return cyc;
}

const seenUnit = (ms, unit) => ms.ok.includes(unit) || ms.fail.some((f) => f.id === unit);

/** ¿El miembro ha terminado (todas sus unidades con desenlace)? */
export function memberDone(ms) {
  if (ms.kind === 'backup') {
    if (!ms.expected || !ms.expected.length) return false; // sin VMIDs esperados no se puede cerrar
    return ms.expected.every((v) => seenUnit(ms, String(v)));
  }
  return ms.ok.length > 0 || ms.fail.length > 0;
}

/**
 * Ingiere las tareas completadas de un host y actualiza el estado de los ciclos.
 * Muta `cycles`. `expectedFor(member) -> string[]` resuelve los VMIDs de backups.
 */
export function ingest({ groups, cycles, hostId, tasks, now, expectedFor }) {
  for (const t of tasks) {
    if (t.endtime == null) continue;
    const ok = isOk(t.status);
    for (const g of groups) {
      for (const m of g.members) {
        const match = matchTaskToMember(m, t, hostId);
        if (match === false || match == null) continue;
        const cyc = ensureCycle(cycles, g, expectedFor, now);
        const ms = cyc.members[memberKey(m)];
        const unit = m.kind === 'backup' ? String(match) : m.ref;
        if (m.kind === 'backup' && ms.expected && !ms.expected.map(String).includes(unit)) continue; // VM ajena al job
        if (seenUnit(ms, unit)) continue; // ya registrada esta unidad en el ciclo
        if (ok) ms.ok.push(unit);
        else ms.fail.push({ id: unit, status: t.status || 'error' });
      }
    }
  }
}

/** Construye el objeto de resumen de un ciclo (para el email). */
function summarize(group, cyc, complete) {
  const members = group.members.map((m) => {
    const ms = cyc.members[memberKey(m)] || { kind: m.kind, label: m.label, ok: [], fail: [], expected: null };
    const pending = m.kind === 'backup' && ms.expected
      ? ms.expected.map(String).filter((v) => !seenUnit(ms, v))
      : (memberDone(ms) ? [] : [m.ref]);
    return {
      kind: m.kind,
      label: m.label,
      ok: ms.ok.slice(),
      fail: ms.fail.slice(),
      pending,
      done: memberDone(ms),
    };
  });
  const totFail = members.reduce((a, m) => a + m.fail.length, 0);
  const totOk = members.reduce((a, m) => a + m.ok.length, 0);
  return { groupName: group.name, complete, members, totOk, totFail, startedAt: cyc.startedAt };
}

/**
 * Recorre los grupos y devuelve los resúmenes listos para enviar, eliminando su
 * ciclo (reset). Un grupo se dispara si todos sus miembros terminaron (completo)
 * o si venció su maxWaitHours (parcial). Muta `cycles`.
 * Devuelve [{ group, summary }].
 */
export function collectDue({ groups, cycles, now }) {
  const due = [];
  for (const g of groups) {
    const cyc = cycles[g.id];
    if (!cyc) continue;
    const allDone = g.members.every((m) => memberDone(cyc.members[memberKey(m)] || {}));
    const timedOut = now - (cyc.startedAt || now) > (g.maxWaitHours || 24) * 3600;
    if (!allDone && !timedOut) continue;
    due.push({ group: g, summary: summarize(g, cyc, allDone) });
    delete cycles[g.id]; // reset del ciclo
  }
  return due;
}
