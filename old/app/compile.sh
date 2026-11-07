#!/usr/bin/env bash
set -exv
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
(
  cd "$SCRIPT_DIR"/client

  npm install
  npm run prod

  mkdir -p "$SCRIPT_DIR"/server/static/dist
  rm "$SCRIPT_DIR"/server/static/dist/*.js || true
  rm "$SCRIPT_DIR"/server/static/dist/*.css || true

  ln dist/*.js "$SCRIPT_DIR"/server/static/dist
  ln dist/*.css "$SCRIPT_DIR"/server/static/dist
)
