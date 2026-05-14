# scanner-bot

Telegram bot that drives an HP LaserJet MFP network scanner over SANE and stitches the scanned pages into a single PDF, sent back to the user as a Telegram document.

## How it works

1. Send `/start` to the bot — main menu appears.
2. Tap **Начать сканирование** to open a session.
3. Tap **Сканировать страницу** for each physical page you want to scan. Toggle **Color/Gray** and **DPI 200/300/600** in the session menu as needed.
4. Tap **Завершить сканирование** — bot replies with a PDF document containing all scanned pages.
5. Tap **Отмена** to discard the session.

Only users whose Telegram user ID is listed in `ALLOWED_USER_IDS` can scan. Unknown users get a message with their own ID so the owner can whitelist them.

## Setup

```bash
cp .env.example .env
# paste your bot token into TELEGRAM_BOT_TOKEN, leave ALLOWED_USER_IDS empty for now
docker compose up -d --build
```

Then open the bot in Telegram, send `/start`, copy the user ID the bot replies with, add it to `ALLOWED_USER_IDS` in `.env` (comma-separated for multiple), and:

```bash
docker compose up -d
```

## Networking

The container runs with `network_mode: host` so SANE can use mDNS to auto-discover the scanner on the LAN. If you prefer bridge networking, hardcode the scanner URL in `config/airscan.conf` (`"HP MFP" = http://192.168.1.98/eSCL` + `discovery = disable`) and mount it read-only to `/etc/sane.d/airscan.conf`.

## Configuration

| Var | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs; empty = log-only |
| `SCANNER_DEVICE` | SANE device name; default matches the HP MFP at this site |
| `LOG_LEVEL` | pino level (`debug`, `info`, `warn`, `error`) |
