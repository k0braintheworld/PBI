// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import QRCode from 'qrcode';
import * as users from '../userStore.js';
import { generateSecret, otpauthUri, verifyToken } from '../totp.js';
import { audit } from '../auditLog.js';
import { config } from '../config.js';
import { createSession, destroyUserSessions, COOKIE } from '../session.js';
import { twofaLimiter } from '../rateLimit.js';

/** Autoservicio del usuario autenticado: su contraseña y su 2FA. */
export const accountRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Mismas opciones de cookie que en el login (mantener sincronizado con panelAuth.js).
const cookieOpts = { httpOnly: true, sameSite: 'lax', signed: true, secure: config.tls.enabled || process.env.SECURE_COOKIE === '1', maxAge: 1000 * 60 * 60 * 12 };

accountRouter.get('/', (req, res) => {
  const u = users.getById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ username: u.username, role: u.role, totpEnabled: !!u.totpEnabled });
});

// Cambiar la propia contraseña
accountRouter.post('/password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const out = users.changePassword(req.user.userId, currentPassword, newPassword);
  // Cambiar la contraseña expulsa cualquier otra sesión (p. ej. una cookie robada);
  // se re-emite una cookie fresca para no cerrar la pestaña que acaba de cambiarla.
  destroyUserSessions(req.user.userId);
  const u = users.getById(req.user.userId);
  res.cookie(COOKIE, createSession(u), cookieOpts);
  audit(req, 'account.password', req.user.username, 'ok', 'Contraseña cambiada (sesiones anteriores cerradas)');
  res.json(out);
}));

// Iniciar la configuración de 2FA: genera secreto pendiente + QR
accountRouter.post('/2fa/setup', wrap(async (req, res) => {
  const u = users.getById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const secret = generateSecret();
  users.set2faPending(u.id, secret);
  const uri = otpauthUri(secret, u.username, 'PBI');
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
  res.json({ secret, otpauthUri: uri, qr });
}));

// Confirmar y activar 2FA con un código del autenticador
accountRouter.post('/2fa/enable', wrap(async (req, res) => {
  const key = `enable:${req.user.userId}`;
  const wait = twofaLimiter.locked(key);
  if (wait) { res.set('Retry-After', String(wait)); return res.status(429).json({ error: `Demasiados intentos. Reinténtalo en ${Math.ceil(wait / 60)} min.` }); }
  const u = users.getById(req.user.userId);
  if (!u?.totpPending) return res.status(400).json({ error: 'Inicia primero la configuración de 2FA' });
  const counter = verifyToken(u.totpPending, req.body?.code);
  if (counter < 0) {
    twofaLimiter.record(key, false);
    return res.status(400).json({ error: 'Código incorrecto. Revisa la hora del dispositivo e inténtalo de nuevo.' });
  }
  twofaLimiter.record(key, true);
  users.recordTotpCounter(u.id, counter);
  const out = users.enable2fa(u.id);
  audit(req, 'account.2fa_enable', u.username, 'ok');
  res.json(out);
}));

// Desactivar 2FA (requiere un código válido si está activo)
accountRouter.post('/2fa/disable', wrap(async (req, res) => {
  const key = `disable:${req.user.userId}`;
  const wait = twofaLimiter.locked(key);
  if (wait) { res.set('Retry-After', String(wait)); return res.status(429).json({ error: `Demasiados intentos. Reinténtalo en ${Math.ceil(wait / 60)} min.` }); }
  const u = users.getById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.totpEnabled) {
    const counter = verifyToken(u.totpSecret, req.body?.code);
    if (counter < 0 || counter <= (u.lastTotpCounter ?? -1)) {
      twofaLimiter.record(key, false);
      return res.status(400).json({ error: 'Código incorrecto' });
    }
    users.recordTotpCounter(u.id, counter);
  }
  twofaLimiter.record(key, true);
  const out = users.disable2fa(u.id);
  audit(req, 'account.2fa_disable', u.username, 'ok');
  res.json(out);
}));
