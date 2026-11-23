#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${DSH_TEST_NODE:-}" ]; then
  exec "$DSH_TEST_NODE" "$SCRIPT_DIR/run-tests.mjs" "$@"
fi
DESKTOP_HELPER='/Applications/DSH Desktop.app/Contents/Frameworks/DSH Desktop Helper.app/Contents/MacOS/DSH Desktop Helper'
if [ -x "$DESKTOP_HELPER" ]; then
  export ELECTRON_RUN_AS_NODE=1
  export DSH_KERNEL_ROOT="${DSH_KERNEL_ROOT:-/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules}"
  exec "$DESKTOP_HELPER" "$SCRIPT_DIR/run-tests.mjs" "$@"
fi
exec node "$SCRIPT_DIR/run-tests.mjs" "$@"
