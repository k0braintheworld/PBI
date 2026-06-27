import { Router } from 'express';
import * as users from '../userStore.js';
import { destroyUserSessions } from '../session.js';

/** Gestión de usuarios (solo admin; el montaje aplica requireAuth + requireAdmin). */
export const usersRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

usersRouter.get('/', (req, res) => res.json(users.listUsers()));

usersRouter.post('/', wrap(async (req, res) => {
  const { username, password, role } = req.body || {};
  if ((password || '').length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  res.json(users.addUser({ username, password, role }));
}));

usersRouter.put('/:id', wrap(async (req, res) => {
  const { role, password, username, resetTotp } = req.body || {};
  if (password && password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const u = users.updateUser(req.params.id, { role, password, username, resetTotp });
  // Forzar re-login del usuario editado (cambió nombre/contraseña/rol/2FA)
  destroyUserSessions(req.params.id);
  res.json(u);
}));

usersRouter.delete('/:id', wrap(async (req, res) => {
  const r = users.deleteUser(req.params.id, req.user.userId);
  destroyUserSessions(req.params.id);
  res.json(r);
}));
