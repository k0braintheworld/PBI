// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import * as restoreStore from './restoreStore.js';
import * as notifyStore from './notifyStore.js';
import { getPveRaw } from './pveStore.js';
import { pveTaskStatus } from './pveService.js';
import { getRaw as getReportCfg } from './reportStore.js';
import { sendMail, buildRestoreEmail } from './mailer.js';

/**
 * Vigila las tareas de restauración en curso (manuales y programadas) y envía
 * un email cuando finalizan. Sondea el estado en PVE; al terminar, notifica
 * (si hay SMTP configurado y la notificación de restauraciones está activa) y
 * deja registro del resultado en el trabajo programado correspondiente.
 */

const POLL_MS = 30_000;
let timer = null;
let running = false;

async function poll() {
  if (running) return;
  running = true;
  try {
    const watch = restoreStore.listWatch();
    if (!watch.length) return;
    const cfg = notifyStore.getRaw();
    const smtp = cfg.smtp || {};
    const canMail = cfg.notifyRestore !== false && !!smtp.host && !!smtp.to;

    for (const w of watch) {
      const pve = getPveRaw(w.pveId);
      if (!pve) { restoreStore.removeWatch(w.id); continue; }

      let status;
      try {
        status = await pveTaskStatus(pve, w.upid);
      } catch {
        const tries = (w.tries || 0) + 1;
        if (tries > 10) restoreStore.removeWatch(w.id); else restoreStore.updateWatch(w.id, { tries });
        continue;
      }
      if (status.status === 'running') continue; // sigue en curso

      const result = {
        exitstatus: status.exitstatus || 'unknown',
        start: status.starttime || w.startedAt,
        end: status.endtime || Math.floor(Date.now() / 1000),
        upid: w.upid,
      };
      if (w.jobId) {
        restoreStore.setJobRun(w.jobId, {
          lastResult: { ok: status.exitstatus === 'OK', status: result.exitstatus, at: result.end, upid: w.upid },
        });
      }

      if (!canMail) { restoreStore.removeWatch(w.id); continue; }
      try {
        const sede = getReportCfg()?.sede || '';
        await sendMail(smtp, buildRestoreEmail(w, result, { sede }));
        restoreStore.removeWatch(w.id);
      } catch (e) {
        const tries = (w.tries || 0) + 1;
        if (tries > 5) restoreStore.removeWatch(w.id); else restoreStore.updateWatch(w.id, { tries });
        console.error('[restore] error enviando email:', e.message);
      }
    }
  } catch (e) {
    console.error('[restore] error en el vigilante:', e.message);
  } finally {
    running = false;
  }
}

export function startRestoreWatcher() {
  if (timer) return;
  timer = setInterval(poll, POLL_MS);
  setTimeout(poll, 8000);
  console.log('  Restauraciones: vigilante de notificación activo');
}
