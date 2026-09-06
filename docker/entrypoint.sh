#!/bin/sh
# Container entrypoint: generate the sane-airscan config from SCANNER_URL
# (unless the user mounted their own), then hand over to the bot.
set -eu

AIRSCAN_CONF=/etc/sane.d/airscan.conf

if [ -n "${SCANNER_URL:-}" ]; then
  if [ -f "$AIRSCAN_CONF.mounted" ]; then
    echo "entrypoint: SCANNER_URL is set but $AIRSCAN_CONF is mounted; leaving it alone" >&2
  else
    cat > "$AIRSCAN_CONF" <<CONF
# generated from SCANNER_URL by scanner-bot entrypoint
[devices]
"Scanner" = ${SCANNER_URL}

[options]
discovery = disable
CONF
  fi
fi

# Self-test hook: SANE's virtual "test" backend renders synthetic pages, so the
# whole pipeline can be exercised without hardware (docker/selftest.sh).
if [ "${SANE_ENABLE_TEST_BACKEND:-}" = "1" ]; then
  mkdir -p /etc/sane.d/dll.d
  echo test > /etc/sane.d/dll.d/selftest
fi

# cups-client reads CUPS_SERVER from the environment; nothing to do here.
exec node /app/dist/index.js "$@"
