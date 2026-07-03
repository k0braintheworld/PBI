// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config();

const tlsCert = process.env.PBI_TLS_CERT || '';
const tlsKey = process.env.PBI_TLS_KEY || '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toBool = (v, def = false) => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',

  // Carpeta de datos persistentes (hosts.json, users.json…). En el paquete .deb
  // apunta a /var/lib/pbi para que no se pierdan al actualizar.
  dataDir: process.env.PBI_DATA_DIR || path.join(__dirname, '..', 'data'),
  // Frontend compilado a servir en producción (web/dist). Vacío = no servir (modo dev).
  webDir: process.env.PBI_WEB_DIR || '',

  // TLS/HTTPS: si hay certificado y clave válidos, el servidor arranca en HTTPS.
  tls: {
    cert: tlsCert,
    key: tlsKey,
    enabled: !!(tlsCert && tlsKey && fs.existsSync(tlsCert) && fs.existsSync(tlsKey)),
  },

  pbs: {
    // Host base sin barra final, p.ej. https://192.168.1.10:8007
    host: (process.env.PBS_HOST || 'https://localhost:8007').replace(/\/+$/, ''),
    node: process.env.PBS_NODE || 'localhost',
    verifyTls: toBool(process.env.PBS_VERIFY_TLS, false),
  },
};
