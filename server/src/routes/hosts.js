import { Router } from 'express';
import * as store from '../hostStore.js';
import { authForHost, invalidateTicket } from '../authResolver.js';
import { pbsCall } from '../pbsClient.js';

export const hostsRouter = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Lista de hosts (sin secretos)
hostsRouter.get('/', (req, res) => {
  res.json(store.listHosts());
});

// Crear host
hostsRouter.post('/', wrap(async (req, res) => {
  if (!req.body.host) return res.status(400).json({ error: 'Falta el campo host' });
  res.json(store.addHost(req.body));
}));

// Actualizar host
hostsRouter.put('/:id', wrap(async (req, res) => {
  const updated = store.updateHost(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Host no encontrado' });
  invalidateTicket(req.params.id); // por si cambió usuario/contraseña
  res.json(updated);
}));

// Eliminar host
hostsRouter.delete('/:id', wrap(async (req, res) => {
  const ok = store.deleteHost(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Host no encontrado' });
  invalidateTicket(req.params.id);
  res.json({ ok: true });
}));

// Marcar como predeterminado
hostsRouter.post('/:id/default', wrap(async (req, res) => {
  const ok = store.setDefaultHost(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Host no encontrado' });
  res.json({ ok: true });
}));

// Probar la conexión con un host guardado
hostsRouter.post('/:id/test', wrap(async (req, res) => {
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
