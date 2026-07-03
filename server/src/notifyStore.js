// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { encryptSecret, decryptSecret } from './secretCrypto.js';

/**
 * Configuración persistente de notificaciones por email (SMTP) + estado del
 * vigilante (marca de tiempo de la última tarea notificada). El fichero se
 * guarda con permisos 0600; la contraseña SMTP se cifra en reposo
 * (secretCrypto.js) y nunca se devuelve por la API.
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'notify.json');

const DEFAULTS = {
  enabled: false,
  notifyOk: true,
  notifyFail: true,
  notifyRestore: true,
  silenceProxmox: false,
  types: ['backup', 'verify', 'prune', 'sync', 'garbage_collection'],
  smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
  silencedMatchers: { pbs: [], pve: [] },
  // Vigilancia proactiva: aviso de máquinas fuera de RPO (sin copia reciente),
  // resumen diario por email y umbral de ocupación de datastores.
  rpo: { enabled: false, hours: 26 },
  digest: { enabled: false, time: '08:00', tasks: true, rpo: true, storage: true, unprotected: true },
  storageAlert: { enabled: false, percent: 85 },
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
    const cfg = {
      ...DEFAULTS,
      ...c,
      smtp: { ...DEFAULTS.smtp, ...(c.smtp || {}) },
      rpo: { ...DEFAULTS.rpo, ...(c.rpo || {}) },
      digest: { ...DEFAULTS.digest, ...(c.digest || {}) },
      storageAlert: { ...DEFAULTS.storageAlert, ...(c.storageAlert || {}) },
      state: { ...DEFAULTS.state, ...(c.state || {}) },
    };
    if (cfg.smtp.pass) cfg.smtp.pass = decryptSecret(cfg.smtp.pass);
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}

function write(cfg) {
  ensure();
  const out = { ...cfg, smtp: { ...cfg.smtp } };
  if (out.smtp.pass) out.smtp.pass = encryptSecret(out.smtp.pass);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Re-guarda cifrando la contraseña SMTP si aún está en texto plano (migración). */
export function migrateSecrets() {
  if (getRaw().smtp.pass) write(getRaw());
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
  for (const k of ['rpo', 'digest', 'storageAlert']) {
    if (input[k]) next[k] = { ...cur[k], ...input[k] };
  }
  // Auto-activar cuando se configura SMTP con host + destinatario, salvo que
  // el usuario haya marcado explícitamente enabled=false en esta llamada.
  if (next.smtp.host && next.smtp.to && input.enabled !== false) next.enabled = true;
  next.state = cur.state; // el estado lo gestiona el vigilante
  write(next);
  return masked();
}

export function setState(state) {
  const cur = getRaw();
  write({ ...cur, state: { ...cur.state, ...state } });
}
