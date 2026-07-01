import { Router } from 'express';
import { getSecurity, updateSecurity } from '../securityStore.js';
import { requireAdmin } from '../session.js';
import { audit } from '../auditLog.js';

export const securityRouter = Router();

// Cualquier usuario autenticado puede leer el ajuste (el cliente lo necesita
// para su temporizador de inactividad).
securityRouter.get('/', (req, res) => res.json(getSecurity()));

// Solo administradores pueden cambiarlo.
securityRouter.put('/', requireAdmin, (req, res) => {
  const out = updateSecurity(req.body || {});
  audit(req, 'security.update', '', 'ok', `Inactividad: ${out.sessionIdleMinutes} min`, { username: req.user?.username, role: req.user?.role });
  res.json(out);
});
