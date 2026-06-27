import { Router } from 'express';
import * as users from '../userStore.js';
import { createSession, destroySession, getSession, COOKIE } from '../session.js';
import { config } from '../config.js';
import { verifyToken } from '../totp.js';

export const panelAuthRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cookieOpts = { httpOnly: true, sameSite: 'lax', signed: true, secure: config.tls.enabled, maxAge: 1000 * 60 * 60 * 12 };

function sessionUser(req) {
  const s = getSession(req.signedCookies?.[COOKIE]);
  return s ? { username: s.username, role: s.role, id: s.userId } : null;
}

// Estado de auth: ¿hay que crear el primer admin?, ¿hay sesión?
panelAuthRouter.get('/state', (req, res) => {
  res.json({ needsSetup: users.count() === 0, authenticated: !!sessionUser(req), user: sessionUser(req) });
});

// Alta del primer administrador (solo si no hay usuarios)
panelAuthRouter.post('/setup', wrap(async (req, res) => {
  if (users.count() > 0) return res.status(409).json({ error: 'El sistema ya está inicializado' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const u = users.addUser({ username, password, role: 'admin' });
  const raw = users.getById(u.id);
  res.cookie(COOKIE, createSession(raw), cookieOpts);
  res.json({ ok: true, user: { username: u.username, role: u.role, id: u.id } });
}));

// Inicio de sesión (con 2FA si el usuario lo tiene activado)
panelAuthRouter.post('/login', wrap(async (req, res) => {
  const { username, password, totp } = req.body || {};
  const u = users.getByUsername(username);
  if (!u || !users.verifyPassword(password || '', u.salt, u.hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  if (u.totpEnabled) {
    if (!totp) return res.json({ twofaRequired: true });
    if (!verifyToken(u.totpSecret, totp)) {
      return res.status(401).json({ error: 'Código de verificación incorrecto', twofa: true });
    }
  }
  res.cookie(COOKIE, createSession(u), cookieOpts);
  res.json({ ok: true, user: { username: u.username, role: u.role, id: u.id } });
}));

panelAuthRouter.post('/logout', (req, res) => {
  destroySession(req.signedCookies?.[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
