import https from 'node:https';
import { URL } from 'node:url';
import { config } from './config.js';

/**
 * Cliente de bajo nivel para la API de Proxmox Backup Server.
 *
 * Soporta los dos modos de autenticación de PBS:
 *  - 'token':  Authorization: PBSAPIToken=<user@realm!tokenid>:<secret>
 *  - 'ticket': Cookie PBSAuthCookie=<ticket> (+ CSRFPreventionToken en escrituras)
 *
 * La verificación TLS es configurable porque PBS usa un certificado
 * autofirmado por defecto.
 */

const REQUEST_TIMEOUT_MS = 15000;

// Agentes HTTPS COMPARTIDOS y acotados (uno por modo verifyTls). Crear un agente
// nuevo por petición con keepAlive filtra sockets que se acumulan hasta agotar el
// proxy de PBS; con un agente reutilizado las conexiones se reciclan y se limitan.
const _agents = new Map();
function buildAgent(verifyTls) {
  const key = verifyTls ? 'v' : 'n';
  let a = _agents.get(key);
  if (!a) {
    a = new https.Agent({
      rejectUnauthorized: !!verifyTls,
      keepAlive: true,
      keepAliveMsecs: 10000,
      maxSockets: 8,        // máx. conexiones simultáneas por host
      maxFreeSockets: 2,    // máx. en reposo
      timeout: 30000,       // cierra los sockets inactivos
    });
    _agents.set(key, a);
  }
  return a;
}

/**
 * Realiza una petición a la API de PBS.
 *
 * @param {object} opts
 * @param {string} opts.host       Base, p.ej. https://host:8007 (sin /api2/json)
 * @param {boolean} opts.verifyTls Verificar el certificado TLS
 * @param {string} opts.method     GET | POST | PUT | DELETE
 * @param {string} opts.path       Ruta bajo /api2/json, p.ej. /admin/datastore
 * @param {object} [opts.query]    Parámetros de query
 * @param {object} [opts.body]     Cuerpo (se envía form-urlencoded como espera PBS)
 * @param {object} [opts.auth]     Contexto de auth { mode, ... }
 * @returns {Promise<{status:number, data:any, raw:string}>}
 */
export function pbsRequest({ host, verifyTls, method = 'GET', path, query, body, auth }) {
  const base = host || config.pbs.host;
  const url = new URL(`${base}/api2/json${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = { Accept: 'application/json' };
  let payload;

  if (body && (method === 'POST' || method === 'PUT')) {
    payload = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) payload.append(k, String(v));
    }
    payload = payload.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  // Inyectar la autenticación
  if (auth) {
    if (auth.mode === 'token') {
      headers['Authorization'] = `PBSAPIToken=${auth.tokenId}:${auth.secret}`;
    } else if (auth.mode === 'ticket') {
      headers['Cookie'] = `PBSAuthCookie=${auth.ticket}`;
      if (method !== 'GET' && auth.csrf) {
        headers['CSRFPreventionToken'] = auth.csrf;
      }
    }
  }

  const options = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    headers,
    agent: buildAgent(verifyTls ?? config.pbs.verifyTls),
    timeout: REQUEST_TIMEOUT_MS,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });
    // Evita que un host inalcanzable bloquee la petición indefinidamente.
    req.on('timeout', () => {
      req.destroy(new Error(`Tiempo de espera agotado conectando con ${url.host}`));
    });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Obtiene un ticket de autenticación (modo usuario/contraseña).
 * Devuelve { ticket, csrf, username }.
 */
export async function pbsLogin({ host, verifyTls, username, password }) {
  const res = await pbsRequest({
    host,
    verifyTls,
    method: 'POST',
    path: '/access/ticket',
    body: { username, password },
  });
  if (res.status !== 200 || !res.data?.data?.ticket) {
    const msg = res.data?.errors || res.data?.message || `Login fallido (HTTP ${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status === 0 ? 502 : res.status;
    throw err;
  }
  const d = res.data.data;
  return {
    ticket: d.ticket,
    csrf: d.CSRFPreventionToken,
    username: d.username || username,
  };
}

/**
 * Helper de alto nivel: lanza una petición autenticada y devuelve `data.data`
 * (la API de PBS envuelve todo en { data: ... }). Lanza Error con .status
 * en caso de error HTTP.
 */
export async function pbsCall(auth, { method = 'GET', path, query, body, host, verifyTls } = {}) {
  const res = await pbsRequest({
    host: host || auth?.host,
    verifyTls: verifyTls ?? auth?.verifyTls,
    method,
    path,
    query,
    body,
    auth,
  });
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data?.errors || res.data?.message || (res.raw ? res.raw.trim().slice(0, 400) : '');
    const msg = detail || `Error PBS (HTTP ${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status === 0 ? 502 : res.status;
    err.pbs = res.data;
    throw err;
  }
  return res.data?.data;
}
