#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Optional first argument: the exact Node binary selected in Plesk.
if [ "$#" -gt 0 ]; then
  NODE="$1"
elif [ -x /opt/plesk/node/22/bin/node ]; then
  NODE=/opt/plesk/node/22/bin/node
elif [ -x /opt/plesk/node/24/bin/node ]; then
  NODE=/opt/plesk/node/24/bin/node
else
  NODE=node
fi
exec "$NODE" "$ROOT/deploy.cjs"
