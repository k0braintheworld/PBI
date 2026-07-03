#!/usr/bin/env bash
# Construye el paquete .deb de PBI (con runtime de Node incluido).
# Uso:  packaging/build-deb.sh [version]
set -euo pipefail

VERSION="${1:-1.0.0}"
ARCH="amd64"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_HOME="${NODE_HOME:-$HOME/.local/node}"
BUILD="$ROOT/packaging/build"
PKG="$BUILD/pkgroot"
DIST="$ROOT/packaging/dist"

echo "==> PBI .deb v$VERSION ($ARCH)"
rm -rf "$BUILD"
mkdir -p "$PKG" "$DIST"

echo "==> Compilando frontend (vite build)"
( cd "$ROOT/web" && npm run build >/dev/null )

echo "==> Preparando backend con dependencias de produccion"
mkdir -p "$PKG/opt/pbi/server"
cp -r "$ROOT/server/src" "$PKG/opt/pbi/server/"
cp "$ROOT/server/package.json" "$PKG/opt/pbi/server/"
( cd "$PKG/opt/pbi/server" && npm install --omit=dev --no-audit --no-fund --silent )

echo "==> Copiando frontend compilado"
mkdir -p "$PKG/opt/pbi/web"
cp -r "$ROOT/web/dist" "$PKG/opt/pbi/web/"

echo "==> Empaquetando runtime de Node ($NODE_HOME)"
mkdir -p "$PKG/opt/pbi/runtime/bin"
cp "$NODE_HOME/bin/node" "$PKG/opt/pbi/runtime/bin/node"

echo "==> Actualizador root (servicio oneshot + disparador por ruta, sin sudo)"
cp "$ROOT/packaging/deb/pbi-update" "$PKG/opt/pbi/pbi-update"
chmod 0755 "$PKG/opt/pbi/pbi-update"
mkdir -p "$PKG/lib/systemd/system"
cp "$ROOT/packaging/deb/pbi-update.service" "$PKG/lib/systemd/system/pbi-update.service"
cp "$ROOT/packaging/deb/pbi-update.path" "$PKG/lib/systemd/system/pbi-update.path"

echo "==> Ficheros de sistema (systemd, env, copyright)"
mkdir -p "$PKG/etc/pbi" "$PKG/lib/systemd/system" "$PKG/DEBIAN" "$PKG/usr/share/doc/pbi"
cp "$ROOT/packaging/deb/pbi.env" "$PKG/etc/pbi/pbi.env"
sed "s/__VERSION__/$VERSION/" "$ROOT/packaging/deb/pbi.service" > "$PKG/lib/systemd/system/pbi.service"
cp "$ROOT/packaging/deb/copyright" "$PKG/usr/share/doc/pbi/copyright"
cp "$ROOT/LICENSE" "$PKG/usr/share/doc/pbi/LICENSE"
sed "s/__VERSION__/$VERSION/; s/__ARCH__/$ARCH/" "$ROOT/packaging/deb/control" > "$PKG/DEBIAN/control"
cp "$ROOT/packaging/deb/conffiles" "$PKG/DEBIAN/conffiles"
for f in postinst prerm postrm; do
  cp "$ROOT/packaging/deb/$f" "$PKG/DEBIAN/$f"
  chmod 0755 "$PKG/DEBIAN/$f"
done

echo "==> Construyendo el paquete"
OUT="$DIST/pbi_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$PKG" "$OUT" >/dev/null
echo "==> Hecho:"
ls -lh "$OUT"
