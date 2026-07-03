// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Logo de PBI: escudo (seguridad/backup) con la "X" de Proxmox dentro,
 * formada por 4 cuñas blancas con el hueco central característico.
 * SVG autocontenido, escalable y con degradado naranja Proxmox.
 */
export default function Logo({ size = 36, shadow = true }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', filter: shadow ? 'drop-shadow(0 2px 5px rgba(232,115,12,.45))' : 'none' }}
      role="img" aria-label="PBI — Proxmox Backup Interface"
    >
      <defs>
        <linearGradient id="pbiShield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7a44e" />
          <stop offset="55%" stopColor="#ee8021" />
          <stop offset="100%" stopColor="#db6406" />
        </linearGradient>
        <linearGradient id="pbiGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Escudo */}
      <path
        d="M24 3.5 L40.5 8.8 L40.5 23 C40.5 33.4 33.2 40.8 24 45 C14.8 40.8 7.5 33.4 7.5 23 L7.5 8.8 Z"
        fill="url(#pbiShield)" stroke="#c8590a" strokeWidth="0.6"
      />
      {/* Brillo superior */}
      <path d="M24 3.5 L40.5 8.8 L40.5 15.5 C31 11.8 17 11.8 7.5 15.5 L7.5 8.8 Z" fill="url(#pbiGloss)" />

      {/* X de Proxmox: 4 cuñas blancas con hueco central */}
      <g fill="#ffffff">
        <polygon points="17.1,12.9 12.9,17.1 18.9,23.1 23.1,18.9" />
        <polygon points="30.9,12.9 35.1,17.1 29.1,23.1 24.9,18.9" />
        <polygon points="12.9,31.9 17.1,36.1 23.1,30.1 18.9,25.9" />
        <polygon points="35.1,31.9 30.9,36.1 24.9,30.1 29.1,25.9" />
      </g>
    </svg>
  );
}
