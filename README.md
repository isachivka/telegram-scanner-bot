# telegram-scanner-bot

Turn the network scanner and printer you already own into a service you can drive from **Telegram** and from **AI agents** (Claude Code, Codex, Cursor, anything that speaks MCP).

- **Scan → PDF from Telegram.** Tap _Scan page_ for each sheet (or _Scan feeder_ to empty the ADF), pick colour/greyscale and DPI, tap _Finish_ and the bot sends back one PDF.
- **Print from Telegram.** Send a PDF, an image, or a photo and it comes out of the printer.
- **MCP server.** Expose `scan`, `print_file`, `print_text` and friends to an agent. The scanned pages come back as images, so the agent can _read_ the document it just scanned ("scan the letter on the glass and tell me the due date").
- **Any scanner SANE can drive** — every eSCL/AirScan network MFP (HP, Brother, Canon, Epson, Xerox…) works with just a URL; USB devices work with a `--device` mapping. **Any printer CUPS knows.**
- Single container, no database, allow-list of Telegram users, bearer token on the MCP endpoint.

```
┌──────────────┐   Telegram    ┌───────────────────────┐   eSCL / SANE   ┌───────────┐
│ your phone   │ ────────────► │                       │ ──────────────► │  scanner  │
└──────────────┘               │   telegram-scanner-bot│                 └───────────┘
┌──────────────┐  MCP (HTTP)   │   (docker container)  │   CUPS (lp)     ┌───────────┐
│ Claude Code  │ ────────────► │                       │ ──────────────► │  printer  │
└──────────────┘               └───────────────────────┘                 └───────────┘
```

## Install (5 minutes)

You need Docker on any always-on box on the same LAN as the scanner: a Raspberry Pi, a NAS, a mini PC, the router if it runs containers. The image is built for `amd64` and `arm64`.

### 1. Get the files

```bash
mkdir scanner-bot && cd scanner-bot
curl -LO https://raw.githubusercontent.com/isachivka/telegram-scanner-bot/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/isachivka/telegram-scanner-bot/main/.env.example
```

### 2. Create the Telegram bot

