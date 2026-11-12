#!/usr/bin/env bash
# Copyright (c) 2018-Present Lea Anthony
# SPDX-License-Identifier: MIT

# Fail script on any error
set -euxo pipefail

# Define variables
APP_DIR="${APP_NAME}.AppDir"

# Create AppDir structure
mkdir -p "${APP_DIR}/usr/bin"
cp -r "${APP_BINARY}" "${APP_DIR}/usr/bin/"
cp "${ICON_PATH}" "${APP_DIR}/"
cp "${DESKTOP_FILE}" "${APP_DIR}/"

cat << EOF > "${APP_DIR}/AppRun"
#!/bin/sh
HERE="\$(dirname "\$(readlink -f "\${0}")")"
exec "\${HERE}/usr/bin/${APP_NAME}" "\$@"
EOF

chmod +x "${APP_DIR}/AppRun"
chmod +x "${APP_DIR}/usr/bin/"*
chmod -R a+rX "${APP_DIR}"

export LDAI_NO_CHECK_PERMISSIONS=1

if [[ $(uname -m) == *x86_64* ]]; then
    # Download linuxdeploy and make it executable
    wget -q -N https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
    chmod +x linuxdeploy-x86_64.AppImage

    # Run linuxdeploy to bundle the application (works in containers without FUSE)
    APPIMAGE_EXTRACT_AND_RUN=1 ./linuxdeploy-x86_64.AppImage --appdir "${APP_DIR}" --output appimage
else
    # Download linuxdeploy and make it executable (arm64)
    wget -q -N https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-aarch64.AppImage
    chmod +x linuxdeploy-aarch64.AppImage

    # Run linuxdeploy to bundle the application (arm64)
    APPIMAGE_EXTRACT_AND_RUN=1 ./linuxdeploy-aarch64.AppImage --appdir "${APP_DIR}" --output appimage
fi

# Rename the generated AppImage (exclude the downloaded linuxdeploy binary)
shopt -s nullglob
generated_appimage=""
for candidate in *.AppImage; do
    if [[ "$candidate" != linuxdeploy-* ]]; then
        generated_appimage="$candidate"
        break
    fi
done
shopt -u nullglob
if [[ -z "$generated_appimage" ]]; then
    echo "Error: no AppImage generated in $(pwd)" >&2
    exit 1
fi
mv "$generated_appimage" "${APP_NAME}.AppImage"

