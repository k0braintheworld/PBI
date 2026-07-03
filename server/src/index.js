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
import { securityRouter } from './routes/security.js';
import { configBackupRouter } from './routes/configBackup.js';
import { centralRouter } from './routes/central.js';
import { requireAuth, requireAdmin, requireOperator } from './session.js';
import { hostsRouter } from './routes/hosts.js';
import { pveRouter } from './routes/pve.js';
import { notifyRouter } from './routes/notify.js';
import { reportRouter } from './routes/report.js';
import { restoreJobsRouter } from './routes/restoreJobs.js';
import { updateRouter } from './routes/update.js';
import { apiRouter } from './routes/api.js';
import { auditRouter } from './routes/audit.js';
import { startNotifier } from './notifier.js';
import { startCentralReporter } from './centralReporter.js';
import { migrateSecrets as migrateHostSecrets } from './hostStore.js';
import { migrateSecrets as migratePveSecrets } from './pveStore.js';
import { migrateSecrets as migrateNotifySecrets } from './notifyStore.js';
import { startReportScheduler } from './reportScheduler.js';
import { startRestoreWatcher } from './restoreWatcher.js';
import { startRestoreScheduler } from './restoreScheduler.js';

// Seguridad: no arrancar con el SESSION_SECRET por defecto (firma de cookies y
// clave de cifrado de secretos dependen de él). Se puede saltar en desarrollo
// con PBI_ALLOW_INSECURE_SECRET=1.
if (['', 'dev-secret-change-me', 'CHANGE_ME'].includes(config.sessionSecret || '') && process.env.PBI_ALLOW_INSECURE_SECRET !== '1') {
  console.error('[FATAL] SESSION_SECRET no está configurado (o es el valor por defecto).');
  console.error('        Define SESSION_SECRET (en /etc/pbi/pbi.env o el entorno) con un valor aleatorio.');
  console.error('        Solo para desarrollo puedes arrancar con PBI_ALLOW_INSECURE_SECRET=1.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// Detrás de un proxy inverso (TLS termination), TRUST_PROXY hace que `req.ip` y las
// cabeceras X-Forwarded-* sean del cliente real. Sin él, NO se confía en
// X-Forwarded-For (no es falsificable): `req.ip` = IP del socket.
if (process.env.TRUST_PROXY) {
  const n = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(n) && n > 0 ? n : process.env.TRUST_PROXY);
}

app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  }),
);

// Cabeceras de seguridad basicas (sin dependencias). No se fuerza una CSP
// estricta para no romper los estilos en linea ni el aviso de actualizaciones
// (fetch a la API de GitHub); queda pendiente como mejora aparte.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// CSRF (defensa en profundidad): las peticiones que modifican estado deben
// llevar una cabecera personalizada que un formulario cross-site no puede
// fijar sin preflight (que CORS bloquearía). Las GET/HEAD/OPTIONS quedan libres.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('X-Requested-With') === 'pbi') return next();
  return res.status(403).json({ error: 'Petición rechazada (falta cabecera anti-CSRF)' });
});

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
app.use('/api/security', securityRouter);
app.use('/api/config-backup', configBackupRouter);
app.use('/api/central', requireAdmin, centralRouter);
app.use('/api/users', requireAdmin, usersRouter);
app.use('/api/audit', auditRouter);
app.use('/api/hosts', hostsRouter);
app.use('/api/pve', requireOperator, pveRouter);
app.use('/api/notify', requireOperator, notifyRouter);
app.use('/api/report', reportRouter);
app.use('/api/restore-jobs', requireOperator, restoreJobsRouter);
app.use('/api/update', requireAdmin, updateRouter);
app.use('/api', apiRouter);

// Frontend compilado (producción): sirve web/dist y hace fallback SPA a index.html
if (config.webDir) {
  app.use(express.static(config.webDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(config.webDir, 'index.html'));
  });
}

// Manejador de errores centralizado. El detalle crudo del upstream (PBS/PVE) solo
// se expone a administradores; al resto se le da únicamente el mensaje.
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  const details = req.user?.role === 'admin' ? (err.pbs || undefined) : undefined;
  res.status(status).json({ error: err.message || 'Error interno', details });
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
  startCentralReporter();
  startReportScheduler();
  startRestoreWatcher();
  startRestoreScheduler();
});
