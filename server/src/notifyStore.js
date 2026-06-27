import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

/**
 * Configuración persistente de notificaciones por email (SMTP) + estado del
 * vigilante (marca de tiempo de la última tarea notificada). El fichero se
 * guarda con permisos 0600 y la contraseña SMTP nunca se devuelve por la API.
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'notify.json');

const DEFAULTS = {
  enabled: false,
  notifyOk: true,
  notifyFail: true,
  silenceProxmox: false,
  types: ['backup', 'verify', 'prune', 'sync', 'garbage_collection'],
  smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
  state: { lastSeen: null },
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
}

export function getRaw() {
  ensure();
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...c, smtp: { ...DEFAULTS.smtp, ...(c.smtp || {}) }, state: { ...DEFAULTS.state, ...(c.state || {}) } };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(cfg) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Versión segura para el cliente: sin la contraseña SMTP. */
export function masked() {
  const c = getRaw();
  const { pass, ...smtp } = c.smtp;
  return { ...c, smtp: { ...smtp, hasPass: !!pass } };
}

/** Actualiza la configuración (mezcla). Conserva la contraseña si no se reenvía. */
export function update(input) {
  const cur = getRaw();
  const next = { ...cur, ...input };
  if (input.smtp) {
    next.smtp = { ...cur.smtp, ...input.smtp };
    if (!input.smtp.pass) next.smtp.pass = cur.smtp.pass; // conservar si vacío
  }
  next.state = cur.state; // el estado lo gestiona el vigilante
  write(next);
  return masked();
}

export function setState(state) {
  const cur = getRaw();
  write({ ...cur, state: { ...cur.state, ...state } });
}
