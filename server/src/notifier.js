// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { listHostsRaw } from './hostStore.js';
import { authForHost } from './authResolver.js';
import { listTasks, getTaskLog, listDatastores, listSnapshots, getDatastoreStatus } from './pbsService.js';
import { getDefaultPve, listPveRaw } from './pveStore.js';
import { pveGuests, pveBackupJobs } from './pveService.js';
import * as notifyStore from './notifyStore.js';
import { getRaw as getReportCfg } from './reportStore.js';
import { sendMail, buildTaskEmail, buildRpoEmail, buildStorageEmail, buildDigestEmail, buildGroupSummaryEmail } from './mailer.js';
import { excludedSet } from './excludedVms.js';
import * as groupStore from './taskGroupStore.js';
import { ingest as ingestGroups, collectDue, matchesAnyMember } from './taskGroups.js';

/**
 * Vigilante en segundo plano (multi-host):
 *  - Tareas: sondea las tareas finalizadas de TODOS los hosts PBS y envía un
 *    email por cada una nueva (según la configuración). Dedupe por host+UPID.
 *  - RPO: avisa de máquinas sin copia completada en las últimas N horas.
 *  - Almacenamiento: avisa de datastores por encima del umbral de ocupación.
 *  - Resumen diario: un email a la hora configurada con el estado de las
 *    últimas 24 h (fallos, RPO, ocupación, máquinas sin proteger).
 */

const POLL_MS = 60_000;
const ALERT_EVERY_TICKS = 15; // RPO/almacenamiento: cada ~15 min
const isOk = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

async function getBackupDetails(auth, upid) {
  try {
    const result = await getTaskLog(auth, upid, { start: 0, limit: 40 });
    const lines = result?.data || [];
    const text = lines.map((l) => l.t || '').join('\n').toLowerCase();
    const backupMode = /client.incremental|previous.backup|incremental/.test(text) ? 'incremental'
      : /no.previous.backup|backup.type:\s*full|full.backup/.test(text) ? 'full' : null;
    const encrypted = /fingerprint|encryption.key|encrypted.snapshot/.test(text) ? true : null;
    return { backupMode, encrypted };
  } catch {
    return { backupMode: null, encrypted: null };
  }
}

const notified = new Set();
let guestCache = { ts: 0, map: {} };
let timer = null;
let running = false;
let tick = 0;

async function guestNames() {
  if (Date.now() - guestCache.ts < 300_000) return guestCache.map;
  try {
    const pve = getDefaultPve();
    if (!pve) { guestCache = { ts: Date.now(), map: {} }; return {}; }
    const guests = await pveGuests(pve);
    const map = {};
    for (const g of guests || []) map[String(g.vmid)] = g.name;
    guestCache = { ts: Date.now(), map };
    return map;
  } catch {
    guestCache = { ts: Date.now(), map: {} };
    return {};
  }
}

/** Última copia completada por grupo (vm/ct) en todos los datastores del host. */
async function backupFreshness(auth) {
  const stores = await listDatastores(auth);
  const results = await Promise.all(stores.map((ds) => listSnapshots(auth, ds.store).catch(() => [])));
  const byGroup = new Map();
  for (const snaps of results) {
    for (const s of snaps) {
      const type = s['backup-type'];
      if (type !== 'vm' && type !== 'ct') continue;
      const k = `${type}/${s['backup-id']}`;
      const t = s['backup-time'] || 0;
      const prev = byGroup.get(k);
      if (!prev || t > prev.last) byGroup.set(k, { type, id: String(s['backup-id']), last: t });
    }
  }
  return byGroup;
}

/** Ocupación por datastore del host. */
async function storageUsage(auth) {
  const stores = await listDatastores(auth);
  const st = await Promise.all(stores.map((ds) => getDatastoreStatus(auth, ds.store).catch(() => null)));
  return stores.map((ds, i) => {
    const s = st[i];
    const pct = s?.total ? Math.round((s.used / s.total) * 100) : null;
    return { store: ds.store, pct, used: s?.used, total: s?.total };
  }).filter((d) => d.pct != null);
}

