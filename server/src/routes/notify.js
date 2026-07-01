import { Router } from 'express';
import * as store from '../notifyStore.js';
import { getDefaultHost } from '../hostStore.js';
import { getDefaultPve } from '../pveStore.js';
import { authForHost } from '../authResolver.js';
import { pveSilenceBackupJobs } from '../pveService.js';
import { setNotificationMatcherDisabled } from '../pbsService.js';
import { sendMail, buildTestEmail } from '../mailer.js';
import { getRaw as getReportCfg } from '../reportStore.js';
import { audit } from '../auditLog.js';

export const notifyRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Configuración actual (sin la contraseña)
notifyRouter.get('/', (req, res) => res.json(store.masked()));

// Guardar configuración
notifyRouter.put('/', wrap(async (req, res) => {
  const out = store.update(req.body || {});
  audit(req, 'notify.update', '', 'ok', `Notificaciones ${out.enabled ? 'activadas' : 'desactivadas'}`);
  res.json(out);
}));

// Silenciar / restaurar las notificaciones nativas de Proxmox (evita duplicados)
notifyRouter.post('/silence-proxmox', wrap(async (req, res) => {
  const enable = !!req.body?.enable;
  const result = { enable, pve: null, pbs: null };

  const pve = getDefaultPve();
  if (pve) {
    try { result.pve = await pveSilenceBackupJobs(pve, enable); }
    catch (e) { result.pve = { error: e.message }; }
  } else result.pve = { error: 'Sin conexión Proxmox VE configurada' };

  const host = getDefaultHost();
  if (host) {
    try {
      const auth = await authForHost(host);
      await setNotificationMatcherDisabled(auth, 'default-matcher', enable);
      result.pbs = { ok: true };
    } catch (e) { result.pbs = { error: e.message }; }
  } else result.pbs = { error: 'Sin host PBS configurado' };

  store.update({ silenceProxmox: enable });
  audit(req, 'notify.silence_proxmox', '', 'ok', enable ? 'Silenciadas' : 'Restauradas');
  res.json(result);
}));

// Enviar un email de prueba con la configuración guardada (+ overrides del body)
notifyRouter.post('/test', wrap(async (req, res) => {
  const cfg = store.getRaw();
  const smtp = { ...cfg.smtp, ...(req.body?.smtp || {}) };
  if (!smtp.pass) smtp.pass = cfg.smtp.pass; // conservar la guardada si no se reenvía
  if (!smtp.host || !smtp.to) {
    return res.status(400).json({ ok: false, error: 'Faltan el host SMTP o el destinatario' });
  }
  try {
    const host = getDefaultHost();
    const sede = getReportCfg()?.sede || '';
    await sendMail(smtp, buildTestEmail({ hostName: host?.name, sede }));
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
}));
