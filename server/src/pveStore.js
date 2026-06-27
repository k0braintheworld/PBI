import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

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
 * Igual que con PBS: secretos en texto plano (fichero 0600), nunca devueltos
 * por la API (se enmascaran).
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'pve.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ pve: [] }, null, 2));
}
function readAll() {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).pve || []; } catch { return []; }
}
function writeAll(list) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify({ pve: list }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
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
