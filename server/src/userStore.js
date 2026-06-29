import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

/**
 * Almacén persistente de usuarios del panel (server/data/users.json).
 * Contraseñas cifradas con scrypt + salt aleatorio. Roles: 'admin' | 'operator'.
 * El hash/salt nunca se devuelven por la API (listUsers los enmascara).
 */

const DATA_DIR = config.dataDir;
const FILE = path.join(DATA_DIR, 'users.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ users: [] }, null, 2), { mode: 0o600 });
}
function readAll() {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).users || []; } catch { return []; }
}
function writeAll(users) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const ROLES = ['admin', 'operator', 'viewer'];
const normRole = (r) => (ROLES.includes(r) ? r : 'operator');

const mask = (u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, totpEnabled: !!u.totpEnabled });

export const count = () => readAll().length;
export const listUsers = () => readAll().map(mask);
export const getById = (id) => readAll().find((u) => u.id === id) || null;
export const getByUsername = (username) =>
  readAll().find((u) => u.username.toLowerCase() === String(username || '').toLowerCase()) || null;

export function addUser({ username, password, role = 'operator' }) {
  const users = readAll();
  if (!username || !password) throw httpErr(400, 'Usuario y contraseña obligatorios');
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw httpErr(409, 'Ese usuario ya existe');
  const { salt, hash } = hashPassword(password);
  const user = { id: crypto.randomUUID(), username, role: normRole(role), salt, hash, createdAt: new Date().toISOString() };
  users.push(user);
  writeAll(users);
  return mask(user);
}

export function updateUser(id, { role, password, username, resetTotp }) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  if (username && username !== u.username) {
    if (users.some((x) => x.id !== id && x.username.toLowerCase() === username.toLowerCase())) {
      throw httpErr(409, 'Ya existe un usuario con ese nombre');
    }
    u.username = username;
  }
  if (role) {
    // No permitir quitar el último admin
    if (u.role === 'admin' && role !== 'admin' && users.filter((x) => x.role === 'admin').length <= 1) {
      throw httpErr(400, 'No puedes quitar el rol al último administrador');
    }
    u.role = normRole(role);
  }
  if (password) {
    if (password.length < 6) throw httpErr(400, 'La contraseña debe tener al menos 6 caracteres');
    const { salt, hash } = hashPassword(password);
    u.salt = salt; u.hash = hash;
  }
  if (resetTotp) { delete u.totpSecret; delete u.totpPending; u.totpEnabled = false; }
  writeAll(users);
  return mask(u);
}

export function deleteUser(id, currentUserId) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  if (id === currentUserId) throw httpErr(400, 'No puedes eliminar tu propia cuenta');
  if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1) {
    throw httpErr(400, 'No puedes eliminar al último administrador');
  }
  writeAll(users.filter((x) => x.id !== id));
  return { ok: true };
}

// --- Autoservicio: contraseña y 2FA del propio usuario ---

export function changePassword(id, currentPassword, newPassword) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  if (!verifyPassword(currentPassword || '', u.salt, u.hash)) throw httpErr(400, 'La contraseña actual no es correcta');
  if (!newPassword || newPassword.length < 6) throw httpErr(400, 'La nueva contraseña debe tener al menos 6 caracteres');
  const { salt, hash } = hashPassword(newPassword);
  u.salt = salt; u.hash = hash;
  writeAll(users);
  return { ok: true };
}

export function set2faPending(id, secret) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  u.totpPending = secret;
  writeAll(users);
}

export function enable2fa(id) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  if (!u.totpPending) throw httpErr(400, 'No hay configuración 2FA pendiente');
  u.totpSecret = u.totpPending;
  u.totpEnabled = true;
  delete u.totpPending;
  writeAll(users);
  return { ok: true };
}

export function disable2fa(id) {
  const users = readAll();
  const u = users.find((x) => x.id === id);
  if (!u) throw httpErr(404, 'Usuario no encontrado');
  delete u.totpSecret;
  delete u.totpPending;
  u.totpEnabled = false;
  writeAll(users);
  return { ok: true };
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
