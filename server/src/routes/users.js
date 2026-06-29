import { Router } from 'express';
import * as users from '../userStore.js';
import { destroyUserSessions } from '../session.js';
import { audit } from '../auditLog.js';

/** Gestión de usuarios (solo admin; el montaje aplica requireAuth + requireAdmin). */
export const usersRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

usersRouter.get('/', (req, res) => res.json(users.listUsers()));

usersRouter.post('/', wrap(async (req, res) => {
  const { username, password, role } = req.body || {};
  if ((password || '').length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const u = users.addUser({ username, password, role });
  audit(req, 'user.create', `${u.username} (${u.role})`, 'ok');
  res.json(u);
}));

usersRouter.put('/:id', wrap(async (req, res) => {
  const { role, password, username, resetTotp } = req.body || {};
  if (password && password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const u = users.updateUser(req.params.id, { role, password, username, resetTotp });
  destroyUserSessions(req.params.id);
  const detail = [role && `rol→${role}`, password && 'contraseña', resetTotp && '2FA reset'].filter(Boolean).join(', ');
  audit(req, 'user.update', u.username, 'ok', detail);
  res.json(u);
}));

usersRouter.delete('/:id', wrap(async (req, res) => {
  const target = users.getById(req.params.id);
  const r = users.deleteUser(req.params.id, req.user.userId);
  destroyUserSessions(req.params.id);
  audit(req, 'user.delete', target?.username || req.params.id, 'ok');
  res.json(r);
}));
