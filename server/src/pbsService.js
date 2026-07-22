// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { config } from './config.js';
import { pbsCall } from './pbsClient.js';

/**
 * Capa de servicio de alto nivel.
 *
 * Cada función recibe el contexto de auth de la sesión y llama a la API real
 * de PBS (pbsClient). Así las rutas Express no necesitan saber el origen de los
 * datos.
 */

const nodeOf = (auth) => auth?.node || config.pbs.node;

// PBS devuelve algunos códigos escapados como \xHH (p.ej. \x3a -> ':')
const decodePbs = (s) =>
  typeof s === 'string' ? s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;

// La API de PBS usa worker_type/worker_id; normalizamos a type/id para la UI.
const normalizeTask = (t) => ({
  ...t,
  type: t.type || t.worker_type || 'unknown',
  id: decodePbs(t.id ?? t.worker_id ?? ''),
});

// PBS marca 'OK' los éxitos limpios y 'WARNINGS: n' los completados con avisos;
// ambos cuentan como copia correcta (igual que la interfaz oficial).
const isTaskOk = (status) => status === 'OK' || /^WARNINGS/i.test(status || '');

// ---------------------------------------------------------------------------
// Información general / datastores
// ---------------------------------------------------------------------------

export async function getVersion(auth) {
  return pbsCall(auth, { path: '/version' });
}

export async function listDatastores(auth) {
  return pbsCall(auth, { path: '/admin/datastore' });
}

export async function getDatastoreStatus(auth, store) {
  return pbsCall(auth, { path: `/admin/datastore/${encodeURIComponent(store)}/status` });
}

/**
 * Namespaces de un datastore (incluye SIEMPRE el raíz ''). PBS solo devuelve el
 * namespace raíz si no se le pasa `ns`, así que hay que enumerarlos y consultar
 * cada uno. En PBS sin namespaces (o sin el endpoint) cae a solo el raíz.
 */
export async function listNamespaces(auth, store) {
  const base = `/admin/datastore/${encodeURIComponent(store)}/namespace`;
  let res;
  try { res = await pbsCall(auth, { path: base, query: { 'max-depth': 7 } }); }
  catch { try { res = await pbsCall(auth, { path: base }); } catch { return ['']; } }
  const list = Array.isArray(res) ? res.map((n) => n?.ns ?? '') : [];
  return [...new Set(['', ...list])];
}

/** Snapshots de UN namespace concreto; cada snapshot se etiqueta con su `ns`. */
async function snapshotsInNs(auth, store, ns) {
  const snaps = await pbsCall(auth, {
    path: `/admin/datastore/${encodeURIComponent(store)}/snapshots`,
    query: ns ? { ns } : undefined,
  });
  return Array.isArray(snaps) ? snaps.map((s) => ({ ...s, ns: ns || '' })) : [];
}

/**
 * Snapshots de un datastore agregando TODOS sus namespaces. Cada snapshot lleva
 * su `ns` (para poder distinguir grupos con el mismo VMID en namespaces distintos
 * y para dirigir los borrados al namespace correcto).
 */
export async function listSnapshots(auth, store) {
  const nss = await listNamespaces(auth, store);
  const per = await Promise.all(nss.map((ns) => snapshotsInNs(auth, store, ns).catch(() => [])));
  return per.flat();
}

/**
 * Vista agregada para el dashboard: datastores con su uso + nº de snapshots.
 */
