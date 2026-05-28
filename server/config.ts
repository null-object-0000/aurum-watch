import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databasePath: process.env.DATABASE_PATH ?? "./data/aurum-watch.sqlite",
  refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS ?? 1000),
  oandaToken: process.env.OANDA_API_TOKEN ?? "",
  oandaEnv: process.env.OANDA_ENV === "live" ? "live" : "practice",
  aktoolsBaseUrl: process.env.AKTOOLS_BASE_URL ?? "",
  aktoolsAu9999Symbol: process.env.AKTOOLS_AU9999_SYMBOL ?? "Au99.99",
  aktoolsRefreshIntervalMs: Number(process.env.AKTOOLS_REFRESH_INTERVAL_MS ?? 10000),
  newsQuery: process.env.NEWS_QUERY ?? "gold OR XAUUSD OR Fed OR inflation OR war"
};

export const oandaBaseUrl =
  config.oandaEnv === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
