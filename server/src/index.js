import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';
import { panelAuthRouter } from './routes/panelAuth.js';
import { usersRouter } from './routes/users.js';
import { accountRouter } from './routes/account.js';
import { requireAuth, requireAdmin } from './session.js';
import { hostsRouter } from './routes/hosts.js';
import { pveRouter } from './routes/pve.js';
import { notifyRouter } from './routes/notify.js';
import { reportRouter } from './routes/report.js';
import { apiRouter } from './routes/api.js';
import { startNotifier } from './notifier.js';
import { migrateSecrets as migrateHostSecrets } from './hostStore.js';
import { migrateSecrets as migratePveSecrets } from './pveStore.js';
import { migrateSecrets as migrateNotifySecrets } from './notifyStore.js';
import { startReportScheduler } from './reportScheduler.js';

const app = express();

app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  }),
);

// Sello de tiempo para informes
app.use((req, _res, next) => {
  req.now = new Date().toISOString();
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, pbsHost: config.pbs.host });
});

// Autenticación del panel (público)
app.use('/api/auth', panelAuthRouter);

// A partir de aquí, todo /api exige sesión válida
app.use('/api', requireAuth);

app.use('/api/account', accountRouter);
app.use('/api/users', requireAdmin, usersRouter);
app.use('/api/hosts', hostsRouter);
app.use('/api/pve', pveRouter);
app.use('/api/notify', notifyRouter);
app.use('/api/report', reportRouter);
app.use('/api', apiRouter);

// Frontend compilado (producción): sirve web/dist y hace fallback SPA a index.html
if (config.webDir) {
  app.use(express.static(config.webDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(config.webDir, 'index.html'));
  });
}

// Manejador de errores centralizado
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Error interno', details: err.pbs || undefined });
});

const server = config.tls.enabled
  ? https.createServer({ cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) }, app)
  : http.createServer(app);

server.listen(config.port, () => {
  const proto = config.tls.enabled ? 'https' : 'http';
  console.log(`PBI backend escuchando en ${proto}://localhost:${config.port}`);
  console.log(`  TLS:       ${config.tls.enabled ? 'ACTIVADO (HTTPS)' : 'desactivado (HTTP)'}`);
  console.log(`  PBS host:  ${config.pbs.host}`);
  // Cifra en reposo cualquier secreto que viniera en texto plano (instalaciones previas)
  try { migrateHostSecrets(); migratePveSecrets(); migrateNotifySecrets(); } catch (e) { console.warn('Aviso: migración de secretos:', e.message); }
  startNotifier();
  startReportScheduler();
});
