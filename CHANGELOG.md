# Changelog

## 1.0.0 — 2026-09-06

First public release.

- Telegram bot: scan pages one by one or the whole document feeder, choose mode and DPI, receive a single PDF; print PDFs, images, and photos.
- MCP server (Streamable HTTP with bearer token, or stdio): `scan`, `list_scans`, `get_scan`, `delete_scan`, `list_scanners`, `printer_status`, `print_file`, `print_text`; stored scans as `scan://` resources.
- Works with any SANE/eSCL scanner via `SCANNER_URL`, any CUPS queue via `PRINTER_QUEUE`; every option is an environment variable.
- English and Russian interface.
- `--check` command that validates scanner, printer, and Telegram configuration.
- Multi-arch Docker image on GHCR, CI with an end-to-end self-test against SANE's virtual scanner.
