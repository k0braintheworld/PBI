// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { getHostRaw, getDefaultHost } from './hostStore.js';
import { pbsLogin } from './pbsClient.js';

/**
 * Construye el contexto de autenticación a partir de un host guardado.
 *
 * - token:  usa directamente tokenId + secret.
 * - ticket: hace login contra PBS para obtener ticket + CSRF y los cachea
 *           en memoria (los tickets de PBS caducan ~2h).
 */

const ticketCache = new Map(); // hostId -> { ticket, csrf, expires }
const TICKET_TTL_MS = 1000 * 60 * 100; // 100 min

async function buildAuth(host) {
  const base = { host: host.host, verifyTls: host.verifyTls, node: host.node || 'localhost' };

  if (host.authMode === 'token') {
    if (!host.tokenId || !host.secret) {
      throw httpErr(400, `El host "${host.name}" no tiene token configurado`);
    }
    return { mode: 'token', tokenId: host.tokenId, secret: host.secret, ...base };
  }

  // Modo ticket (usuario/contraseña)
  const cached = ticketCache.get(host.id);
  if (cached && cached.expires > Date.now()) {
    return { mode: 'ticket', ticket: cached.ticket, csrf: cached.csrf, ...base };
  }
  if (!host.username || !host.password) {
    throw httpErr(400, `El host "${host.name}" no tiene usuario/contraseña configurados`);
  }
  const { ticket, csrf } = await pbsLogin({
    host: host.host,
    verifyTls: host.verifyTls,
    username: host.username,
    password: host.password,
  });
  ticketCache.set(host.id, { ticket, csrf, expires: Date.now() + TICKET_TTL_MS });
  return { mode: 'ticket', ticket, csrf, ...base };
}

export function invalidateTicket(hostId) {
  ticketCache.delete(hostId);
}

/**
 * Middleware: resuelve el host activo (cabecera X-PBS-Host o el host por
 * defecto) y adjunta req.auth. Devuelve 400 si no hay hosts configurados.
 */
export async function resolveAuth(req, res, next) {
  try {
    // Cabecera para llamadas XHR; query param para descargas directas (CSV).
    const hostId = req.get('X-PBS-Host') || req.query.host;
    const host = hostId ? getHostRaw(hostId) : getDefaultHost();
    if (!host) {
      return res.status(409).json({ error: 'NO_HOSTS', message: 'No hay ningún host PBS configurado' });
    }
    req.pbsHost = host;
    req.auth = await buildAuth(host);
    next();
  } catch (err) {
    next(err);
  }
}

/** Igual que resolveAuth pero usable de forma directa para un host concreto. */
export async function authForHost(host) {
  return buildAuth(host);
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