Open [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts, and copy the token into `.env`:

```bash
TELEGRAM_BOT_TOKEN=7123456789:AAH4x...your-token...
```

### 3. Point it at the scanner

Almost every network MFP made after ~2015 speaks eSCL (a.k.a. AirScan / "Apple AirPrint scanning") at `http://<scanner-ip>/eSCL`. Put the address in `.env`:

```bash
SCANNER_URL=http://192.168.1.50/eSCL
```

Not sure about the IP or the path? Let the container discover it:

```bash
docker compose run --rm --entrypoint airscan-discover scanner-bot
```

Typical output — copy the URL of your device:

```
[devices]
  "HP LaserJet MFP M140we" = http://192.168.1.50:80/eSCL, eSCL
```

### 4. (Optional) Point it at the printer

Printing goes through CUPS. If the Docker host already prints to your printer, the queue name is in `lpstat -p`:

```bash
$ lpstat -p
printer HP_LaserJet_MFP_M140we is idle.  enabled since Sat 06 Sep 2026 10:00:00
```

```bash
PRINTER_QUEUE=HP_LaserJet_MFP_M140we
```

No CUPS on the host? Either install it (`apt install cups`, add the printer at `http://localhost:631`) or leave `PRINTER_QUEUE` empty — the bot then simply hides the print features.

### 5. Check, then start

```bash
docker compose run --rm scanner-bot --check
```

Expected output:

```
✔ configuration parsed
✔ scanimage -L found 1 device(s)
  airscan:e0:Scanner — eSCL HP LaserJet MFP M140we ip=192.168.1.50
✔ lpstat -p HP_LaserJet_MFP_M140we: printer HP_LaserJet_MFP_M140we is idle.  enabled since ...
✔ telegram: token is valid, bot is @my_scanner_bot
  ALLOWED_USER_IDS is empty: every user is rejected and shown their id
  mcp http: disabled (MCP_HTTP_PORT unset); stdio mode available via `mcp-stdio`
```

Every `✘` line says what to fix. When it's all `✔`:

```bash
docker compose up -d
```

### 6. Allow yourself

Open your bot in Telegram, send `/start`. Because the allow-list is empty it answers:

```
Access denied.
Your Telegram user ID: 123456789
Add it to ALLOWED_USER_IDS and restart the bot.
```

Put the ID (comma-separate several) into `.env` and restart:

```bash
ALLOWED_USER_IDS=123456789
```

```bash
docker compose up -d
```

Send `/start` again — you get the menu. Done.

### Updating

```bash
docker compose pull && docker compose up -d
```

## Using it from Telegram

| Command   | What it does                                      |
| --------- | ------------------------------------------------- |
| `/start`  | Main menu: **📄 Scan**, **🖨 Print**               |
| `/cancel` | Abort the current scan or print session           |
| `/status` | Devices SANE sees, printer state, active sessions |

**Scan a multi-page document**

1. `/start` → **📄 Scan**. The session card shows the current mode / DPI / page count.
2. Put page 1 on the glass, tap **➕ Scan page**. Wait for _Done, pages scanned: 1_.
3. Repeat for every page. Change **🎨 Color / Gray** or **🔍 dpi** at any time; the buttons cycle through `SCAN_MODES` and `SCAN_DPI_OPTIONS`.
4. Tap **✅ Finish** — the bot sends `scan-20260906-101530.pdf`. Page images are wrapped into the PDF losslessly; nothing is re-encoded.

**Scan a stack with the document feeder** — set `SCAN_ADF_SOURCE` (see below), load the feeder, tap **📚 Scan feeder**. All sheets are pulled through in one go and added to the session; you can still add single pages from the glass afterwards.

**Print** — `/start` → **🖨 Print**, tap **🧮 Copies** to cycle `PRINT_COPIES_OPTIONS`, then send a PDF (as a document), an image file, or just a photo from the camera. Files above `PRINT_MAX_FILE_MB` (20 MB, the Bot API's own limit) are rejected.

Anyone not in `ALLOWED_USER_IDS` is refused and shown their ID, so onboarding a family member is: they press `/start`, you add the ID, restart.

## Using it from an AI agent (MCP)

The container can serve the [Model Context Protocol](https://modelcontextprotocol.io) over HTTP. Claude Code, Codex, Cursor, Claude Desktop — anything that can talk to a remote MCP server — then gets tools to scan and print. Scanned pages come back **as images**, so the agent reads the document it just scanned.

### 1. Enable the endpoint

Generate a token and add both lines to `.env`:

```bash
$ openssl rand -hex 24
9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e
```

```bash
MCP_HTTP_PORT=8765
MCP_AUTH_TOKEN=9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e
```

```bash
docker compose up -d
```

The token is mandatory: without it the container refuses to start rather than exposing your scanner and printer to everyone on the network. Every request must carry `Authorization: Bearer <token>`; anything else gets `401`.

Sanity check from any machine on the LAN (`<server-ip>` is the Docker host):

```bash
$ curl -s http://<server-ip>:8765/healthz
ok
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<server-ip>:8765/mcp
401
```

### 2. Connect your agent

**Claude Code** (one command, stored in `~/.claude.json`):

```bash
claude mcp add --transport http scanner http://<server-ip>:8765/mcp \
  --header "Authorization: Bearer 9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e"
```

Verify with `claude mcp list` (should show `scanner: ... - ✓ Connected`) or `/mcp` inside a session.

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.scanner]
url = "http://<server-ip>:8765/mcp"
http_headers = { Authorization = "Bearer 9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e" }
```

**Cursor** — `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "scanner": {
      "url": "http://<server-ip>:8765/mcp",
      "headers": {
        "Authorization": "Bearer 9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e"
      }
    }
  }
}
```

**Claude Desktop / other clients without header support** — bridge through `mcp-remote`:

```json
{
  "mcpServers": {
    "scanner": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://<server-ip>:8765/mcp",
        "--header",
        "Authorization: Bearer 9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e"
      ]
    }
  }
}
```

### 3. Talk to it

Things that work out of the box, in plain language:

- _"Scan the letter on the scanner and tell me what it says and when the deadline is."_
- _"Scan the whole stack in the feeder in greyscale at 200 dpi and save it as `rent-contract`."_
- _"List my scans and delete everything older than last week."_
- _"Print https://example.com/ticket.pdf, two copies."_ → `print_file` with `url`
- _"Print `~/Downloads/contract.pdf`."_ → the agent uploads it with `curl -T` and calls `print_file` with `path` (see below)
- _"Print a shopping list: milk, eggs, bread, coffee."_ → `print_text`
- _"Is the printer online?"_ → `printer_status`

### How files move (and why your context stays clean)

Nothing is pushed through the agent's context unless the agent asks for it. Files travel as **links**:

- `scan` stores `<name>.pdf` and the page images on the server and returns **signed URLs** for them:

  ```
  Scanned 2 page(s) at 300 dpi (Color).
  rent-contract: 2 page(s), 412337 bytes
  PDF: http://192.168.1.10:8765/files/rent-contract.pdf?exp=1758000000&sig=9f3c…
  page 1: http://192.168.1.10:8765/files/rent-contract/page_001.jpg?exp=…&sig=…
  page 2: http://192.168.1.10:8765/files/rent-contract/page_002.jpg?exp=…&sig=…
  ```

  A signed link needs **no auth header**: paste it into a browser, `curl -O` it, hand it to the user, put it in a message. It cannot be forged (HMAC with the MCP token) and expires after `FILE_LINK_TTL_SEC` (7 days by default). With the bearer header you can also fetch `/files/<path>` without a signature.

- To **read** a scan, the agent asks for images explicitly — `get_scan` with `as=images` (optionally one `page`), or `include_images=true` on `scan`. That is the only time image bytes enter the context.

- `print_file` takes a **`url`** (anything http(s) the server can reach, including its own links — those are resolved locally without a download), a **`path`** on the server (a scan's `pdf_path`, or `uploads/<name>`), or, as a last resort for tiny files, `content_base64`.

- To print a file that lives on the **agent's machine**, upload it first — one `curl`, no base64:

  ```bash
  curl -T ~/Downloads/contract.pdf \
    -H "Authorization: Bearer <MCP_AUTH_TOKEN>" \
    http://<server-ip>:8765/files/uploads/contract.pdf
  ```

  ```json
  {
    "path": "uploads/contract.pdf",
    "server_path": "/data/scans/uploads/contract.pdf",
    "bytes": 184233,
    "url": "http://<server-ip>:8765/files/uploads/contract.pdf?exp=…&sig=…"
  }
  ```

  then `print_file` with `path: "uploads/contract.pdf"`. Agents that can run shell commands (Claude Code, Codex) do this on their own once they see the tool description. Uploads are capped at `UPLOAD_MAX_MB` (50).

Links use the host the client connected through (`192.168.1.10:8765` above). Behind a reverse proxy or a DNS name, set `PUBLIC_URL=https://scanner.example.net` so links point where clients can reach.

