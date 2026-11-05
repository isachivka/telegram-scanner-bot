# Changelog

## 1.2.3 — 2026-11-05

- Photo mode speaks plainly when something fails: a failed scan says to check the scanner and press "Scan" again instead of showing `scanner cancelled the scan job (HTTP 410)`; details stay in the log, logged once instead of again on every later message.
- A failed Immich upload keeps the photo and the answers and offers "Retry upload" / "Discard".

## 1.2.2 — 2026-11-05

- Photo scans over eSCL take two passes: the whole platen at 300 dpi to find the photo, then only the photo's region at `PHOTO_DPI`. The HP Laser MFP 135w cancels a full-platen 600 dpi job (410 Gone, `JobCanceledByTimeOut`) as soon as the picture is dense from the top — a photo in the corner of the glass — but scans a photo-sized region at 600 dpi fine. It is also faster: ~34 s instead of ~40 s.
- If the high-resolution pass still fails, the 300 dpi crop is used and the preview says so.
- The detector works on a 1200 px thumbnail (was 800) for a tighter crop.

## 1.2.1 — 2026-11-05

- eSCL photo scans close their job (the trailing `NextDocument` → 404). Left open, an HP Laser MFP 135w stays "Processing" for ~90 s until it times the job out, and cancels any job posted meanwhile with 410 Gone — so a second photo right after the first failed.
- Wait for the scanner to report Idle before posting a job, and retry a job the scanner cancelled (410).

## 1.2.0 — 2026-11-05

- **Paper photos → Immich.** New main-menu mode: scan one photo at a time at the scanner's optical resolution (`PHOTO_DPI`, 600 by default, talking eSCL directly so SANE's advertised-resolution list does not cap it), crop it out of the white lid, rotate, answer roughly when ("summer 87", "late 70s", "-") and where (geocoded through Nominatim) it was taken, and upload it to Immich with that date, location, a description and an album shared with the family.
- Per-person Immich libraries via `IMMICH_API_KEYS`.
- Questions in groups use `force_reply` with a mention, so answers reach the bot in privacy mode.

## 1.1.1 — 2026-09-06

- Log the chat id and title of every group update and of bot membership changes at info level, so `docker compose logs` is enough to fill in `ALLOWED_CHAT_IDS`.

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
