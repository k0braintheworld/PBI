// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import * as store from '../notifyStore.js';
import { getDefaultHost, listHostsRaw } from '../hostStore.js';
import { listPveRaw, getDefaultPve } from '../pveStore.js';
import { authForHost } from '../authResolver.js';
import { pveSilenceBackupJobs, pveListNotificationMatchers, pveSetNotificationMatcherDisabled, pveBackupJobs } from '../pveService.js';
import { setNotificationMatcherDisabled, listNotificationMatchers, listJobs, listDatastores, getDatastoreConfig } from '../pbsService.js';
import { sendMail, buildTestEmail } from '../mailer.js';
import { getRaw as getReportCfg } from '../reportStore.js';
import * as groups from '../taskGroupStore.js';
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

  // --- Lado PVE: todas las conexiones configuradas ---
  const pves = listPveRaw();
  if (pves.length) {
    let total = 0; let changed = 0; let matchers = 0; let supported = true; const errors = [];
    for (const pve of pves) {
      try {
        // 1) Trabajos vzdump: sin correo directo (legacy sendmail sin mailto)
        const jobs = await pveSilenceBackupJobs(pve, enable);
        total += jobs.total; changed += jobs.changed;
        // 2) Sistema de notificaciones del datacenter (PVE 8.1+): todos los matchers
        try {
          if (enable) {
            const list = (await pveListNotificationMatchers(pve)) || [];
            for (const m of list) {
              if (m.disable) continue; // respetar los ya desactivados por el usuario
              try { await pveSetNotificationMatcherDisabled(pve, m.name, true); silenced.pve.push(`${pve.id}:${m.name}`); matchers += 1; } catch { /* seguir */ }
            }
          } else {
            const keys = prev.pve?.length ? prev.pve : [`${pve.id}:default-matcher`];
            const defId = getDefaultPve()?.id;
            for (const key of keys) {
              // formato nuevo `pveId:matcher`; el antiguo (solo nombre) se asigna al PVE por defecto
              const i = key.indexOf(':');
              const id = i >= 0 ? key.slice(0, i) : defId;
              const name = i >= 0 ? key.slice(i + 1) : key;
              if (id !== pve.id) continue;
              try { await pveSetNotificationMatcherDisabled(pve, name, false); matchers += 1; } catch { /* seguir */ }
            }
          }
        } catch { supported = false; } // PVE antiguo sin API de notificaciones
      } catch (e) { errors.push(`${pve.name || pve.id}: ${e.message}`); }
    }
    result.pve = { total, changed, matchers, matchersSupported: supported, ...(errors.length ? { error: errors.join(' · ') } : {}) };
  } else result.pve = { error: 'Sin conexión Proxmox VE configurada' };

  // --- Lado PBS: todos los hosts configurados ---
  const hosts = listHostsRaw();
  if (hosts.length) {
    let matchers = 0; const errors = [];
    for (const host of hosts) {
      try {
        const auth = await authForHost(host);
        if (enable) {
          const list = await listNotificationMatchers(auth).catch(() => null);
          if (Array.isArray(list)) {
            for (const m of list) {
              if (m.disable) continue;
              try { await setNotificationMatcherDisabled(auth, m.name, true); silenced.pbs.push(`${host.id}:${m.name}`); matchers += 1; } catch { /* seguir */ }
            }
          } else {
            // PBS sin listado de matchers: al menos el matcher por defecto
            await setNotificationMatcherDisabled(auth, 'default-matcher', true);
            silenced.pbs.push(`${host.id}:default-matcher`);
            matchers += 1;
          }
        } else {
          const keys = prev.pbs?.length ? prev.pbs : [`${host.id}:default-matcher`];
          const defId = getDefaultHost()?.id;
          for (const key of keys) {
            // formato nuevo `hostId:matcher`; el antiguo (solo nombre) se asigna al host por defecto
            const i = key.indexOf(':');
            const id = i >= 0 ? key.slice(0, i) : defId;
            const name = i >= 0 ? key.slice(i + 1) : key;
            if (id !== host.id) continue;
            try { await setNotificationMatcherDisabled(auth, name, false); matchers += 1; } catch { /* seguir */ }
          }
        }
      } catch (e) { errors.push(`${host.name || host.id}: ${e.message}`); }
    }
    result.pbs = { ok: true, matchers, ...(errors.length ? { error: errors.join(' · ') } : {}) };
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

// --- Grupos de tareas para el resumen agrupado ------------------------------

// Jobs habilitados detectados (para construir los grupos desde la GUI):
// copias PVE + verify/prune/sync/GC de cada host PBS. Un host/PVE que falle no
// rompe el resto (se omite).
notifyRouter.get('/enabled-jobs', wrap(async (req, res) => {
  const out = { backup: [], verify: [], prune: [], sync: [], gc: [] };

  // Copias de seguridad (PVE), de todas las conexiones configuradas.
  for (const pve of listPveRaw()) {
    try {
      const jobs = (await pveBackupJobs(pve)) || [];
      for (const j of jobs) {
        if (j.enabled === 0 || j.enabled === '0') continue;
        out.backup.push({
          scope: pve.id, scopeName: pve.name || pve.host, ref: String(j.id),
          label: j.comment || String(j.id), schedule: j.schedule || '',
          all: j.all === 1 || j.all === '1', vmid: j.vmid || '', exclude: j.exclude || '',
        });
      }
    } catch { /* PVE no disponible: omitir */ }
  }

  // verify/prune/sync + GC por host PBS.
  for (const host of listHostsRaw()) {
    let auth;
    try { auth = await authForHost(host); } catch { continue; }
    for (const kind of ['verify', 'prune', 'sync']) {
      try {
        const jobs = (await listJobs(auth, kind)) || [];
        for (const j of jobs) {
          if (j.disable) continue;
          out[kind].push({
            scope: host.id, scopeName: host.name || host.host, ref: String(j.id),
            label: `${j.id}${j.store ? ` · ${j.store}` : ''}`, store: j.store || '', schedule: j.schedule || '',
          });
        }
      } catch { /* tipo/host no disponible: omitir */ }
    }
    try {
      const dss = (await listDatastores(auth)) || [];
      for (const ds of dss) {
        try {
          const cfg = await getDatastoreConfig(auth, ds.store);
          if (cfg?.['gc-schedule']) {
            out.gc.push({
              scope: host.id, scopeName: host.name || host.host, ref: ds.store,
              label: ds.store, store: ds.store, schedule: cfg['gc-schedule'],
            });
          }
        } catch { /* sin config/permite: omitir */ }
      }
    } catch { /* sin datastores: omitir */ }
  }

  res.json(out);
}));

notifyRouter.get('/groups', (req, res) => res.json(groups.listGroups()));

notifyRouter.post('/groups', wrap(async (req, res) => {
  const g = groups.createGroup(req.body || {});
  audit(req, 'notify.group_create', g.name, 'ok', `${g.members.length} miembro(s)`);
  res.json(g);
}));

notifyRouter.put('/groups/:id', wrap(async (req, res) => {
  const g = groups.updateGroup(req.params.id, req.body || {});
  audit(req, 'notify.group_update', g.name, 'ok');
  res.json(g);
}));

notifyRouter.delete('/groups/:id', wrap(async (req, res) => {
  groups.deleteGroup(req.params.id);
  audit(req, 'notify.group_delete', req.params.id, 'ok');
  res.json({ ok: true });
}));