Under the hood the agent sees these tools:

| Tool             | Purpose                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan`           | Scan the glass (`source=flatbed`, default) or the whole feeder (`source=feeder`). Stores `<name>.pdf` + page images on the server, returns download links and paths; `include_images=true` also inlines the first 10 pages. Params: `mode`, `dpi`, `name`. |
| `list_scans`     | Stored scans, newest first, with links.                                                                                                                                                                                                                    |
| `get_scan`       | A stored scan as links (`as=links`, default), page images (`as=images`, optional `page`), or PDF bytes (`as=pdf`).                                                                                                                                         |
| `delete_scan`    | Remove a stored scan.                                                                                                                                                                                                                                      |
| `list_scanners`  | `scanimage -L` — what SANE sees and which device is configured.                                                                                                                                                                                            |
| `printer_status` | `lpstat -p` for the configured queue. _(printer only)_                                                                                                                                                                                                     |
| `print_file`     | Print a PDF / image / text file by `url`, server `path`, or (small files) base64. Images are wrapped into a PDF. _(printer only)_                                                                                                                          |
| `print_text`     | Print plain text — notes, lists, letters. _(printer only)_                                                                                                                                                                                                 |

HTTP routes on the same port: `POST/GET/DELETE /mcp` (MCP, bearer), `GET /files/<path>?exp&sig` (signed download, or bearer), `PUT /files/uploads/<name>` (upload, bearer), `GET /healthz`.

Stored scans are also exposed as MCP resources (`scan://<name>.pdf`). They and the uploads live in the `scans` volume (`SCAN_OUTPUT_DIR`, default `/data/scans`), so `docker compose down` doesn't lose them.

