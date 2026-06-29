import { Router } from 'express';
import { requireAdmin } from '../session.js';
import { listAudit, getAuditConfig, saveAuditConfig } from '../auditLog.js';

export const auditRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

auditRouter.get('/', requireAdmin, wrap(async (req, res) => {
  const { page, limit, user, action, from, to } = req.query;
  res.json(listAudit({
    page: page ? Number(page) : 1,
    limit: limit ? Math.min(Number(limit), 500) : 100,
    user: user || undefined,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
  }));
}));

auditRouter.get('/config', requireAdmin, (req, res) => {
  res.json(getAuditConfig());
});

auditRouter.put('/config', requireAdmin, wrap(async (req, res) => {
  const { maxSizeMb, maxFiles } = req.body || {};
  const ms = Number(maxSizeMb);
  const mf = Number(maxFiles);
  if (!ms || ms < 1 || ms > 1000) return res.status(400).json({ error: 'maxSizeMb debe estar entre 1 y 1000' });
  if (!mf || mf < 1 || mf > 20) return res.status(400).json({ error: 'maxFiles debe estar entre 1 y 20' });
  saveAuditConfig({ maxSizeMb: ms, maxFiles: mf });
  res.json({ ok: true });
}));