export async function getOverview(auth) {
  const datastores = await listDatastores(auth);
  const result = [];
  for (const ds of datastores) {
    const [status, snaps] = await Promise.all([
      getDatastoreStatus(auth, ds.store).catch(() => null),
      listSnapshots(auth, ds.store).catch(() => []),
    ]);
    const failed = snaps.filter((s) => s.verification?.state === 'failed').length;
    result.push({
      store: ds.store,
      comment: ds.comment || '',
      status,
      snapshotCount: snaps.length,
      failedVerifications: failed,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Limpieza: grupos de backup, borrado y garbage collection
// ---------------------------------------------------------------------------

/** Lista los grupos de backup de todos los datastores (con tamaño y protección). */
export async function getBackupGroups(auth) {
  const datastores = await listDatastores(auth);
  const out = [];
  for (const ds of datastores) {
    const nss = await listNamespaces(auth, ds.store);
    for (const ns of nss) {
      const snaps = await snapshotsInNs(auth, ds.store, ns).catch(() => []);
      // Agregados por grupo dentro de este namespace (tamaño total, alguno protegido)
      const agg = new Map();
      for (const s of snaps) {
        const k = `${s['backup-type']}/${s['backup-id']}`;
        const a = agg.get(k) || { size: 0, protected: false };
        a.size += s.size || 0;
        if (s.protected) a.protected = true;
        agg.set(k, a);
      }
      const groups = await pbsCall(auth, {
        path: `/admin/datastore/${encodeURIComponent(ds.store)}/groups`,
        query: ns ? { ns } : undefined,
      }).catch(() => []);
      for (const g of groups) {
        const a = agg.get(`${g['backup-type']}/${g['backup-id']}`) || {};
        out.push({
          store: ds.store, ns: ns || '', type: g['backup-type'], id: String(g['backup-id']),
          count: g['backup-count'], last: g['last-backup'], owner: g.owner || '',
          size: a.size || 0, protected: !!a.protected,
        });
      }
    }
  }
  return out;
}

export async function deleteBackupGroup(auth, store, type, id, ns) {
  return pbsCall(auth, {
    method: 'DELETE',
    path: `/admin/datastore/${encodeURIComponent(store)}/groups`,
    query: { 'backup-type': type, 'backup-id': id, ...(ns ? { ns } : {}) },
  });
}

export async function deleteSnapshotItem(auth, store, type, id, time, ns) {
  return pbsCall(auth, {
    method: 'DELETE',
    path: `/admin/datastore/${encodeURIComponent(store)}/snapshots`,
    query: { 'backup-type': type, 'backup-id': id, 'backup-time': time, ...(ns ? { ns } : {}) },
  });
}

export async function runGarbageCollection(auth, store) {
  return pbsCall(auth, { method: 'POST', path: `/admin/datastore/${encodeURIComponent(store)}/gc` });
}

/** Configuración del datastore (incluye gc-schedule). */
export async function getDatastoreConfig(auth, store) {
  return pbsCall(auth, { path: `/config/datastore/${encodeURIComponent(store)}` });
}

/**
 * Estado del último Garbage Collection del datastore. Aquí sí vienen las cifras
 * fiables de deduplicación: index-data-bytes (lógico) y disk-bytes (físico dedup.).
 */
export async function getGcStatus(auth, store) {
  return pbsCall(auth, { path: `/admin/datastore/${encodeURIComponent(store)}/gc` });
}

/**
 * Programa (o desactiva) el Garbage Collection del datastore. `schedule` es un
 * calendar-event de systemd (p.ej. 'daily', 'weekly', 'sun 03:00'); vacío = desactivar.
 */
export async function setDatastoreGcSchedule(auth, store, schedule) {
  const s = String(schedule || '').trim();
  const body = s ? { 'gc-schedule': s } : { delete: 'gc-schedule' };
  return pbsCall(auth, { method: 'PUT', path: `/config/datastore/${encodeURIComponent(store)}`, body });
}

/** Lista los matchers del sistema de notificaciones de PBS. */
export async function listNotificationMatchers(auth) {
  return pbsCall(auth, { path: '/config/notifications/matchers' });
}

/**
 * Habilita/deshabilita un matcher de notificaciones de PBS (para silenciar
 * los emails nativos y evitar duplicados con los de PBI). Reversible.
 */
export async function setNotificationMatcherDisabled(auth, name, disabled) {
  const body = disabled ? { disable: 1 } : { delete: 'disable' };
  return pbsCall(auth, {
    method: 'PUT',
    path: `/config/notifications/matchers/${encodeURIComponent(name)}`,
    body,
  });
}

/**
 * Agregación consolidada para el dashboard (estilo Active Backup / Veeam).
 * Devuelve contadores, calendario de copias, almacenamiento, últimos backups,
 * registros recientes y tendencia de transferencia en una sola llamada.
 */
export async function getDashboard(auth, nsFilter = null) {
  const datastores = await listDatastores(auth);

  // Los datastores se consultan en paralelo (antes era secuencial).
  const dsResults = await Promise.all(datastores.map(async (ds) => {
    const [status, snaps, gc] = await Promise.all([
      getDatastoreStatus(auth, ds.store).catch(() => null),
      listSnapshots(auth, ds.store).catch(() => []),
      getGcStatus(auth, ds.store).catch(() => null),
    ]);
    return { ds, status, snaps, gc };
  }));

  const perDatastore = [];
  const allSnaps = [];
  for (const { ds, status, snaps, gc: gcStatus } of dsResults) {
    // El estado de GC de PBS da las cifras fiables de dedup: index-data-bytes
    // (lógico referenciado, contando duplicados) y disk-bytes (físico dedup.).
    // Viene del endpoint /gc; algunas versiones también lo exponen en /status.
    const gc = gcStatus || status?.['gc-status'] || status?.gc_status || {};
    perDatastore.push({
      store: ds.store,
      comment: ds.comment || '',
      total: status?.total ?? null,
      used: status?.used ?? null,
      avail: status?.avail ?? null,
      gcLogical: gc['index-data-bytes'] ?? null,
      gcDisk: gc['disk-bytes'] ?? null,
    });
    for (const s of snaps) allSnaps.push({ ...s, store: ds.store });
  }

  // Lista de namespaces presentes (para el selector del panel) y, si se ha pedido
  // uno concreto, se filtran las vistas derivadas de snapshots (grupos, últimas
  // copias, contadores, transferencia, sin proteger). El almacenamiento (donuts) y
  // el calendario se mantienen a nivel de datastore/global (el espacio físico es del
  // datastore, no del namespace). `nsFilter` null = todos; '' = raíz; nombre = ese ns.
  const namespaces = [...new Set(allSnaps.map((s) => s.ns || ''))].sort();
  const snaps = nsFilter == null ? allSnaps : allSnaps.filter((s) => (s.ns || '') === nsFilter);

  // --- Grupos de backup (último snapshot por store/namespace/type/id) ---
  const groups = new Map();
  for (const s of snaps) {
    const k = `${s.store}/${s.ns || ''}/${s['backup-type']}/${s['backup-id']}`;
    const prev = groups.get(k);
    if (!prev || (s['backup-time'] || 0) > (prev['backup-time'] || 0)) groups.set(k, s);
  }
  const byType = { vm: 0, ct: 0, host: 0, other: 0 };
  for (const g of groups.values()) {
    const t = g['backup-type'];
    if (byType[t] !== undefined) byType[t] += 1;
    else byType.other += 1;
  }

  const lastBackups = [...groups.values()]
    .map((s) => ({
      store: s.store,
      ns: s.ns || '',
      type: s['backup-type'],
      id: s['backup-id'],
      time: s['backup-time'],
      size: s.size,
      verify: s.verification?.state || null,
      comment: s.comment || '',
    }))
    .sort((a, b) => (b.time || 0) - (a.time || 0));

  // --- Almacenamiento ---
  // Tamaño lógico: preferimos el dato de GC (index-data-bytes, fiable) y, si no hay
  // GC ejecutada aún, caemos a la suma de tamaños de snapshot (menos fiable: PBS no
  // siempre rellena `size`). Físico deduplicado: disk-bytes de GC si está.
  const gcLogicalSum = perDatastore.reduce((a, d) => a + (d.gcLogical || 0), 0);
  const gcDiskSum = perDatastore.reduce((a, d) => a + (d.gcDisk || 0), 0);
  const snapLogicalSum = allSnaps.reduce((a, s) => a + (s.size || 0), 0);
  const storage = {
    perDatastore,
    totalUsed: perDatastore.reduce((a, d) => a + (d.used || 0), 0),
    totalCapacity: perDatastore.reduce((a, d) => a + (d.total || 0), 0),
    logical: gcLogicalSum > 0 ? gcLogicalSum : snapLogicalSum,
    // Físico deduplicado del chunk store (para el factor de dedup exacto de PBS).
    dedupPhysical: gcDiskSum > 0 ? gcDiskSum : null,
    logicalSource: gcLogicalSum > 0 ? 'gc' : (snapLogicalSum > 0 ? 'snapshots' : 'none'),
  };

  // --- Tareas de los últimos 35 días ---
  const DAY = 86400;
  const todayMid = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const since = todayMid - 34 * DAY;
  let tasks = [];
  try {
    tasks = await listTasks(auth, { limit: 4000, since });
  } catch {
    tasks = await listTasks(auth, { limit: 500 }).catch(() => []);
  }

  // Calendario: estado de las copias por día (5 semanas)
  const dayBuckets = new Map(); // 'YYYY-MM-DD' -> {total, failed, ok}
  for (const t of tasks) {
    if (t.type !== 'backup') continue;
    if (!t.starttime) continue;
    const key = new Date(t.starttime * 1000).toISOString().slice(0, 10);
    const b = dayBuckets.get(key) || { total: 0, failed: 0, ok: 0 };
    b.total += 1;
    if (t.endtime != null) {
      if (isTaskOk(t.status)) b.ok += 1;
      else b.failed += 1;
    }
    dayBuckets.set(key, b);
  }
  const calendar = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date((todayMid - i * DAY) * 1000);
    const key = d.toISOString().slice(0, 10);
    const b = dayBuckets.get(key);
    let status = 'none';
    if (b) {
      if (b.failed > 0 && b.ok > 0) status = 'partial';
      else if (b.failed > 0) status = 'failed';
      else if (b.total > 0) status = 'ok';
    }
    calendar.push({ date: key, status, total: b?.total || 0, failed: b?.failed || 0 });
  }

  // --- Tendencia de transferencia: bytes de snapshots por día (14 días) ---
  const transferMap = new Map();
  for (const s of snaps) {
    if (!s['backup-time']) continue;
    const key = new Date(s['backup-time'] * 1000).toISOString().slice(0, 10);
    transferMap.set(key, (transferMap.get(key) || 0) + (s.size || 0));
  }
  const transfer = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date((todayMid - i * DAY) * 1000).toISOString().slice(0, 10);
    transfer.push({ date: key, bytes: transferMap.get(key) || 0 });
  }

  const finished = tasks.filter((t) => t.endtime != null);
  const okCount = finished.filter((t) => isTaskOk(t.status)).length;

  return {
    generatedAt: new Date().toISOString(),
    namespaces,
    selectedNs: nsFilter,
    counters: {
      datastores: datastores.length,
      groups: { ...byType, total: groups.size },
      snapshots: snaps.length,
      failedVerifications: snaps.filter((s) => s.verification?.state === 'failed').length,
    },
    storage,
    calendar,
    transfer,
    // IDs (vmid) con al menos una copia — para detectar máquinas sin proteger
    protectedIds: [...new Set([...groups.values()].map((g) => String(g['backup-id'])))],
    lastBackups: lastBackups.slice(0, 12),
    recentTasks: [...tasks]
      .sort((a, b) => (b.starttime || 0) - (a.starttime || 0))
      .slice(0, 10),
    running: tasks.filter((t) => t.endtime == null),
    taskStats: { total: tasks.length, ok: okCount, failed: finished.length - okCount, running: tasks.filter((t) => t.endtime == null).length },
  };
}

// ---------------------------------------------------------------------------
// Jobs: prune / verify / sync
// ---------------------------------------------------------------------------

const JOB_KINDS = {
  prune: { path: '/config/prune' },
  verify: { path: '/config/verify' },
  sync: { path: '/config/sync' },
};

export async function listJobs(auth, kind) {
  const def = JOB_KINDS[kind];
  if (!def) throw badRequest(`Tipo de job desconocido: ${kind}`);
  return pbsCall(auth, { path: def.path });
}

export async function createJob(auth, kind, body) {
  const def = JOB_KINDS[kind];
  if (!def) throw badRequest(`Tipo de job desconocido: ${kind}`);
  return pbsCall(auth, { method: 'POST', path: def.path, body });
}

export async function updateJob(auth, kind, id, body) {
  const def = JOB_KINDS[kind];
  if (!def) throw badRequest(`Tipo de job desconocido: ${kind}`);
  return pbsCall(auth, { method: 'PUT', path: `${def.path}/${encodeURIComponent(id)}`, body });
}

export async function deleteJob(auth, kind, id) {
  const def = JOB_KINDS[kind];
  if (!def) throw badRequest(`Tipo de job desconocido: ${kind}`);
  return pbsCall(auth, { method: 'DELETE', path: `${def.path}/${encodeURIComponent(id)}` });
}

/**
 * Lanza un job manualmente. Devuelve el UPID de la tarea creada.
 *  - sync:   POST /admin/sync/{id}
 *  - verify: PBS no expone /admin/verify/{id}; se lanza la verificación sobre el
 *            datastore del job (POST /admin/datastore/{store}/verify) heredando
 *            ignore-verified / outdated-after / ns / max-depth.
 */
export async function runJob(auth, kind, id) {
  if (!JOB_KINDS[kind]) throw badRequest(`Tipo de job desconocido: ${kind}`);

  if (kind === 'verify') {
    const job = await pbsCall(auth, { path: `/config/verify/${encodeURIComponent(id)}` });
    const store = job?.store;
    if (!store) throw badRequest(`El job de verificación "${id}" no define un datastore`);
    const body = {};
    for (const k of ['ignore-verified', 'outdated-after', 'max-depth', 'ns']) {
      if (job[k] != null && job[k] !== '') body[k] = job[k];
    }
    return pbsCall(auth, { method: 'POST', path: `/admin/datastore/${encodeURIComponent(store)}/verify`, body });
  }

  return pbsCall(auth, { method: 'POST', path: `/admin/${kind}/${encodeURIComponent(id)}` });
}

// ---------------------------------------------------------------------------
// Tareas (task log)
// ---------------------------------------------------------------------------

export async function listTasks(auth, { limit = 100, running, store, type, since, until } = {}) {
  const query = { limit, errors: 0 };
  if (running) query.running = 1;
  if (store) query.store = store;
  if (since) query.since = since;
  if (until) query.until = until;
  if (type) query.typefilter = type;
  const tasks = await pbsCall(auth, { path: `/nodes/${nodeOf(auth)}/tasks`, query });
  return Array.isArray(tasks) ? tasks.map(normalizeTask) : tasks;
}

/** Calendario de copias por día para el rango [from, to] (YYYY-MM-DD, inclusivo). */
export async function getBackupCalendar(auth, { from, to }) {
  const DAY = 86400;
  const fromTs = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const toTs = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + DAY; // fin del día 'to'
  let tasks = [];
  try {
    tasks = await listTasks(auth, { limit: 8000, since: fromTs, until: toTs, type: 'backup' });
  } catch {
    tasks = [];
  }
  // VMID y tipo (vm/ct) del worker id de la tarea de backup ("store:vm/100/…").
  const vmidOf = (id) => { const m = /(?:vm|ct|qemu|lxc)[/-](\d+)/i.exec(id || ''); return m ? m[1] : null; };
  const typeOf = (id) => { const m = /[^:]+:(vm|ct|host|file)\//.exec(id || ''); return m ? m[1] : null; };

  const buckets = new Map();
  for (const t of tasks) {
    if (t.type !== 'backup' || !t.starttime) continue;
    const key = new Date(t.starttime * 1000).toISOString().slice(0, 10);
    const b = buckets.get(key) || { total: 0, failed: 0, ok: 0, machines: new Map() };
    b.total += 1;
    if (t.endtime != null) { if (isTaskOk(t.status)) b.ok += 1; else b.failed += 1; }
    const vmid = vmidOf(t.id);
    if (vmid && !b.machines.has(vmid)) b.machines.set(vmid, { vmid, type: typeOf(t.id) });
    buckets.set(key, b);
  }
  const out = [];
  for (let ts = fromTs; ts < toTs; ts += DAY) {
    const key = new Date(ts * 1000).toISOString().slice(0, 10);
    const b = buckets.get(key);
    let status = 'none';
    if (b) {
      if (b.failed > 0 && b.ok > 0) status = 'partial';
      else if (b.failed > 0) status = 'failed';
      else if (b.total > 0) status = 'ok';
    }
    out.push({
      date: key, status, total: b?.total || 0, failed: b?.failed || 0,
      machines: b ? [...b.machines.values()].sort((a, c) => Number(a.vmid) - Number(c.vmid)) : [],
    });
  }
  return out;
}

export async function getTaskStatus(auth, upid) {
  return normalizeTask(await pbsCall(auth, { path: `/nodes/${nodeOf(auth)}/tasks/${encodeURIComponent(upid)}/status` }));
}

export async function getTaskLog(auth, upid, { start = 0, limit = 500 } = {}) {
  return pbsCall(auth, {
    path: `/nodes/${nodeOf(auth)}/tasks/${encodeURIComponent(upid)}/log`,
    query: { start, limit },
  });
}

/** Detiene (aborta) una tarea en ejecución en PBS. */
export async function stopTask(auth, upid) {
  return pbsCall(auth, { method: 'DELETE', path: `/nodes/${nodeOf(auth)}/tasks/${encodeURIComponent(upid)}` });
}

// ---------------------------------------------------------------------------
// Helpers de error
// ---------------------------------------------------------------------------

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function notFound(msg) {
  const e = new Error(msg);
  e.status = 404;
  return e;
}
