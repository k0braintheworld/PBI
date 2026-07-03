// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as store from '../reportStore.js';
import * as notifyStore from '../notifyStore.js';
import { generateReport, generatePdf, sendReport, listMachines, generateCustomReport, generateCustomPdf } from '../reportRunner.js';
import { requireOperator } from '../session.js';
import { audit } from '../auditLog.js';

export const reportRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Configuración (+ si el SMTP está listo)
reportRouter.get('/', (req, res) => {
  const cfg = store.getRaw();
  const smtp = notifyStore.getRaw().smtp;
  res.json({ ...cfg, smtpReady: !!(smtp.host && (cfg.to || smtp.to)) });
});

reportRouter.put('/', requireOperator, wrap(async (req, res) => {
  const out = store.update(req.body || {});
  audit(req, 'report.update', '', 'ok', 'Configuración de informe periódico');
  res.json(out);
}));

// Vista previa: devuelve el HTML del informe (para abrir en el navegador)
reportRouter.get('/preview', wrap(async (req, res) => {
  const { html } = await generateReport(store.getRaw());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// Vista previa / descarga en PDF
reportRouter.get('/preview.pdf', wrap(async (req, res) => {
  const { buffer, filename } = await generatePdf(store.getRaw());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
}));

// --- Informe a medida (auditoría ISO/ENS) ---

// Lista de máquinas para seleccionar
reportRouter.get('/machines', wrap(async (req, res) => {
  res.json(await listMachines());
}));

function customOpts(req) {
  const q = req.query;
  if (!q.from || !q.to) { const e = new Error('Indica las fechas «desde» y «hasta»'); e.status = 400; throw e; }
  const from = Math.floor(new Date(`${q.from}T00:00:00`).getTime() / 1000);
  const toD = new Date(`${q.to}T00:00:00`); toD.setDate(toD.getDate() + 1);
  const to = Math.floor(toD.getTime() / 1000);
  if (!(from < to)) { const e = new Error('El rango de fechas no es válido'); e.status = 400; throw e; }
  const vmids = q.vmids ? String(q.vmids).split(',').filter(Boolean) : null;
  const reportId = `INF-${String(q.from).replace(/-/g, '')}-${1000 + Math.floor(Math.random() * 9000)}`;
  return {
    from, to, vmids, sede: q.sede || '', title: q.title || '', responsable: q.responsable || '',
    restoreTest: q.restoreTest || '', generatedBy: req.user?.username || '', reportId,
  };
}

// Vista previa HTML del informe a medida
reportRouter.get('/custom', wrap(async (req, res) => {
  const { html } = await generateCustomReport(customOpts(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// PDF del informe a medida
reportRouter.get('/custom.pdf', wrap(async (req, res) => {
  const { buffer, filename } = await generateCustomPdf(customOpts(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
}));

// Enviar ahora
reportRouter.post('/send', requireOperator, wrap(async (req, res) => {
  try {
    const { to } = await sendReport(store.getRaw());
    audit(req, 'report.send', String(to || ''), 'ok');
    res.json({ ok: true, to });
  } catch (err) {
    res.status(err.status && err.status < 500 ? err.status : 200).json({ ok: false, error: err.message });
  }
}));
