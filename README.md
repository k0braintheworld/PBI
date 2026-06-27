<div align="center">

# PBI · Backup interface for Proxmox

**Interfaz web libre y autoalojada para gestionar [Proxmox Backup Server](https://www.proxmox.com/proxmox-backup-server).**

**Español** · [English](README.en.md)

Software libre (GPLv3) · Proyecto independiente, sin afiliación con Proxmox.

</div>

---

PBI ofrece, en una sola interfaz clara y profesional, todo lo que necesitas para operar
tus copias de seguridad de Proxmox Backup Server (PBS): ver su estado de un vistazo,
recuperar máquinas o ficheros, programar trabajos, generar informes de cumplimiento,
limpiar copias obsoletas y recibir avisos por email — sin tener que saltar entre la
consola de PBS y la de Proxmox VE.

El **backend** actúa como proxy seguro frente a las APIs de PBS y Proxmox VE: resuelve
los certificados autofirmados, guarda las credenciales **cifradas** solo en el servidor
(nunca las devuelve al navegador) y soporta los dos modos de autenticación de PBS
(API token o usuario/contraseña). El acceso al panel está protegido con **usuario,
contraseña y 2FA opcional**, y la interfaz está disponible en **español e inglés**.

## ✨ Características

### Visión general (Dashboard)
Panel: almacenamiento por datastore, nº de snapshots, grupos protegidos y verificaciones fallidas; 
**dispositivos protegidos**
por tipo (VM / CT / Host); **calendario de copias** de las últimas 5 semanas con
código de color (correcta / parcial / con fallo / sin copia); donut de uso de
almacenamiento; últimas copias; actividad reciente; y tendencia de transferencia diaria.

### Copias de seguridad
Explorador de **snapshots** por datastore con filtro por id/propietario/comentario,
estado de verificación y tamaño. Exportación a **CSV**.

### Recuperación
Restauración guiada a través de Proxmox VE, sin tocar la consola:
- **VM/CT completa**: eliges máquina → punto de restauración → nodo, almacenamiento de
  discos y VMID destino, con opciones de **sobrescribir** y **arrancar tras restaurar**.
  Seguimiento del log **en vivo**.
- **Ficheros (granular)**: navegas por el interior del backup y descargas archivos o
  carpetas concretas (ZIP).

### Tareas programadas
- **Copias de seguridad (Proxmox VE)**: crea/edita/elimina trabajos *vzdump* con
  plantillas (diaria, GFS, etc.), selección de máquinas, retención y destino PBS.
- **Restauraciones programadas** *(novedad)*: **tests de restauración** recurrentes
  (restaura el último backup de una VM a una VMID de pruebas para validar que tus
  copias son recuperables) o restauraciones **puntuales** a una fecha/hora futura.
  Destino configurable por trabajo (VMID de pruebas o sobrescribir, marcado como
  peligroso) y **aviso por email** al terminar.
- **Jobs de PBS**: *prune* (retención), *verify* (integridad) y *sync* (réplica
  externa) — listar, crear, editar, eliminar y **lanzar** manualmente, con plantillas
  y una explicación de cada tipo.

### Monitor de tareas
Historial con **auto-refresco** cada 5 s, filtro «solo en ejecución», **porcentaje de
progreso** de las tareas en curso y visor de **log por tarea** que se actualiza en vivo.

### Informes
- **Resumen ejecutivo**: tasa de éxito, tareas correctas/fallidas, estado por datastore.
- **Informe de evidencia (ISO 27001 / ENS)**: informe completo para un rango de fechas
  y máquinas concretas, con metadatos de auditoría, alcance, política por máquina
  (RPO/retención/modo), estado de cifrado y copia externa, calendario y declaración —
  vista previa en **HTML** y descarga en **PDF**.
- **Informe periódico por email**: programable (diario/semanal/mensual), con el informe
  en HTML y el **PDF adjunto**; permite indicar la **sede**.
- Descargas **CSV** de snapshots e historial de tareas.

### Limpieza
Tabla de **grupos de backup** con detección de **huérfanos** (copias cuya VM ya no
existe en Proxmox VE), borrado por grupo o por snapshot —con resaltado de copias
antiguas para casos de **reutilización de VMID**— y **Garbage Collection** por datastore
para reclamar el espacio físico en disco.

### Notificaciones por email
Vigilante en segundo plano que envía un email **limpio y estructurado** cuando termina
una tarea (tipos y éxito/fallo configurables) y cuando termina una **restauración**
(manual o programada). Opción para **silenciar las notificaciones nativas de Proxmox**
(PVE y PBS) y evitar emails duplicados. Configuración SMTP con **email de prueba**.

### Seguridad y multiusuario
- **Acceso protegido**: login con usuario/contraseña y **2FA (TOTP)** opcional; en el
  primer arranque se crea la cuenta de administrador.
- **Usuarios y roles**: administradores (gestionan todo) y operadores; el admin puede
  crear/editar usuarios, cambiar contraseñas y **restablecer la 2FA** de otros.
- **Secretos cifrados en reposo** (AES-256-GCM): los token secrets de PBS/PVE y la
  contraseña SMTP se guardan cifrados; nunca se devuelven por la API.
- **HTTPS** con certificado autofirmado generado en la instalación `.deb`.

### Multi-host e idioma
Gestiona **varios servidores PBS** y cambia entre ellos con el selector de la barra
superior. Interfaz en **español / inglés** con selector ES/EN que recuerda tu elección
y detecta el idioma del navegador la primera vez.

## 🖼️ Capturas y ejemplos

Ejemplos generados con datos ficticios por el propio motor de PBI. GitHub muestra los
`.html` como código fuente; para verlos **renderizados** usa los enlaces de «ver»:

- 📄 **Informe mensual de copias** — [ver PDF](docs/examples/informe-mensual.pdf) · [ver HTML](https://htmlpreview.github.io/?https://github.com/k0braintheworld/PBI/blob/main/docs/examples/informe-mensual.html)
- ✉️ **Notificación por email** — [copia correcta](https://htmlpreview.github.io/?https://github.com/k0braintheworld/PBI/blob/main/docs/examples/notificacion-correcta.html) · [copia fallida](https://htmlpreview.github.io/?https://github.com/k0braintheworld/PBI/blob/main/docs/examples/notificacion-fallo.html)

> El PDF se renderiza nativo en GitHub. Los enlaces «ver HTML» usan
> [htmlpreview.github.io](https://htmlpreview.github.io); como alternativa permanente
> puedes activar **GitHub Pages** en el repositorio. También puedes descargar los HTML y
> abrirlos en tu navegador.

Las capturas de pantalla se colocan en `docs/screenshots/` (ver la
[guía](docs/screenshots/README.md)). Una vez añadidas, descomenta este bloque:

<!--
| Panel principal | Copias de seguridad | Recuperación |
|:---:|:---:|:---:|
| ![Panel](docs/screenshots/dashboard.png) | ![Backups](docs/screenshots/backups.png) | ![Recuperación](docs/screenshots/recovery.png) |
| **Tareas programadas** | **Informes** | **Configuración · 2FA** |
| ![Tareas](docs/screenshots/jobs.png) | ![Informes](docs/screenshots/reports.png) | ![2FA](docs/screenshots/settings-2fa.png) |
-->

## 🚀 Instalación

### Opción A — Paquete `.deb` (recomendado)

Pensado para instalar en el propio PBS o en cualquier Debian/Ubuntu. **Incluye todo lo
necesario** (runtime de Node embebido, servicio systemd y HTTPS con certificado
autofirmado): no hace falta instalar Node ni ninguna otra dependencia.

```bash
sudo dpkg -i pbi_<version>_amd64.deb
```

Al terminar, el instalador muestra la **URL de acceso** (por defecto
`https://IP_DEL_SERVIDOR:8800`). El servicio se gestiona con systemd:

```bash
systemctl status pbi      # estado
journalctl -u pbi -f      # logs en vivo
```

La configuración está en `/etc/pbi/pbi.env` y los datos persistentes (hosts, usuarios,
trabajos, etc.) en `/var/lib/pbi`.

### Opción B — Desde el código fuente (desarrollo)

Requisitos: **Node.js 18+** (desarrollado con v22).

```bash
npm install        # instala server + web (workspaces)
npm run dev        # levanta backend (:4000) y frontend (:5173)
```

Abre **http://localhost:5173**. En el primer acceso crearás la cuenta de administrador;
después te llevará a **Configuración** para añadir tu primer servidor PBS.

Para producción desde código: `npm run build` (compila el frontend) y luego `npm start`
(el backend sirve la API y el frontend compilado).

## 🧭 Primeros pasos

### Añadir un host PBS

En **Configuración → Proxmox Backup Server → Añadir host**:

- **Host**: `https://TU_HOST_PBS:8007`
- **Nodo**: nombre del nodo PBS (normalmente el hostname; por defecto `localhost`).
- **Modo de autenticación**:
  - **API Token** (recomendado): créalo en PBS en *Configuration → Access Control →
    API Tokens*. Introduce el *Token ID* (`usuario@realm!nombre`) y el *Secret*.
  - **Usuario / Contraseña**: el backend hace login y gestiona el ticket + token CSRF
    automáticamente.
- **Verificar TLS**: desmárcalo si el certificado es autofirmado (lo habitual en PBS).

Usa **⚡ Probar** para validar la conexión. Puedes guardar varios hosts y marcar uno
como **predeterminado**.

> **Permisos en PBS:** para solo lectura basta el rol `DatastoreAudit`. Para crear/
> modificar/lanzar jobs se necesitan permisos de administración (`DatastoreAdmin`,
> `Sys.Audit`, etc.) según la operación.

### Añadir una conexión Proxmox VE (para recuperación y trabajos de copia)

Las restauraciones y los trabajos de copia *vzdump* los ejecuta **Proxmox VE**. En
**Configuración → Proxmox VE → Añadir**, crea un **API token** en PVE (*Datacenter →
Permisos → API Tokens*) con permisos sobre VMs y almacenamiento. Si el token no ve los
almacenamientos, desmarca «Separación de privilegios» al crearlo o asígnale un rol
(p. ej. *Administrator*) sobre la ruta `/`.

## 🔐 Seguridad

- **Secretos cifrados en reposo** (AES-256-GCM): token secrets de PBS/PVE y contraseña
  SMTP. La clave se deriva del `SESSION_SECRET`, que en el `.deb` vive en
  `/etc/pbi/pbi.env`, **separado** de los datos en `/var/lib/pbi` — una copia del
  directorio de datos no basta para descifrarlos. *(Si cambias `SESSION_SECRET`, los
  secretos ya guardados habrá que reintroducirlos.)*
- La API **nunca** devuelve secretos (se enmascaran).
- **Sesiones** firmadas en cookie `httpOnly`; **2FA TOTP** opcional por usuario.
- **HTTPS** con certificado autofirmado en la instalación `.deb` (sustituible por uno
  propio en `/etc/pbi/pbi.env`).
- Los ficheros de datos se crean con permisos `600`.

## 🗂️ Estructura del proyecto

```
pbi/
├─ server/                  # backend Node + Express
│  └─ src/
│     ├─ index.js           # arranque + montaje de rutas y vigilantes
│     ├─ config.js          # configuración (puerto, dataDir, TLS…)
│     ├─ pbsClient/Service  # cliente y capa de datos de PBS
│     ├─ pveClient/Service  # cliente y capa de datos de Proxmox VE
│     ├─ secretCrypto.js    # cifrado de secretos en reposo (AES-256-GCM)
│     ├─ hostStore / pveStore / userStore / notifyStore / reportStore / restoreStore
│     ├─ notifier / restoreWatcher        # vigilantes de email (tareas / restauraciones)
│     ├─ reportScheduler / restoreScheduler  # programadores (informes / restauraciones)
│     ├─ mailer.js / reportPdf.js / reportService.js
│     └─ routes/            # auth, users, account, hosts, pve, notify, report, restore-jobs, api
└─ web/                     # frontend React + Vite
   └─ src/
      ├─ App.jsx            # navegación + selector de host
      ├─ i18n.jsx / i18n.en.js   # internacionalización ES/EN
      ├─ api.js             # cliente de la API + formateadores
      └─ components/        # Dashboard, Backups, Restore, Jobs, BackupJobs,
                            #   RestoreJobs, Tasks, Reports, Cleanup, Settings, About…
```

## 📜 Scripts

| Comando            | Qué hace                                            |
|--------------------|-----------------------------------------------------|
| `npm run dev`      | Backend + frontend en modo desarrollo               |
| `npm run dev:server` / `dev:web` | Solo uno de los dos                    |
| `npm run build`    | Build de producción del frontend (`web/dist`)       |
| `npm start`        | Arranca solo el backend (sirve la API y el frontend)|

El paquete `.deb` se genera con `bash packaging/build-deb.sh <versión>`.

## ⚖️ Licencia

PBI es software libre, bajo la **Licencia Pública General de GNU v3 (GPLv3)**. El texto
completo está en el fichero [`LICENSE`](LICENSE). Copyright © 2026 k0bra.

Este programa se distribuye con la esperanza de que sea útil, pero **SIN NINGUNA
GARANTÍA**. El uso de la herramienta —en especial las operaciones de **restauración** y
**eliminación de copias**— es responsabilidad exclusiva del usuario. Verifica siempre
tus copias y realiza pruebas de restauración periódicas.

### Marcas y no afiliación

«Proxmox», Proxmox Backup Server y Proxmox VE son marcas de **Proxmox Server Solutions
GmbH**. PBI es un **proyecto independiente y no oficial, sin afiliación, patrocinio ni
respaldo** de Proxmox Server Solutions GmbH. Dichos nombres se usan únicamente con fines
descriptivos y de interoperabilidad. El logotipo de PBI es una creación original.
