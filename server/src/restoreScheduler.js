import * as restoreStore from './restoreStore.js';
import { getPveRaw } from './pveStore.js';
import { pveBackups, pveRestore } from './pveService.js';

/**
 * Programador de restauraciones. Comprueba periódicamente los trabajos:
 *  - recurrentes (test de restauración): lanzan el ÚLTIMO backup de la VM al
 *    destino configurado según frecuencia/día/hora.
 *  - puntuales: se lanzan una vez al llegar su fecha/hora y se deshabilitan.
 * Robusto a reinicios mediante la marca persistente `lastRun`.
 */

const TICK_MS = 2 * 60 * 1000;
let timer = null;
let busy = false;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function dueRecurring(s, now) {
  const hour = Number(s.hour) || 0;
  if (s.frequency === 'daily') return { due: now.getHours() >= hour, key: ymd(now) };
  if (s.frequency === 'weekly') {
    const wd = now.getDay() === 0 ? 7 : now.getDay(); // 1=lun … 7=dom
    return { due: wd === (Number(s.weekday) || 1) && now.getHours() >= hour, key: ymd(now) };
  }
  const dom = Number(s.dayOfMonth) || 1;
  const due = (now.getDate() > dom) || (now.getDate() === dom && now.getHours() >= hour);
  return { due, key: ym(now) };
}

/** Ejecuta la restauración de un trabajo: busca el último backup y la lanza. */
export async function runRestoreJobNow(job) {
  const pve = getPveRaw(job.pveId);
  if (!pve) throw new Error('Conexión PVE no encontrada');
  if (!job.node || !job.storage || !job.sourceVmid || !job.targetVmid || !job.targetStorage) {
    throw new Error('Trabajo incompleto: faltan nodo, almacenamiento, VM origen/destino');
  }
  const backups = await pveBackups(pve, job.node, job.storage);
  const mine = (backups || [])
    .filter((b) => String(b.vmid) === String(job.sourceVmid))
    .sort((a, b) => (b.ctime || 0) - (a.ctime || 0));
  const point = mine[0];
  if (!point) throw new Error(`No hay backups de la VM ${job.sourceVmid} en «${job.storage}»`);

  const upid = await pveRestore(pve, {
    node: job.node, type: job.type, vmid: job.targetVmid,
    archive: point.volid, storage: job.targetStorage, force: job.force, start: job.start,
  });
  restoreStore.addWatch({
    pveId: job.pveId, upid, node: job.node, type: job.type, kind: 'scheduled',
    jobId: job.id, jobName: job.name, pveName: '',
    sourceVmid: job.sourceVmid, targetVmid: job.targetVmid,
    point: point.volid, ctime: point.ctime,
    startedAt: Math.floor(Date.now() / 1000), startedBy: 'programador',
  });
  return upid;
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date();
    for (const job of restoreStore.listJobs()) {
      if (!job.enabled) continue;

      if (job.schedule.type === 'oneoff') {
        if (!job.schedule.runAt || job.lastRun === 'done') continue;
        if (new Date(job.schedule.runAt).getTime() > now.getTime()) continue; // aún no toca
        try {
          const upid = await runRestoreJobNow(job);
          restoreStore.setJobRun(job.id, { lastRun: 'done', lastUpid: upid, enabled: false });
          console.log(`[restore] puntual lanzada: ${job.name}`);
        } catch (e) {
          restoreStore.setJobRun(job.id, { lastRun: 'done', enabled: false, lastResult: { ok: false, status: 'error', at: Math.floor(Date.now() / 1000), error: e.message } });
          console.error('[restore] puntual error:', e.message);
        }
        continue;
      }

      // recurrente
      const { due, key } = dueRecurring(job.schedule, now);
      if (job.lastRun == null) { restoreStore.setJobRun(job.id, { lastRun: key }); continue; } // línea base
      if (!due || job.lastRun === key) continue;
      try {
        const upid = await runRestoreJobNow(job);
        restoreStore.setJobRun(job.id, { lastRun: key, lastUpid: upid });
        console.log(`[restore] test de restauración lanzado: ${job.name} (${key})`);
      } catch (e) {
        restoreStore.setJobRun(job.id, { lastRun: key, lastResult: { ok: false, status: 'error', at: Math.floor(Date.now() / 1000), error: e.message } });
        console.error('[restore] test error:', e.message);
      }
    }
  } catch (e) {
    console.error('[restore] error en el programador:', e.message);
  } finally {
    busy = false;
  }
}

export function startRestoreScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 20000);
  console.log('  Restauraciones programadas: programador activo');
}
