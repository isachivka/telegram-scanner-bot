# Changelog

## 1.1.0 — 2026-09-06

- `ALLOWED_CHAT_IDS`: group chats where every member may use the bot. In other groups strangers are ignored silently instead of being told their ID; `/status` in a group shows the chat ID.
- One scan session per person per chat, so several people can scan in the same group.

## 1.0.0 — 2026-09-06

First public release.

- Telegram bot: scan pages one by one or the whole document feeder, choose mode and DPI, receive a single PDF; print PDFs, images, and photos.
- MCP server (Streamable HTTP with bearer token, or stdio): `scan`, `list_scans`, `get_scan`, `delete_scan`, `list_scanners`, `printer_status`, `print_file`, `print_text`; stored scans as `scan://` resources.
- Files move as signed, expiring links instead of inline blobs: `GET /files/<path>?exp&sig` downloads, `PUT /files/uploads/<name>` uploads, `print_file` accepts a `url`.
- Works with any SANE/eSCL scanner via `SCANNER_URL`, any CUPS queue via `PRINTER_QUEUE`; every option is an environment variable.
- English and Russian interface.
- `--check` command that validates scanner, printer, and Telegram configuration.
- Multi-arch Docker image on GHCR, CI with an end-to-end self-test against SANE's virtual scanner.