### MCP without Telegram

Leave `TELEGRAM_BOT_TOKEN` empty and only the MCP endpoint runs. `--check` and everything else work the same.

### Local (stdio) mode

If the agent runs on the same machine as the scanner and you'd rather not open a port at all:

```bash
claude mcp add scanner -- docker run -i --rm --network host --env-file .env \
  ghcr.io/isachivka/telegram-scanner-bot mcp-stdio
```

Or without Docker, from a checkout: `npm ci && npm run build && node dist/index.js mcp-stdio` (needs `scanimage`, `img2pdf`, and `lp` on the PATH).

### Security notes

- Bearer token on every MCP request and on uploads, compared in constant time. No token, no start.
- Download links are HMAC-signed with the token and expire; a leaked link exposes one file until `FILE_LINK_TTL_SEC` runs out, never the token.
- Plain HTTP. Keep it on your LAN / VPN (Tailscale, WireGuard) or put a TLS-terminating reverse proxy in front; don't expose it to the internet as-is.
- `print_file` with a `path` prints any file the container can read. The container only sees its own filesystem and the `scans` volume — don't mount things you wouldn't want printed.
- Rotate the token by changing `MCP_AUTH_TOKEN` and restarting; clients need the new value.

## Complete `.env` example

An HP LaserJet MFP with a feeder, printing through the host's CUPS, Telegram for the family, MCP for Claude Code:

```bash
TELEGRAM_BOT_TOKEN=7123456789:AAH4x...
ALLOWED_USER_IDS=123456789,987654321
BOT_LANGUAGE=en

SCANNER_URL=http://192.168.1.50/eSCL
SCAN_MODES=Color,Gray
SCAN_DPI_OPTIONS=150,300,600
SCAN_DEFAULT_DPI=300
SCAN_ADF_SOURCE=ADF

PRINTER_QUEUE=HP_LaserJet_MFP_M140we

MCP_HTTP_PORT=8765
MCP_AUTH_TOKEN=9f3c1b7a0d4e8c2f6a5b1d9e7c3a2f4b8d6e0c1a3b5d7f9e
```

## Configuration reference

All settings are environment variables (see [`.env.example`](.env.example)).

