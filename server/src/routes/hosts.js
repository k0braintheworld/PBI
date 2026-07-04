// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as store from '../hostStore.js';
import { authForHost, invalidateTicket } from '../authResolver.js';
import { pbsCall } from '../pbsClient.js';
import { requireOperator } from '../session.js';
import { audit } from '../auditLog.js';
import { assertSafeTargetUrl } from '../netGuard.js';

export const hostsRouter = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Lista de hosts (sin secretos) — lectura permitida a cualquier rol (selector de host)
hostsRouter.get('/', (req, res) => {
  res.json(store.listHosts());
});

// A partir de aquí, las operaciones que modifican o conectan requieren operador+
// (un 'viewer' de solo lectura no puede crear/editar/borrar/probar hosts).

// Crear host
hostsRouter.post('/', requireOperator, wrap(async (req, res) => {
  if (!req.body.host) return res.status(400).json({ error: 'Falta el campo host' });
  assertSafeTargetUrl(req.body.host);
  const h = store.addHost(req.body);
  audit(req, 'host.create', `${h.name || ''} (${req.body.host})`, 'ok');
  res.json(h);
}));

// Actualizar host
hostsRouter.put('/:id', requireOperator, wrap(async (req, res) => {
  if (req.body.host) assertSafeTargetUrl(req.body.host);
  const updated = store.updateHost(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Host no encontrado' });
  invalidateTicket(req.params.id); // por si cambió usuario/contraseña
  audit(req, 'host.update', updated.name || req.params.id, 'ok');
  res.json(updated);
}));

// Eliminar host
hostsRouter.delete('/:id', requireOperator, wrap(async (req, res) => {
  const prev = store.getHostRaw(req.params.id);
  const ok = store.deleteHost(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Host no encontrado' });
  invalidateTicket(req.params.id);
  audit(req, 'host.delete', prev?.name || req.params.id, 'ok');
  res.json({ ok: true });
}));

// Marcar como predeterminado
hostsRouter.post('/:id/default', requireOperator, wrap(async (req, res) => {
  const ok = store.setDefaultHost(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Host no encontrado' });
  res.json({ ok: true });
}));

// Probar la conexión con un host guardado
hostsRouter.post('/:id/test', requireOperator, wrap(async (req, res) => {
  const host = store.getHostRaw(req.params.id);
  if (!host) return res.status(404).json({ error: 'Host no encontrado' });
  try {
    invalidateTicket(host.id);
    const auth = await authForHost(host);
    const version = await pbsCall(auth, { path: '/version' });
    res.json({ ok: true, version });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
}));

export default hostsRouter;
