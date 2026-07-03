// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as users from '../userStore.js';
import { createSession, destroySession, getSession, COOKIE } from '../session.js';
import { config } from '../config.js';
import { verifyToken } from '../totp.js';
import { audit } from '../auditLog.js';
import { lockRemaining, recordFail, recordSuccess } from '../loginGuard.js';

export const panelAuthRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// `secure` activa la cookie solo-HTTPS: cuando el servidor sirve TLS directo, o
// cuando se ejecuta tras un proxy inverso que termina TLS (SECURE_COOKIE=1).
const cookieOpts = { httpOnly: true, sameSite: 'lax', signed: true, secure: config.tls.enabled || process.env.SECURE_COOKIE === '1', maxAge: 1000 * 60 * 60 * 12 };

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
  if (password.length < 10) return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres' });
  const u = users.addUser({ username, password, role: 'admin' });
  const raw = users.getById(u.id);
  res.cookie(COOKIE, createSession(raw), cookieOpts);
  audit(req, 'auth.setup', u.username, 'ok', 'Alta del primer administrador', { username: u.username, role: u.role });
  res.json({ ok: true, user: { username: u.username, role: u.role, id: u.id } });
}));

// Inicio de sesión (con 2FA si el usuario lo tiene activado)
panelAuthRouter.post('/login', wrap(async (req, res) => {
  const { username, password, totp } = req.body || {};
  const ipKey = `ip:${req.ip}`;
  const userKey = `u:${String(username || '').toLowerCase()}`;

  // Bloqueo temporal tras varios intentos fallidos (por usuario o por IP)
  const wait = lockRemaining(userKey, ipKey);
  if (wait) {
    audit(req, 'auth.login', '', 'fail', `Bloqueado (${wait}s)`, { username: username || '?', role: '?' });
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Demasiados intentos fallidos. Inténtalo de nuevo en ${Math.ceil(wait / 60)} min.` });
  }

  const u = users.getByUsername(username);
  if (!u || !users.verifyPassword(password || '', u.salt, u.hash)) {
    recordFail(userKey, ipKey);
    audit(req, 'auth.login', '', 'fail', `Usuario: ${username}`, { username: username || '?', role: '?' });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  if (u.totpEnabled) {
    if (!totp) return res.json({ twofaRequired: true });
    if (!verifyToken(u.totpSecret, totp)) {
      recordFail(userKey, ipKey);
      audit(req, 'auth.login', '', 'fail', '2FA incorrecto', { username: u.username, role: u.role });
      return res.status(401).json({ error: 'Código de verificación incorrecto', twofa: true });
    }
  }
  recordSuccess(userKey, ipKey);
  audit(req, 'auth.login', '', 'ok', '', { username: u.username, role: u.role });
  res.cookie(COOKIE, createSession(u), cookieOpts);
  res.json({ ok: true, user: { username: u.username, role: u.role, id: u.id } });
}));

panelAuthRouter.post('/logout', (req, res) => {
  const s = getSession(req.signedCookies?.[COOKIE]);
  if (s) audit(req, 'auth.logout', '', 'ok', '', { username: s.username, role: s.role });
  destroySession(req.signedCookies?.[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