// --- Notificación de tareas finalizadas (por host) --------------------------

async function pollTasksForHost(cfg, host, seenMap, names, sede, groupCtx) {
  const now = Math.floor(Date.now() / 1000);
  let lastSeen = seenMap[host.id];
  // Primera vez para este host: fijar línea base y no inundar con tareas viejas.
  if (!lastSeen) { seenMap[host.id] = now; return; }

  const auth = await authForHost(host);
  const tasks = await listTasks(auth, { limit: 500, since: lastSeen - 6 * 3600 });
  const fresh = (tasks || [])
    .filter((t) => t.endtime != null && t.endtime > lastSeen && (cfg.types || []).includes(t.type))
    .sort((a, b) => (a.endtime || 0) - (b.endtime || 0));
  if (!fresh.length) return;

  // Alimenta el evaluador de grupos con TODAS las tareas nuevas de este host.
  if (groupCtx?.groups.length) {
    ingestGroups({ groups: groupCtx.groups, cycles: groupCtx.cycles, hostId: host.id, tasks: fresh, now, expectedFor: groupCtx.expectedFor });
  }

  let maxEnd = lastSeen;
  for (const t of fresh) {
    maxEnd = Math.max(maxEnd, t.endtime);
    const ok = isOk(t.status);
    if ((ok && !cfg.notifyOk) || (!ok && !cfg.notifyFail)) continue;
    // Si la tarea pertenece a un grupo, no se envía email individual: la cubre el
    // resumen agrupado del grupo.
    if (groupCtx?.groups.length && matchesAnyMember(groupCtx.groups, t, host.id, groupCtx.expectedFor)) continue;
    const key = `${host.id}:${t.upid}`;
    if (notified.has(key)) continue;
    try {
      const { backupMode, encrypted } = t.type === 'backup' ? await getBackupDetails(auth, t.upid) : {};
      const mail = buildTaskEmail(t, { hostName: host.name, names, sede, backupMode, encrypted });
      await sendMail(cfg.smtp, mail);
      notified.add(key);
    } catch (e) {
      console.error('[notifier] error enviando email:', e.message);
    }
  }
  if (maxEnd > lastSeen) seenMap[host.id] = maxEnd;
}

/**
 * Resuelve, para los miembros de tipo backup de los grupos habilitados, el
 * conjunto de VMIDs esperados (a partir del job de copia en PVE). Devuelve un
 * mapa memberKey -> [vmid]. Un job `all` se expande al inventario de invitados.
 */
async function resolveBackupExpected(groups) {
  const map = {};
  const backupMembers = groups.flatMap((g) => g.members).filter((m) => m.kind === 'backup');
  if (!backupMembers.length) return map;

  const pves = listPveRaw();
  const jobCache = new Map(); // pveId -> [jobs]
  const guestCache = new Map(); // pveId -> [vmid]
  for (const m of backupMembers) {
    const pve = pves.find((p) => p.id === m.scope);
    if (!pve) continue;
    try {
      if (!jobCache.has(pve.id)) jobCache.set(pve.id, (await pveBackupJobs(pve)) || []);
      const job = jobCache.get(pve.id).find((j) => String(j.id) === String(m.ref));
      if (!job) continue;
      const exclude = new Set(String(job.exclude || '').split(',').map((s) => s.trim()).filter(Boolean));
      let vmids;
      if (job.all === 1 || job.all === '1') {
        if (!guestCache.has(pve.id)) {
          const guests = await pveGuests(pve).catch(() => []);
          guestCache.set(pve.id, (guests || []).filter((g) => !g.template).map((g) => String(g.vmid)));
        }
        vmids = guestCache.get(pve.id);
      } else {
        vmids = String(job.vmid || '').split(',').map((s) => s.trim()).filter(Boolean);
      }
      map[groupStore.memberKey(m)] = vmids.filter((v) => !exclude.has(String(v)));
    } catch { /* PVE no disponible: sin conjunto esperado (el grupo esperará al maxWait) */ }
  }
  return map;
}

// --- Avisos proactivos (RPO + almacenamiento) --------------------------------

