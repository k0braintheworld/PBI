import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Estado persistente de las features desbloqueables. De momento solo "central"
 * (PBI Central). Guarda si está desbloqueada y por quién/cuándo. El desbloqueo lo
 * realiza un admin introduciendo la contraseña de autor (ver centralUnlock.js).
 */

const FILE = path.join(config.dataDir, 'features.json');

const DEFAULTS = {
  central: { unlocked: false, unlockedAt: null, unlockedBy: null },
};

export function getFeatures() {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { central: { ...DEFAULTS.central, ...(c.central || {}) } };
  } catch {
    return { central: { ...DEFAULTS.central } };
  }
}

function write(state) {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

export function isCentralUnlocked() {
  return !!getFeatures().central.unlocked;
}

export function setCentralUnlocked(unlocked, by) {
  const s = getFeatures();
  s.central = unlocked
    ? { unlocked: true, unlockedAt: new Date().toISOString(), unlockedBy: by || null }
    : { unlocked: false, unlockedAt: null, unlockedBy: null };
  write(s);
  return s.central;
}
