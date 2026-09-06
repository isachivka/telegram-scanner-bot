#!/bin/sh
# Exercise the built image end to end without hardware:
#  1. SANE's `test` backend stands in for the scanner (it renders synthetic pages),
#  2. img2pdf assembles the PDF,
#  3. the MCP HTTP endpoint is driven with plain curl through a real `scan` call.
# Usage: docker/selftest.sh <image>
set -eu
IMAGE="${1:?image}"
TOKEN=selftest-token-0123456789
NAME="scanner-bot-selftest-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "--- --check with the SANE test backend"
docker run --rm -e SANE_ENABLE_TEST_BACKEND=1 -e SCANNER_DEVICE=test:0 -e MCP_HTTP_PORT=8765 -e MCP_AUTH_TOKEN="$TOKEN" "$IMAGE" --check

echo "--- start MCP endpoint"
docker run -d --name "$NAME" -p 127.0.0.1:18765:8765 \
  -e SANE_ENABLE_TEST_BACKEND=1 -e SCANNER_DEVICE=test:0 -e SCAN_DPI_OPTIONS=50,75 -e SCAN_DEFAULT_DPI=50 \
  -e MCP_HTTP_PORT=8765 -e MCP_AUTH_TOKEN="$TOKEN" "$IMAGE" >/dev/null
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:18765/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:18765/healthz

echo "--- unauthenticated request is rejected"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:18765/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}')
[ "$code" = "401" ] || { echo "expected 401, got $code"; exit 1; }

echo "--- initialize"
HDRS=$(mktemp)
curl -fsS -D "$HDRS" -o /dev/null -X POST http://127.0.0.1:18765/mcp \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
SESSION=$(grep -i '^mcp-session-id:' "$HDRS" | tr -d '\r' | awk '{print $2}')
[ -n "$SESSION" ] || { echo "no mcp-session-id header"; cat "$HDRS"; exit 1; }
curl -fsS -o /dev/null -X POST http://127.0.0.1:18765/mcp \
  -H "authorization: Bearer $TOKEN" -H "mcp-session-id: $SESSION" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "--- tools/call scan (flatbed, test backend)"
OUT=$(mktemp)
curl -fsS -o "$OUT" -X POST http://127.0.0.1:18765/mcp \
  -H "authorization: Bearer $TOKEN" -H "mcp-session-id: $SESSION" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan","arguments":{"name":"selftest","include_images":true}}}'
# Response is either JSON or an SSE stream; strip "data:" prefixes and look at the last JSON object.
grep -q '"pdf_path"' "$OUT" || { echo "scan did not return pdf_path:"; cat "$OUT"; exit 1; }
grep -q '"isError":true' "$OUT" && { echo "scan reported an error:"; cat "$OUT"; exit 1; }
grep -q '"type":"image"' "$OUT" || { echo "scan did not inline the page image:"; cat "$OUT"; exit 1; }

echo "--- stored PDF is a real PDF"
docker exec "$NAME" sh -c 'head -c 5 /data/scans/selftest.pdf' | grep -q '%PDF-' || { echo "not a PDF"; exit 1; }
docker exec "$NAME" ls -l /data/scans/selftest.pdf /data/scans/selftest/

echo "--- container log"
docker logs "$NAME" 2>&1 | tail -5
echo "selftest OK"
