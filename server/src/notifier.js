import { getDefaultHost } from './hostStore.js';
import { authForHost } from './authResolver.js';
import { listTasks, getTaskLog } from './pbsService.js';
import { getDefaultPve } from './pveStore.js';
import { pveGuests } from './pveService.js';
import * as notifyStore from './notifyStore.js';
import { getRaw as getReportCfg } from './reportStore.js';
import { sendMail, buildTaskEmail } from './mailer.js';

/**
 * Vigilante en segundo plano: sondea las tareas finalizadas del PBS por
 * defecto y envía un email por cada una nueva (según la configuración).
 * Deduplica por UPID en memoria y guarda una marca de tiempo persistente
 * para no reenviar tras un reinicio.
 */

const POLL_MS = 60_000;
const isOk = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');

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

async function poll() {
  if (running) return;
  running = true;
  try {
    const cfg = notifyStore.getRaw();
    if (!cfg.enabled || !cfg.smtp?.host || !cfg.smtp?.to) return;

    const host = getDefaultHost();
    if (!host) return;

    const now = Math.floor(Date.now() / 1000);
    let lastSeen = cfg.state?.lastSeen;
    // Primera ejecución: fijamos línea base y no inundamos con tareas viejas.
    if (!lastSeen) { notifyStore.setState({ lastSeen: now }); return; }

    const auth = await authForHost(host);
    const tasks = await listTasks(auth, { limit: 500, since: lastSeen - 6 * 3600 });
    const fresh = (tasks || [])
      .filter((t) => t.endtime != null && t.endtime > lastSeen && (cfg.types || []).includes(t.type))
      .sort((a, b) => (a.endtime || 0) - (b.endtime || 0));

    if (!fresh.length) return;
    const names = await guestNames();
    const sede = getReportCfg()?.sede || '';
    let maxEnd = lastSeen;

    for (const t of fresh) {
      maxEnd = Math.max(maxEnd, t.endtime);
      const ok = isOk(t.status);
      if ((ok && !cfg.notifyOk) || (!ok && !cfg.notifyFail)) continue;
      if (notified.has(t.upid)) continue;
      try {
        const { backupMode, encrypted } = t.type === 'backup' ? await getBackupDetails(auth, t.upid) : {};
        const mail = buildTaskEmail(t, { hostName: host.name, names, sede, backupMode, encrypted });
        await sendMail(cfg.smtp, mail);
        notified.add(t.upid);
      } catch (e) {
        console.error('[notifier] error enviando email:', e.message);
      }
    }
    if (maxEnd > lastSeen) notifyStore.setState({ lastSeen: maxEnd });
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
  console.log(`  Notificaciones: vigilante activo (sondeo cada ${POLL_MS / 1000}s)`);
}