async function checkAlerts(cfg, hosts, names, sede) {
  const now = Math.floor(Date.now() / 1000);
  const today = todayKey();
  const state = notifyStore.getRaw().state || {};

  if (cfg.rpo?.enabled) {
    const hours = Number(cfg.rpo.hours) || 26;
    const out = [];
    for (const host of hosts) {
      try {
        const auth = await authForHost(host);
        const fresh = await backupFreshness(auth);
        for (const g of fresh.values()) {
          if (now - (g.last || 0) > hours * 3600) out.push({ ...g, host: host.name, hostId: host.id });
        }
      } catch { /* host inaccesible: se avisará por otra vía */ }
    }
    const alerted = { ...(state.rpoAlerted || {}) };
    const freshOnes = out.filter((m) => alerted[`${m.hostId}/${m.type}/${m.id}`] !== today);
    if (freshOnes.length) {
      try {
        await sendMail(cfg.smtp, buildRpoEmail(out, { sede, hours, names }));
        for (const m of out) alerted[`${m.hostId}/${m.type}/${m.id}`] = today;
        notifyStore.setState({ rpoAlerted: alerted });
      } catch (e) { console.error('[notifier] error email RPO:', e.message); }
    }
  }

  if (cfg.storageAlert?.enabled) {
    const percent = Number(cfg.storageAlert.percent) || 85;
    const hot = [];
    for (const host of hosts) {
      try {
        const auth = await authForHost(host);
        for (const d of await storageUsage(auth)) {
          if (d.pct >= percent) hot.push({ ...d, host: host.name, hostId: host.id });
        }
      } catch { /* ignore */ }
    }
    const alerted = { ...(state.storageAlerted || {}) };
    const freshOnes = hot.filter((d) => alerted[`${d.hostId}/${d.store}`] !== today);
    if (freshOnes.length) {
      try {
        await sendMail(cfg.smtp, buildStorageEmail(hot, { sede, percent }));
        for (const d of hot) alerted[`${d.hostId}/${d.store}`] = today;
        notifyStore.setState({ storageAlerted: alerted });
      } catch (e) { console.error('[notifier] error email almacenamiento:', e.message); }
    }
  }
}

// --- Resumen diario -----------------------------------------------------------

async function sendDigestIfDue(cfg, hosts, names, sede) {
  if (!cfg.digest?.enabled) return;
  const blocks = {
    tasks: cfg.digest.tasks !== false,
    rpo: cfg.digest.rpo !== false,
    storage: cfg.digest.storage !== false,
    unprotected: cfg.digest.unprotected !== false,
  };
  const today = todayKey();
  const state = notifyStore.getRaw().state || {};
  if (state.lastDigest === today) return;
  const nowHM = new Date().toTimeString().slice(0, 5);
  if (nowHM < (cfg.digest.time || '08:00')) return;

  const now = Math.floor(Date.now() / 1000);
  const rpoHours = Number(cfg.rpo?.hours) || 26;
  const sections = [];
  const protectedIds = new Set();

  for (const host of hosts) {
    try {
      const auth = await authForHost(host);
      const needFresh = blocks.rpo || blocks.unprotected;
      const [tasks, fresh, storage] = await Promise.all([
        blocks.tasks ? listTasks(auth, { limit: 2000, since: now - 24 * 3600 }).catch(() => []) : [],
        needFresh ? backupFreshness(auth) : new Map(),
        blocks.storage ? storageUsage(auth) : [],
      ]);
      const done = (tasks || []).filter((t) => t.endtime != null && t.endtime > now - 24 * 3600);
      const failures = done.filter((t) => !isOk(t.status)).slice(0, 10)
        .map((t) => ({ type: t.type, id: t.id, status: t.status }));
      const outOfRpo = blocks.rpo ? [...fresh.values()].filter((g) => now - (g.last || 0) > rpoHours * 3600) : [];
      for (const g of fresh.values()) protectedIds.add(String(g.id));
      sections.push({
        host: host.name || host.host,
        ok: done.filter((t) => isOk(t.status)).length,
        fail: done.length - done.filter((t) => isOk(t.status)).length,
        failures,
        outOfRpo,
        storage,
      });
    } catch (e) {
      sections.push({ host: host.name || host.host, ok: 0, fail: 0, failures: [{ type: 'conexión', id: '—', status: e.message }], outOfRpo: [], storage: [] });
    }
  }

  // Máquinas de PVE sin ninguna copia en ningún host PBS (excluye plantillas y las
  // marcadas como "sin copia necesaria")
  let unprotected = [];
  try {
    if (!blocks.unprotected) throw new Error('skip');
    const pve = getDefaultPve();
    if (pve) {
      const excluded = excludedSet();
      const guests = await pveGuests(pve);
      unprotected = (guests || [])
        .filter((g) => !g.template && !protectedIds.has(String(g.vmid)) && !excluded.has(String(g.vmid)))
        .map((g) => ({ vmid: g.vmid, name: g.name || '' }));
    }
  } catch { /* ignore */ }

  try {
    await sendMail(cfg.smtp, buildDigestEmail({ sections, unprotected, names }, { sede, blocks }));
    notifyStore.setState({ lastDigest: today });
  } catch (e) { console.error('[notifier] error resumen diario:', e.message); }
}

