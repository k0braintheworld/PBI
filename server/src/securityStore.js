import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Ajustes de seguridad del panel. Por ahora: minutos de inactividad tras los
 * que se cierra la sesión (0 = desactivado). Persistido con permisos 0600.
 */

const FILE = path.join(config.dataDir, 'security.json');
const DEFAULTS = { sessionIdleMinutes: 30 };
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getSecurity() {
  return { ...load() };
}

/** Timeout de inactividad en ms (0 = desactivado). */
export function getIdleMs() {
  const m = Number(load().sessionIdleMinutes) || 0;
  return m > 0 ? m * 60 * 1000 : 0;
}

export function updateSecurity(input = {}) {
  const cur = load();
  let mins = Number(input.sessionIdleMinutes);
  if (!Number.isFinite(mins)) mins = cur.sessionIdleMinutes;
  mins = Math.max(0, Math.min(1440, Math.round(mins))); // 0..24 h
  cache = { ...cur, sessionIdleMinutes: mins };
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
  return { ...cache };
}
