import { Router } from 'express';
import QRCode from 'qrcode';
import * as users from '../userStore.js';
import { generateSecret, otpauthUri, verifyToken } from '../totp.js';

/** Autoservicio del usuario autenticado: su contraseña y su 2FA. */
export const accountRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

accountRouter.get('/', (req, res) => {
  const u = users.getById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ username: u.username, role: u.role, totpEnabled: !!u.totpEnabled });
});

// Cambiar la propia contraseña
accountRouter.post('/password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  res.json(users.changePassword(req.user.userId, currentPassword, newPassword));
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
  const u = users.getById(req.user.userId);
  if (!u?.totpPending) return res.status(400).json({ error: 'Inicia primero la configuración de 2FA' });
  if (!verifyToken(u.totpPending, req.body?.code)) {
    return res.status(400).json({ error: 'Código incorrecto. Revisa la hora del dispositivo e inténtalo de nuevo.' });
  }
  res.json(users.enable2fa(u.id));
}));

// Desactivar 2FA (requiere un código válido si está activo)
accountRouter.post('/2fa/disable', wrap(async (req, res) => {
  const u = users.getById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.totpEnabled && !verifyToken(u.totpSecret, req.body?.code)) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  res.json(users.disable2fa(u.id));
}));
