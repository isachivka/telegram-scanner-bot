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

## Quick start

Requirements: Docker on a machine on the same LAN as the scanner (a Raspberry Pi, a NAS, a home server — the image is built for amd64 and arm64).

```bash
mkdir scanner-bot && cd scanner-bot
curl -LO https://raw.githubusercontent.com/isachivka/telegram-scanner-bot/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/isachivka/telegram-scanner-bot/main/.env.example
```

Edit `.env`:

1. `TELEGRAM_BOT_TOKEN` — create a bot with [@BotFather](https://t.me/BotFather).
2. `SCANNER_URL` — the scanner's eSCL address. Almost every network MFP made after ~2015 answers at `http://<scanner-ip>/eSCL`. Not sure? Let the container find it:
   ```bash
   docker compose run --rm --entrypoint airscan-discover scanner-bot
   ```
3. `PRINTER_QUEUE` — optional, the CUPS queue name (`lpstat -p` on the host). Skip it and the print features hide themselves.

Check everything before going live:

```bash
docker compose run --rm scanner-bot --check
```

It lists the scanners SANE sees, queries the printer, and validates the Telegram token. Then:

```bash
docker compose up -d
```

Open the bot in Telegram and send `/start`. It replies _Access denied_ together with your user ID — put that ID into `ALLOWED_USER_IDS`, run `docker compose up -d` again, and you're in.

## Telegram usage

| Command   | What it does                                      |
| --------- | ------------------------------------------------- |
| `/start`  | Main menu: **Scan**, **Print**                    |
| `/cancel` | Abort the current scan or print session           |
| `/status` | Devices SANE sees, printer state, active sessions |

**Scanning.** _Scan page_ scans one sheet from the glass; press it once per page. _Scan feeder_ (shown when `SCAN_ADF_SOURCE` is set) pulls every sheet through the ADF in one go. The mode and DPI buttons cycle through the values in `SCAN_MODES` / `SCAN_DPI_OPTIONS`. _Finish_ assembles the pages into `scan-YYYYMMDD-HHMMSS.pdf` and sends it back; images are wrapped losslessly, nothing is re-encoded.

**Printing.** _Print_ then send a PDF (as a document), an image file, or a plain photo. The copies button cycles through `PRINT_COPIES_OPTIONS`. Files above `PRINT_MAX_FILE_MB` (20 MB, the Bot API's download limit) are rejected.

## MCP server (scan and print from an AI agent)

The container can serve the [Model Context Protocol](https://modelcontextprotocol.io) over Streamable HTTP so an agent on another machine can use the scanner and printer. Enable it in `.env`:

```bash
MCP_HTTP_PORT=8765
MCP_AUTH_TOKEN=$(openssl rand -hex 24)   # paste the value, not the command
```

Restart, then connect a client. Claude Code:

```bash
claude mcp add --transport http scanner http://<server-ip>:8765/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.scanner]
url = "http://<server-ip>:8765/mcp"
http_headers = { Authorization = "Bearer <MCP_AUTH_TOKEN>" }
```

Any other client that supports remote HTTP MCP servers with custom headers works the same way. Then just ask: _"scan what's on the scanner and summarise it"_, _"print this PDF, two copies"_, _"print a shopping list: milk, eggs, bread"_.

### Tools

| Tool             | Purpose                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan`           | Scan the glass (`source=flatbed`, default) or the whole feeder (`source=feeder`). Stores `<name>.pdf` + page images on the server, returns the page images inline (first 10) so the agent can read them. Params: `mode`, `dpi`, `name`, `include_images`. |
| `list_scans`     | Stored scans, newest first.                                                                                                                                                                                                                               |
| `get_scan`       | A stored scan as page images (`as=images`, optional `page`) or as the PDF bytes (`as=pdf`).                                                                                                                                                               |
| `delete_scan`    | Remove a stored scan.                                                                                                                                                                                                                                     |
| `list_scanners`  | `scanimage -L` — what SANE sees and which device is configured.                                                                                                                                                                                           |
| `printer_status` | `lpstat -p` for the configured queue. _(printer only)_                                                                                                                                                                                                    |
| `print_file`     | Print a PDF / image / text file by server path (e.g. a scan's `pdf_path`) or as base64 bytes with a filename. _(printer only)_                                                                                                                            |
| `print_text`     | Print plain text — notes, lists, letters. _(printer only)_                                                                                                                                                                                                |

Stored scans are also exposed as MCP resources (`scan://<name>.pdf`). Scans live in the `scans` volume (`SCAN_OUTPUT_DIR`, default `/data/scans`).

### Local (stdio) mode

If the agent runs on the same machine as the scanner and you'd rather not open a port:

```bash
claude mcp add scanner -- docker run -i --rm --network host --env-file .env \
  ghcr.io/isachivka/telegram-scanner-bot mcp-stdio
```

Or without Docker, from a checkout: `npm run build && node dist/index.js mcp-stdio` (needs `scanimage`, `img2pdf`, and `lp` on the PATH).

### Security notes

- The HTTP endpoint refuses to start without `MCP_AUTH_TOKEN`; every request must carry `Authorization: Bearer <token>`. Compare is constant-time.
- It speaks plain HTTP. Keep it on your LAN / VPN (Tailscale, WireGuard) or put a TLS-terminating reverse proxy in front of it; don't expose it to the internet as-is.
- `print_file` with a `path` prints any file the container can read. The container only sees its own filesystem and the `scans` volume — don't mount things you wouldn't want printed.

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