// --- Bucle principal ----------------------------------------------------------

async function poll() {
  if (running) return;
  running = true;
  try {
    const cfg = notifyStore.getRaw();
    if (!cfg.enabled || !cfg.smtp?.host || !cfg.smtp?.to) return;

    const hosts = listHostsRaw();
    if (!hosts.length) return;

    const names = await guestNames();
    const sede = getReportCfg()?.sede || '';

    // Mapa de última tarea vista por host (migra el formato antiguo: un número global)
    const st = cfg.state || {};
    const seenMap = (st.lastSeen && typeof st.lastSeen === 'object') ? { ...st.lastSeen } : {};
    if (typeof st.lastSeen === 'number') for (const h of hosts) seenMap[h.id] = seenMap[h.id] || st.lastSeen;

    // Contexto de grupos de tareas (resumen agrupado). Se resuelven los VMIDs
    // esperados de los miembros de backup una vez por sondeo.
    const enabledGroups = groupStore.enabledGroups();
    let groupCtx = null;
    if (enabledGroups.length) {
      const expectedMap = await resolveBackupExpected(enabledGroups);
      groupCtx = {
        groups: enabledGroups,
        cycles: groupStore.getCycles(),
        expectedFor: (m) => expectedMap[groupStore.memberKey(m)] || [],
      };
    }

    for (const host of hosts) {
      try { await pollTasksForHost(cfg, host, seenMap, names, sede, groupCtx); }
      catch (e) { console.error(`[notifier] ${host.name || host.id}:`, e.message); }
    }
    notifyStore.setState({ lastSeen: seenMap });

    // Envía los resúmenes de grupo que estén listos (completos o vencidos) y
    // persiste el estado de los ciclos.
    if (groupCtx) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const due = collectDue({ groups: groupCtx.groups, cycles: groupCtx.cycles, now });
        for (const { group, summary } of due) {
          if (!group.notifyOk && summary.totFail === 0) continue; // "solo si algo falla" y no hubo fallos
          try { await sendMail(cfg.smtp, buildGroupSummaryEmail(summary, { sede, names })); }
          catch (e) { console.error('[notifier] error enviando resumen de grupo:', e.message); }
        }
      } finally {
        groupStore.setCycles(groupCtx.cycles);
      }
    }

    tick += 1;
    if (tick % ALERT_EVERY_TICKS === 1) await checkAlerts(cfg, hosts, names, sede);
    await sendDigestIfDue(cfg, hosts, names, sede);
  } catch (e) {
    console.error('[notifier] error en el sondeo:', e.message);
  } finally {
    running = false;
  }
}

export function startNotifier() {
  if (timer) return;
  timer = setInterval(poll, POLL_MS);
  // Primer sondeo a los 5s del arranque (para fijar la línea base pronto).
  setTimeout(poll, 5000);
  console.log(`  Notificaciones: vigilante activo (sondeo cada ${POLL_MS / 1000}s, multi-host)`);
}
