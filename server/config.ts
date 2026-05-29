import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databasePath: process.env.DATABASE_PATH ?? "./data/aurum-watch.sqlite",
  refreshIntervalMs: (() => {
    const raw = Number(process.env.REFRESH_INTERVAL_MS ?? 30000);
    if (raw < 5000) {
      console.warn(`[Config Warning] REFRESH_INTERVAL_MS (${raw}ms) is too short. Enforcing safety limit of 10000ms.`);
      return 10000;
    }
    return raw;
  })(),
  oandaToken: process.env.OANDA_API_TOKEN ?? "",
  oandaEnv: process.env.OANDA_ENV === "live" ? "live" : "practice",
  aktoolsBaseUrl: process.env.AKTOOLS_BASE_URL ?? "",
  aktoolsAu9999Symbol: process.env.AKTOOLS_AU9999_SYMBOL ?? "Au99.99",
  aktoolsRefreshIntervalMs: Number(process.env.AKTOOLS_REFRESH_INTERVAL_MS ?? 10000),
  newsnowBaseUrl: process.env.NEWSNOW_BASE_URL ?? "https://newsnow.busiyi.world",
  // LLM 智能分析配置（支持 DeepSeek / OpenAI / Gemini 等兼容接口）
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
  llmModel: process.env.LLM_MODEL ?? "deepseek-chat",
  llmAnalysisIntervalMs: Number(process.env.LLM_ANALYSIS_INTERVAL_MS ?? 900000)
};

export const oandaBaseUrl =
  config.oandaEnv === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";

export const oandaStreamUrl =
  config.oandaEnv === "live"
    ? "https://stream-fxtrade.oanda.com"
    : "https://stream-fxpractice.oanda.com";
