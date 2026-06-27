import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { encryptSecret, decryptSecret } from './secretCrypto.js';

/**
 * Almacén PERSISTENTE de hosts PBS.
 *
 * Guarda la lista de conexiones (host, nodo, credenciales) en
 * server/data/hosts.json. Es la "agenda" de servidores PBS que el usuario
 * gestiona desde la sección Configuración de la interfaz.
 *
 * Seguridad: los secretos (token secret / contraseña) se guardan CIFRADOS en
 * reposo (AES-256-GCM, ver secretCrypto.js) y el fichero tiene permisos 0600.
 * En memoria se manejan en claro; las respuestas de la API nunca los devuelven.
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'hosts.json');
const SECRET_FIELDS = ['secret', 'password'];

const decHost = (h) => { const o = { ...h }; for (const f of SECRET_FIELDS) if (o[f]) o[f] = decryptSecret(o[f]); return o; };
const encHost = (h) => { const o = { ...h }; for (const f of SECRET_FIELDS) if (o[f]) o[f] = encryptSecret(o[f]); return o; };

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ hosts: [] }, null, 2));
}

function readAll() {
  ensureFile();
  try {
    return (JSON.parse(fs.readFileSync(FILE, 'utf8')).hosts || []).map(decHost);
  } catch {
    return [];
  }
}

function writeAll(hosts) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify({ hosts: hosts.map(encHost) }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Re-guarda cifrando cualquier secreto que aún esté en texto plano (migración). */
export function migrateSecrets() {
  const all = readAll();
  if (all.length) writeAll(all);
}

/** Versión segura para enviar al cliente: sin secretos. */
function mask(h) {
  return {
    id: h.id,
    name: h.name,
    host: h.host,
    node: h.node || 'localhost',
    verifyTls: !!h.verifyTls,
    authMode: h.authMode,
    tokenId: h.tokenId || '',
    username: h.username || '',
    hasSecret: !!(h.secret || h.password),
    isDefault: !!h.isDefault,
  };
}

export function listHosts() {
  return readAll().map(mask);
}

/** Devuelve el host crudo (con secretos) para uso interno del backend. */
export function getHostRaw(id) {
  return readAll().find((h) => h.id === id) || null;
}

export function getDefaultHost() {
  const all = readAll();
  return all.find((h) => h.isDefault) || all[0] || null;
}

export function addHost(input) {
  const hosts = readAll();
  const host = normalize(input, { id: crypto.randomUUID() });
  // Si es el primero, marcarlo por defecto
  if (hosts.length === 0) host.isDefault = true;
  if (host.isDefault) hosts.forEach((h) => (h.isDefault = false));
  hosts.push(host);
  writeAll(hosts);
  return mask(host);
}

export function updateHost(id, input) {
  const hosts = readAll();
  const idx = hosts.findIndex((h) => h.id === id);
  if (idx === -1) return null;
  const prev = hosts[idx];
  // Conserva el secreto/contraseña anterior si no se reenvía
  const merged = normalize({ ...prev, ...input }, { id });
  if (!input.secret) merged.secret = prev.secret;
  if (!input.password) merged.password = prev.password;
  if (merged.isDefault) hosts.forEach((h) => (h.isDefault = false));
  hosts[idx] = merged;
  writeAll(hosts);
  return mask(merged);
}

export function deleteHost(id) {
  let hosts = readAll();
  const existed = hosts.some((h) => h.id === id);
  const wasDefault = hosts.find((h) => h.id === id)?.isDefault;
  hosts = hosts.filter((h) => h.id !== id);
  if (wasDefault && hosts.length) hosts[0].isDefault = true;
  writeAll(hosts);
  return existed;
}

export function setDefaultHost(id) {
  const hosts = readAll();
  if (!hosts.some((h) => h.id === id)) return false;
  hosts.forEach((h) => (h.isDefault = h.id === id));
  writeAll(hosts);
  return true;
}

function normalize(input, extra) {
  return {
    id: extra.id,
    name: (input.name || '').trim() || input.host,
    host: (input.host || '').replace(/\/+$/, ''),
    node: (input.node || 'localhost').trim(),
    verifyTls: !!input.verifyTls,
    authMode: input.authMode === 'ticket' ? 'ticket' : 'token',
    tokenId: input.tokenId || '',
    secret: input.secret || '',
    username: input.username || '',
    password: input.password || '',
    isDefault: !!input.isDefault,
  };
}
