# Aurum Watch / 金哨

[中文](README.md) | English

Aurum Watch is a deployable gold market monitor and sentiment-impact forecasting web app for XAU/USD, AU9999, USD/CNH, domestic premiums, and real news-driven market signals.

## Current Scope

- Dashboard page based on the provided dark financial dashboard design.
- No Settings page for now; all configuration is managed by the backend `.env`.
- Real data only. The app does not generate mock market, news, or prediction data.
- OANDA provides XAU/USD and USD/CNH. Only `OANDA_API_TOKEN` is required; the backend discovers the account id from OANDA.
- NewsNow provides real news events.
- AU9999 is read from AKTools `spot_quotations_sge(symbol="Au99.99")`.
- SQLite persists quote snapshots and news events.
- PWA manifest, service worker, offline fallback, and Docker Compose are included.

## Local Development

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:5173`.

Set these values in `.env` for OANDA:

```ini
OANDA_API_TOKEN=your-token
OANDA_ENV=practice
REFRESH_INTERVAL_MS=1000
```

Use `OANDA_ENV=live` only for a live OANDA account.
`REFRESH_INTERVAL_MS` controls the backend real-data polling interval. The default is 1000 ms.

AU9999 setup:

```bash
pip install aktools
python -m aktools --host 0.0.0.0 --port 8080
```

Then set `.env`:

```ini
AKTOOLS_BASE_URL=http://127.0.0.1:8080
AKTOOLS_AU9999_SYMBOL=Au99.99
```

AKTools exposes AKShare functions over HTTP; this app calls `/api/public/spot_quotations_sge?symbol=Au99.99`.

## Production Build

```bash
bun run build
node dist-server/index.js
```

The production server listens on `http://localhost:8787` and serves `/api/*`, `/ws`, and the built frontend.

## Docker

```bash
docker compose up --build
```
