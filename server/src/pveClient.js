// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import https from 'node:https';
import { URL } from 'node:url';

/**
 * Cliente de la API de Proxmox VE.
 * Autenticación por API token: header
 *   Authorization: PVEAPIToken=<user@realm!tokenid>=<secret>
 */

const TIMEOUT_MS = 30000;

// Agentes HTTPS COMPARTIDOS y acotados (uno por modo verifyTls): evitan el filtrado
// de sockets que se acumulan al crear un agente nuevo en cada petición.
const _agents = new Map();
function agent(verifyTls) {
  const key = verifyTls ? 'v' : 'n';
  let a = _agents.get(key);
  if (!a) {
    a = new https.Agent({
      rejectUnauthorized: !!verifyTls,
      keepAlive: true,
      keepAliveMsecs: 10000,
      maxSockets: 8,
      maxFreeSockets: 2,
      timeout: 30000,
    });
    _agents.set(key, a);
  }
  return a;
}

function authHeader(pve) {
  return `PVEAPIToken=${pve.tokenId}=${pve.secret}`;
}

function buildOptions(pve, { method, path, query, payload, timeoutMs }) {
  const url = new URL(`${pve.host}/api2/json${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: 'application/json', Authorization: authHeader(pve) };
  if (payload) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return {
    method,
    hostname: url.hostname,
    port: url.port || 8006,
    path: url.pathname + url.search,
    headers,
    agent: agent(pve.verifyTls),
    timeout: timeoutMs || TIMEOUT_MS,
    _url: url,
  };
}

function encodeBody(body) {
  if (!body) return undefined;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  }
  return p.toString();
}

/** Llamada JSON. Devuelve data.data (PVE envuelve en { data: ... }). */
export function pveCall(pve, { method = 'GET', path, query, body, timeoutMs } = {}) {
  const payload = (method === 'POST' || method === 'PUT') ? encodeBody(body) : undefined;
  const options = buildOptions(pve, { method, path, query, payload, timeoutMs });

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = data?.errors ? JSON.stringify(data.errors) : (raw || `HTTP ${res.statusCode}`);
          const err = new Error(msg);
          err.status = res.statusCode;
          return reject(err);
        }
        resolve(data?.data);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout conectando con ${options._url.host}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Descarga en streaming: canaliza la respuesta de PVE directamente a `res`
 * (para file-restore de ficheros grandes). Propaga cabeceras relevantes.
 */
export function pveStream(pve, { path, query }, res, fallbackName = 'download') {
  const options = buildOptions(pve, { method: 'GET', path, query });
  const req = https.request(options, (pres) => {
    if (pres.statusCode < 200 || pres.statusCode >= 300) {
      let raw = '';
      pres.on('data', (c) => (raw += c));
      pres.on('end', () => {
        res.status(pres.statusCode || 502).json({ error: `PVE respondió ${pres.statusCode}`, detail: raw.slice(0, 300) });
      });
      return;
    }
    const cd = pres.headers['content-disposition'];
    res.setHeader('Content-Disposition', cd || `attachment; filename="${fallbackName}"`);
    res.setHeader('Content-Type', pres.headers['content-type'] || 'application/octet-stream');
    if (pres.headers['content-length']) res.setHeader('Content-Length', pres.headers['content-length']);
    pres.pipe(res);
  });
  req.on('timeout', () => req.destroy(new Error('Timeout en la descarga')));
  req.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });
  req.end();
}