| Variable               | Default            | Description                                                                                                                            |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`   | —                  | From @BotFather. Unset = Telegram disabled (MCP-only deployment).                                                                      |
| `ALLOWED_USER_IDS`     | _(empty)_          | Comma-separated Telegram user IDs. Empty = everyone rejected (they're shown their ID).                                                 |
| `BOT_LANGUAGE`         | `en`               | `en` or `ru`. PRs for more languages welcome — it's one file.                                                                          |
| `SCANNER_URL`          | —                  | eSCL/WSD URL of the scanner. Generates `/etc/sane.d/airscan.conf` at start-up.                                                         |
| `SCANNER_DEVICE`       | _(derived)_        | SANE device name. Defaults to `airscan:e0:Scanner` when `SCANNER_URL` is set; unset both and SANE picks the first device it discovers. |
| `SCAN_MODES`           | `Color,Gray`       | Modes offered, as `scanimage --mode` spells them for your device (`scanimage -A` lists them).                                          |
| `SCAN_DEFAULT_MODE`    | first of modes     |                                                                                                                                        |
| `SCAN_DPI_OPTIONS`     | `200,300,600`      | Resolutions offered.                                                                                                                   |
| `SCAN_DEFAULT_DPI`     | `300` if offered   |                                                                                                                                        |
| `SCAN_SOURCE`          | —                  | `--source` for single-page scans (rarely needed).                                                                                      |
| `SCAN_ADF_SOURCE`      | —                  | `--source` of the document feeder (`ADF`, `ADF Duplex`, …). Enables feeder scanning.                                                   |
| `SCAN_FORMAT`          | `jpeg`             | `jpeg` or `png` for the page images.                                                                                                   |
| `SCANIMAGE_EXTRA_ARGS` | —                  | Extra `scanimage` flags, whitespace-separated (`-x 210 -y 297`, `--brightness=10`…).                                                   |
| `SCAN_TIMEOUT_SEC`     | `180`              | Per-page timeout; feeder runs get 10×.                                                                                                 |
| `SCAN_TMP_DIR`         | `/tmp/scanner-bot` | Scratch space for in-progress sessions; wiped on start.                                                                                |
| `PRINTER_QUEUE`        | —                  | CUPS queue. Unset = printing disabled.                                                                                                 |
| `CUPS_SERVER`          | `localhost`        | Read by cups-client: `host[:port]` of the CUPS server.                                                                                 |
| `PRINT_COPIES_OPTIONS` | `1,2,3,5,10`       | Copies the Telegram button cycles through.                                                                                             |
| `PRINT_MAX_FILE_MB`    | `20`               | Largest file to accept for printing via Telegram.                                                                                      |
| `MCP_HTTP_PORT`        | —                  | Enables the MCP endpoint. Requires `MCP_AUTH_TOKEN` (≥16 chars).                                                                       |
| `MCP_HTTP_HOST`        | `0.0.0.0`          |                                                                                                                                        |
| `MCP_HTTP_PATH`        | `/mcp`             |                                                                                                                                        |
| `SCAN_OUTPUT_DIR`      | `/data/scans`      | Where MCP scans are stored.                                                                                                            |
| `LOG_LEVEL`            | `info`             | pino level.                                                                                                                            |

## Networking

`docker-compose.yml` uses `network_mode: host` because:

- sane-airscan discovers scanners over mDNS/WS-Discovery, which doesn't cross Docker's bridge, and
- `CUPS_SERVER=localhost` then reaches a CUPS daemon on the Docker host.

If you'd rather use bridge networking: set `SCANNER_URL` (discovery is disabled then, so no mDNS needed), set `CUPS_SERVER` to the host's LAN IP or `host.docker.internal`, and publish `MCP_HTTP_PORT`. Make sure CUPS accepts remote clients (`cupsctl --share-printers --remote-any` or a `Listen`/`Allow` in `cupsd.conf`).

**USB scanners** need the device passed through (`devices: ["/dev/bus/usb:/dev/bus/usb"]`) and usually `privileged: true`; set `SCANNER_DEVICE` to the name from `scanimage -L`.

## Troubleshooting

Run `docker compose run --rm scanner-bot --check` first — it tells you which of the three legs (scanner, printer, Telegram) is broken.

- **`scanimage -L` finds nothing.** Wrong `SCANNER_URL`, or the scanner only speaks WSD: try `http://<ip>:80/eSCL`, `https://<ip>/eSCL`, or run `airscan-discover` inside the container. Some devices sleep — wake them by pressing a button before scanning.
- **`Invalid argument` / `unsupported mode`.** Your device names modes differently (`Colour`, `Lineart`, `24bit Color`…). `docker compose run --rm --entrypoint scanimage scanner-bot -d airscan:e0:Scanner -A` lists what it accepts; set `SCAN_MODES` accordingly.
- **Feeder scans stop after one page.** Set `SCAN_ADF_SOURCE` to the exact source name from `scanimage -A` (`ADF`, `Automatic Document Feeder`, `ADF Duplex`).
- **`lp: The printer or class does not exist.`** `PRINTER_QUEUE` must match `lpstat -p` on the CUPS server, and the container must be able to reach it (`CUPS_SERVER`).
- **Telegram says the file is too big.** Bots can't download files over 20 MB through the public Bot API. Use the MCP `print_file` with a `path`, or a local Bot API server.

## Development

```bash
npm ci
npm test            # unit + end-to-end tests with fake scanimage/img2pdf/lp binaries
npm run lint && npm run typecheck
npm run dev         # tsx watch, reads .env from the shell (e.g. `set -a; . ./.env; set +a`)
docker build -t telegram-scanner-bot:dev . && docker/selftest.sh telegram-scanner-bot:dev
```

The test suite drives the real bot and the real MCP server against stub binaries in [`test/fakebin`](test/fakebin), so it runs anywhere. The Docker self-test scans with SANE's built-in `test` backend and calls the MCP endpoint with curl, so CI proves the image works end to end without hardware.

Layout: `src/core` (scanner, PDF, printer — shared), `src/telegram` (bot, conversations, i18n), `src/mcp` (tools, resources, HTTP/stdio transports).

## License

MIT
