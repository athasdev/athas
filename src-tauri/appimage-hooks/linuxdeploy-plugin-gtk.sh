#! /usr/bin/env bash

# Fix: Use system WebKitGTK to avoid EGL bugs in bundled version
# See: https://bugs.webkit.org/show_bug.cgi?id=297921
export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/usr/lib64:/usr/lib:${LD_LIBRARY_PATH}"

gsettings get org.gnome.desktop.interface gtk-theme 2> /dev/null | grep -qi "dark" && GTK_THEME_VARIANT="dark" || GTK_THEME_VARIANT="light"
APPIMAGE_GTK_THEME="${APPIMAGE_GTK_THEME:-"Adwaita:$GTK_THEME_VARIANT"}"

export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}"
export GTK_DATA_PREFIX="$APPDIR"
export GTK_THEME="$APPIMAGE_GTK_THEME"
export GDK_BACKEND=x11
export XDG_DATA_DIRS="$APPDIR/usr/share:/usr/share:$XDG_DATA_DIRS"
export GSETTINGS_SCHEMA_DIR="$APPDIR//usr/share/glib-2.0/schemas"
export GTK_EXE_PREFIX="$APPDIR//usr"
export GTK_PATH="$APPDIR//usr/lib/x86_64-linux-gnu/gtk-3.0:/usr/lib64/gtk-3.0:/usr/lib/x86_64-linux-gnu/gtk-3.0"
export GTK_IM_MODULE_FILE="$APPDIR//usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache"
export GDK_PIXBUF_MODULE_FILE="$APPDIR//usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export GIO_EXTRA_MODULES="$APPDIR/usr/lib/x86_64-linux-gnu/gio/modules"
