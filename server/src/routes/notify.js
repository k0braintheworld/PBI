import { Router } from 'express';
import * as store from '../notifyStore.js';
import { getDefaultHost } from '../hostStore.js';
import { getDefaultPve } from '../pveStore.js';
import { authForHost } from '../authResolver.js';
import { pveSilenceBackupJobs, pveListNotificationMatchers, pveSetNotificationMatcherDisabled } from '../pveService.js';
import { setNotificationMatcherDisabled, listNotificationMatchers } from '../pbsService.js';
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

// Silenciar / restaurar las notificaciones nativas de Proxmox (evita duplicados).
// Silencia TODOS los matchers de notificación de PVE y PBS (backup, verify, prune,
// GC, sync, replicación…) para que solo PBI notifique. Se recuerda qué matchers se
// desactivaron para restaurar exactamente esos (sin tocar los que el usuario ya
// tenía desactivados por su cuenta).
notifyRouter.post('/silence-proxmox', wrap(async (req, res) => {
  const enable = !!req.body?.enable;
  const prev = store.getRaw().silencedMatchers || { pbs: [], pve: [] };
  const result = { enable, pve: null, pbs: null };
  const silenced = { pbs: [], pve: [] };

  const pve = getDefaultPve();
  if (pve) {
    try {
      // 1) Trabajos vzdump: sin correo directo (legacy sendmail sin mailto)
      const jobs = await pveSilenceBackupJobs(pve, enable);
      // 2) Sistema de notificaciones del datacenter (PVE 8.1+): todos los matchers
      let touched = [];
      let supported = true;
      try {
        if (enable) {
          const matchers = (await pveListNotificationMatchers(pve)) || [];
          for (const m of matchers) {
            if (m.disable) continue; // respetar los ya desactivados por el usuario
            try { await pveSetNotificationMatcherDisabled(pve, m.name, true); touched.push(m.name); } catch { /* seguir */ }
          }
        } else {
          const names = prev.pve?.length ? prev.pve : ['default-matcher'];
          for (const name of names) {
            try { await pveSetNotificationMatcherDisabled(pve, name, false); touched.push(name); } catch { /* seguir */ }
          }
        }
      } catch { supported = false; } // PVE antiguo sin API de notificaciones
      silenced.pve = enable ? touched : [];
      result.pve = { ...jobs, matchers: touched.length, matchersSupported: supported };
    } catch (e) { result.pve = { error: e.message }; }
  } else result.pve = { error: 'Sin conexión Proxmox VE configurada' };

  const host = getDefaultHost();
  if (host) {
    try {
      const auth = await authForHost(host);
      let touched = [];
      if (enable) {
        const matchers = await listNotificationMatchers(auth).catch(() => null);
        if (Array.isArray(matchers)) {
          for (const m of matchers) {
            if (m.disable) continue;
            try { await setNotificationMatcherDisabled(auth, m.name, true); touched.push(m.name); } catch { /* seguir */ }
          }
        } else {
          // PBS sin listado de matchers: al menos el matcher por defecto
          await setNotificationMatcherDisabled(auth, 'default-matcher', true);
          touched.push('default-matcher');
        }
      } else {
        const names = prev.pbs?.length ? prev.pbs : ['default-matcher'];
        for (const name of names) {
          try { await setNotificationMatcherDisabled(auth, name, false); touched.push(name); } catch { /* seguir */ }
        }
      }
      silenced.pbs = enable ? touched : [];
      result.pbs = { ok: true, matchers: touched.length };
    } catch (e) { result.pbs = { error: e.message }; }
  } else result.pbs = { error: 'Sin host PBS configurado' };

  store.update({ silenceProxmox: enable, silencedMatchers: silenced });
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
