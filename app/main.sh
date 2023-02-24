#!/usr/bin/env bash
set -xv
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
(
  cd "$SCRIPT_DIR"
  cd client
  npm install
  npm run prod
)

python "$SCRIPT_DIR"/server
