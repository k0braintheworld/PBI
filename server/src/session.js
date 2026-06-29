import crypto from 'node:crypto';

/**
 * Sesiones del panel en memoria, referenciadas por una cookie httpOnly firmada.
 * (Al ser en memoria, cerrar el servidor cierra las sesiones — aceptable.)
 */

export const COOKIE = 'pbp_sid';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const sessions = new Map();

export function createSession(user) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { userId: user.id, username: user.username, role: user.role, ts: Date.now() });
  return sid;
}

export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.ts > TTL_MS) { sessions.delete(sid); return null; }
  return s;
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
