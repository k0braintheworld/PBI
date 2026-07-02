import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { encryptSecret, decryptSecret } from './secretCrypto.js';

/**
 * Almacén persistente de conexiones a Proxmox VE (hipervisor).
 *
 * PVE es quien ejecuta las restauraciones (PBS solo guarda los datos). Aquí
 * guardamos las credenciales para que el gestor pueda orquestar restauraciones
 * de VM completas y restauración granular de ficheros.
 *
 * Autenticación: API token de PVE (recomendado). Formato del token:
 *   tokenId = usuario@realm!nombre   +   secret = UUID
 *
 * Igual que con PBS: el secreto se guarda CIFRADO en reposo (secretCrypto.js),
 * fichero 0600, y nunca se devuelve por la API (se enmascara).
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'pve.json');

const decPve = (h) => (h.secret ? { ...h, secret: decryptSecret(h.secret) } : h);
const encPve = (h) => (h.secret ? { ...h, secret: encryptSecret(h.secret) } : h);

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ pve: [] }, null, 2));
}
// Caché por mtime (ver hostStore): evita releer/descifrar en cada petición.
let _cache = null;
let _cacheMtime = -1;
function readAll() {
  ensureFile();
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (_cache && m === _cacheMtime) return _cache;
    _cache = (JSON.parse(fs.readFileSync(FILE, 'utf8')).pve || []).map(decPve);
    _cacheMtime = m;
    return _cache;
  } catch { return _cache || []; }
}
function writeAll(list) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify({ pve: list.map(encPve) }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
  _cacheMtime = -1; // forzar relectura
}

/** Re-guarda cifrando cualquier secreto aún en texto plano (migración). */
export function migrateSecrets() {
  const all = readAll();
  if (all.length) writeAll(all);
}

function mask(h) {
  return {
    id: h.id, name: h.name, host: h.host, verifyTls: !!h.verifyTls,
    tokenId: h.tokenId || '', hasSecret: !!h.secret, isDefault: !!h.isDefault,
  };
}
function normalize(input, extra) {
  return {
    id: extra.id,
    name: (input.name || '').trim() || input.host,
    host: (input.host || '').replace(/\/+$/, ''),
    verifyTls: !!input.verifyTls,
    tokenId: input.tokenId || '',
    secret: input.secret || '',
    isDefault: !!input.isDefault,
  };
}

export function listPve() { return readAll().map(mask); }
export function getPveRaw(id) { return readAll().find((h) => h.id === id) || null; }
export function getDefaultPve() { const a = readAll(); return a.find((h) => h.isDefault) || a[0] || null; }

export function addPve(input) {
  const list = readAll();
  const h = normalize(input, { id: crypto.randomUUID() });
  if (list.length === 0) h.isDefault = true;
  if (h.isDefault) list.forEach((x) => (x.isDefault = false));
  list.push(h);
  writeAll(list);
  return mask(h);
}
export function updatePve(id, input) {
  const list = readAll();
  const i = list.findIndex((h) => h.id === id);
  if (i === -1) return null;
  const prev = list[i];
  const merged = normalize({ ...prev, ...input }, { id });
  if (!input.secret) merged.secret = prev.secret;
  if (merged.isDefault) list.forEach((x) => (x.isDefault = false));
  list[i] = merged;
  writeAll(list);
  return mask(merged);
}
export function deletePve(id) {
  let list = readAll();
  const existed = list.some((h) => h.id === id);
  const wasDef = list.find((h) => h.id === id)?.isDefault;
  list = list.filter((h) => h.id !== id);
  if (wasDef && list.length) list[0].isDefault = true;
  writeAll(list);
  return existed;
}
export function setDefaultPve(id) {
  const list = readAll();
  if (!list.some((h) => h.id === id)) return false;
  list.forEach((h) => (h.isDefault = h.id === id));
  writeAll(list);
  return true;
}
