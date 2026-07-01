import crypto from 'node:crypto';
import { getIdleMs } from './securityStore.js';

/**
 * Sesiones del panel en memoria, referenciadas por una cookie httpOnly firmada.
 * (Al ser en memoria, cerrar el servidor cierra las sesiones — aceptable.)
 *
 * Caducidad: tope absoluto de 12 h desde el login (`ts`) + caducidad por
 * inactividad deslizante (`seen`, refrescada en cada petición autenticada)
 * según los minutos configurados en Seguridad (0 = desactivada). La inactividad
 * en servidor cubre el caso «navegador cerrado»; el cierre con la pestaña
 * abierta lo dispara el temporizador del cliente (actividad real de usuario).
 */

export const COOKIE = 'pbp_sid';
const ABS_TTL_MS = 1000 * 60 * 60 * 12; // tope absoluto: 12 horas
const sessions = new Map();

export function createSession(user) {
  const sid = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(sid, { userId: user.id, username: user.username, role: user.role, ts: now, seen: now });
  return sid;
}

export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.ts > ABS_TTL_MS) { sessions.delete(sid); return null; }
  const idle = getIdleMs();
  if (idle && now - s.seen > idle) { sessions.delete(sid); return null; }
  return s;
}

/** Refresca la marca de actividad (para la caducidad por inactividad deslizante). */
export function touchSession(sid) {
  const s = sessions.get(sid);
  if (s) s.seen = Date.now();
}

export function destroySession(sid) { if (sid) sessions.delete(sid); }

/** Invalida todas las sesiones de un usuario (al borrarlo o cambiar su rol). */
export function destroyUserSessions(userId) {
  for (const [sid, s] of sessions) if (s.userId === userId) sessions.delete(sid);
}

export function requireAuth(req, res, next) {
  const sid = req.signedCookies?.[COOKIE];
  const s = getSession(sid);
  if (!s) return res.status(401).json({ error: 'No autenticado' });
  touchSession(sid); // ventana de inactividad deslizante
  req.user = s;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol de administrador' });
  next();
}

/** Bloquea el rol 'viewer' (solo lectura). Permite admin y operator. */
export function requireOperator(req, res, next) {
  if (req.user?.role === 'viewer') return res.status(403).json({ error: 'Acceso de solo lectura' });
  next();
}
