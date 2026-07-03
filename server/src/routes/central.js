import { Router } from 'express';
import * as store from '../centralStore.js';
import { sendNow } from '../centralReporter.js';
import { audit } from '../auditLog.js';

/**
 * Configuración del emisor hacia PBI Central. Solo admin (se monta con requireAdmin).
 * GET/PUT de la config + POST /test para forzar un envío y ver el resultado.
 */

export const centralRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

centralRouter.get('/', (req, res) => res.json(store.masked()));

centralRouter.put('/', wrap(async (req, res) => {
  const out = store.update(req.body || {});
  audit(req, 'central.update', '', 'ok', `Emisor ${out.enabled ? 'activado' : 'desactivado'}${out.url ? ` → ${out.url}` : ''}`);
  res.json(out);
}));

// Fuerza una recolección + envío inmediato (para probar la conexión al central).
centralRouter.post('/test', wrap(async (req, res) => {
  const r = await sendNow();
  audit(req, 'central.test', '', r.ok ? 'ok' : 'fail', r.ok ? `Enviado (seq ${r.sequence})` : `Error: ${r.error}`);
  res.json(r);
}));
