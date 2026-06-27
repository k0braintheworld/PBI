import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

/**
 * Configuración persistente del informe periódico de copias.
 * El SMTP se reutiliza del módulo de notificaciones (notifyStore).
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'report.json');

const DEFAULTS = {
  enabled: false,
  sede: '',
  frequency: 'monthly', // daily | weekly | monthly
  dayOfMonth: 1,        // para mensual
  weekday: 1,           // para semanal (1=lunes … 7=domingo)
  hour: 8,              // hora de envío (0-23)
  to: '',               // destinatario (si vacío, usa el de notificaciones)
  state: { lastSent: null }, // marca de periodo ya enviado
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
}

export function getRaw() {
  ensure();
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...c, state: { ...DEFAULTS.state, ...(c.state || {}) } };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(cfg) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

export function update(input) {
  const cur = getRaw();
  const next = { ...cur, ...input, state: cur.state };
  write(next);
  return next;
}

export function setState(state) {
  const cur = getRaw();
  write({ ...cur, state: { ...cur.state, ...state } });
}
