import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { config } from "./config.js";
import type { NewsEvent, Quote } from "./types.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS quotes (
    symbol TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    published_at TEXT NOT NULL
  );

  -- 秒级实时报价表（保留最近 1 小时）
  CREATE TABLE IF NOT EXISTS ticks (
    time TEXT NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (time, symbol)
  );

  -- 分钟级历史报价表（长期保留，今天之前数据只读）
  CREATE TABLE IF NOT EXISTS history_minutes (
    time TEXT NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (time, symbol)
  );
`);

// ─── Quotes ────────────────────────────────────────────────────────────────

const upsertQuote = db.prepare(`
  INSERT INTO quotes(symbol, payload, updated_at)
  VALUES (@symbol, @payload, @updatedAt)
  ON CONFLICT(symbol) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
`);

const getQuoteQuery = db.prepare(`SELECT payload FROM quotes WHERE symbol = ?`);

const getAllQuotesQuery = db.prepare(`SELECT payload FROM quotes ORDER BY symbol`);

export function getQuote(symbol: string): Quote | null {
  try {
    const row = getQuoteQuery.get(symbol) as { payload: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload) as Quote;
  } catch {
    return null;
  }
}

export function getAllQuotesFromDb(): Quote[] {
  try {
    const rows = getAllQuotesQuery.all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as Quote);
  } catch {
    return [];
  }
}

export function getEventsCount(): number {
  return (db.prepare(`SELECT COUNT(*) as cnt FROM events`).get() as { cnt: number }).cnt;
}

export function saveQuotes(quotes: Quote[]) {
  db.exec("BEGIN");
  try {
    for (const quote of quotes) {
      upsertQuote.run({
        symbol: quote.symbol,
        payload: JSON.stringify(quote),
        updatedAt: new Date().toISOString()
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteQuoteFromDb(symbol: string) {
  db.prepare(`DELETE FROM quotes WHERE symbol = ?`).run(symbol);
}

export function clearQuotesInDb() {
  db.exec(`DELETE FROM quotes`);
}

// ─── Events ────────────────────────────────────────────────────────────────

const upsertEvent = db.prepare(`
  INSERT INTO events(id, payload, published_at)
  VALUES (@id, @payload, @publishedAt)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, published_at = excluded.published_at
`);

const getAllEventsQuery = db.prepare(`
  SELECT payload FROM events ORDER BY published_at DESC
`);

export function getAllEventsFromDb(): NewsEvent[] {
  try {
    const rows = getAllEventsQuery.all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as NewsEvent);
  } catch {
    return [];
  }
}

export function saveEvents(events: NewsEvent[]) {
  db.exec("BEGIN");
  try {
    for (const event of events) {
      upsertEvent.run({
        id: event.id,
        payload: JSON.stringify(event),
        publishedAt: event.time
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteEventFromDb(id: string) {
  db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
}

export function clearEventsInDb() {
  db.exec(`DELETE FROM events`);
}

// ─── Ticks (秒级，保留近 1 小时) ─────────────────────────────────────────

const upsertTick = db.prepare(`
  INSERT INTO ticks(time, symbol, price)
  VALUES (@time, @symbol, @price)
  ON CONFLICT(time, symbol) DO UPDATE SET price = excluded.price
`);

export function saveTick(symbol: string, price: number, time: string) {
  upsertTick.run({ time, symbol, price });
}

export function cleanOldTicks(beforeTime: string) {
  db.prepare(`DELETE FROM ticks WHERE time < ?`).run(beforeTime);
}

export function getRecentTicks(symbol: string, afterTime: string): Array<{ time: string; price: number }> {
  const rows = db
    .prepare(`SELECT time, price FROM ticks WHERE symbol = ? AND time >= ? ORDER BY time ASC`)
    .all(symbol, afterTime) as Array<{ time: string; price: number }>;
  return rows;
}

// ─── History Minutes (分钟级，长期保留) ──────────────────────────────────

const upsertHistoryMinute = db.prepare(`
  INSERT INTO history_minutes(time, symbol, price)
  VALUES (@time, @symbol, @price)
  ON CONFLICT(time, symbol) DO UPDATE SET price = excluded.price
`);

export function saveHistoryMinute(symbol: string, price: number, time: string) {
  // 对齐到分钟（截断秒）
  const aligned = alignToMinute(time);
  upsertHistoryMinute.run({ time: aligned, symbol, price });
}

export function bulkSaveHistoryMinutes(rows: Array<{ symbol: string; price: number; time: string }>) {
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const aligned = alignToMinute(row.time);
      upsertHistoryMinute.run({ time: aligned, symbol: row.symbol, price: row.price });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 将指定分钟内的 ticks 聚合（取最后一个 price，即 Close 值）写入 history_minutes。
 */
export function aggregateTicksToMinute(minuteTime: string) {
  const minuteAligned = alignToMinute(minuteTime);
  const nextMinute = new Date(new Date(minuteAligned).getTime() + 60_000).toISOString();

  const symbols = ["XAU_USD", "AU9999", "USD_CNH"] as const;
  db.exec("BEGIN");
  try {
    for (const symbol of symbols) {
      const row = db
        .prepare(
          `SELECT price FROM ticks WHERE symbol = ? AND time >= ? AND time < ? ORDER BY time DESC LIMIT 1`
        )
        .get(symbol, minuteAligned, nextMinute) as { price: number } | undefined;
      if (row) {
        upsertHistoryMinute.run({ time: minuteAligned, symbol, price: row.price });
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 动态 K 线聚合：从 history_minutes 中按 intervalSeconds 秒的时间槽聚合价格。
 * 返回 { time, price } 数组，time 为每个时间槽的起始 ISO 时间字符串。
 */
export function getAggregatedCandles(
  symbol: string,
  afterTime: string,
  intervalSeconds: number,
  timezoneOffsetMinutes = 0
): Array<{ time: string; price: number }> {
  const offsetSeconds = timezoneOffsetMinutes * 60;
  // SQLite 没有 DATE_TRUNC，用整数运算来做时间槽对齐
  // strftime('%s', time) 返回 Unix 秒数；先换算到用户本地时间轴分桶，再换回 UTC 槽起始。
  const rows = db
    .prepare(
      `
      SELECT
        datetime(
          ((CAST(strftime('%s', time) AS INTEGER) - @offsetSeconds) / @interval) * @interval + @offsetSeconds,
          'unixepoch'
        ) AS slot,
        AVG(price) AS price
      FROM history_minutes
      WHERE symbol = @symbol AND time >= @afterTime
      GROUP BY slot
      ORDER BY slot ASC
    `
    )
    .all({ symbol, afterTime, interval: intervalSeconds, offsetSeconds }) as Array<{ slot: string; price: number }>;

  return rows.map((r) => ({ time: new Date(r.slot + "Z").toISOString(), price: r.price }));
}

/**
 * 用户补录历史价格：直接对齐到分钟后写入 history_minutes。
 */
export function supplementHistoryPrice(symbol: string, timeISO: string, price: number) {
  const aligned = alignToMinute(timeISO);
  upsertHistoryMinute.run({ time: aligned, symbol, price });
}

export function clearHistoryMinutesForSymbol(symbol: string) {
  db.prepare(`DELETE FROM history_minutes WHERE symbol = ?`).run(symbol);
}

export function clearAllHistoryMinutes() {
  db.exec(`DELETE FROM history_minutes`);
}

export function getHistoryMinutesCount(symbol: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM history_minutes WHERE symbol = ?`)
    .get(symbol) as { cnt: number };
  return row.cnt;
}

export function getHistoryMinutesRange(symbol: string): { earliest: string | null; latest: string | null } {
  const row = db
    .prepare(`SELECT MIN(time) as earliest, MAX(time) as latest FROM history_minutes WHERE symbol = ?`)
    .get(symbol) as { earliest: string | null; latest: string | null };
  return row;
}

/**
 * 综合计算某个 symbol 的历史跨度天数。
 * 优先用 history_minutes 的最早记录，若为空则用 ticks 的最早记录，
 * 与当前时间做差（而不是与 MAX(time) 做差，避免 ticks 只有几秒数据算 0 天）。
 */
export function getHistoryDays(symbol: string): number {
  // 先看 history_minutes
  const hmRow = db
    .prepare(`SELECT MIN(time) as earliest FROM history_minutes WHERE symbol = ?`)
    .get(symbol) as { earliest: string | null };
  const earliest = hmRow.earliest;
  if (!earliest) return 0;
  const ms = Date.now() - new Date(earliest).getTime();
  return Math.ceil(ms / 86_400_000);
}

// ─── Dataset Stats ────────────────────────────────────────────────────────

export interface DatasetStat {
  id: string;
  name: string;
  activeProvider: string;
  providers: Array<{ name: string; configured: boolean }>;
  dataCount: number;
  earliestData: string | null;
  latestData: string | null;
  historyDays: number;
}

export function getDatasetStats(): DatasetStat[] {
  const priceSymbols = [
    { id: "XAU_USD", name: "XAU/USD（国际金价）", activeProvider: "OANDA", providers: [{ name: "OANDA", configured: Boolean(config.oandaToken) }] },
    { id: "AU9999", name: "AU9999（国内金价）", activeProvider: "AKTools/SGE", providers: [{ name: "AKTools/SGE", configured: Boolean(config.aktoolsBaseUrl) }] },
    { id: "USD_CNH", name: "USD/CNH（离岸人民币）", activeProvider: "OANDA", providers: [{ name: "OANDA", configured: Boolean(config.oandaToken) }] }
  ];

  const stats: DatasetStat[] = priceSymbols.map((sym) => {
    const count = getHistoryMinutesCount(sym.id);
    const range = getHistoryMinutesRange(sym.id);
    const historyDays =
      range.earliest && range.latest
        ? Math.round((new Date(range.latest).getTime() - new Date(range.earliest).getTime()) / 86_400_000)
        : 0;
    return {
      id: sym.id,
      name: sym.name,
      activeProvider: sym.activeProvider,
      providers: sym.providers,
      dataCount: count,
      earliestData: range.earliest,
      latestData: range.latest,
      historyDays
    };
  });

  // NEWS 数据集
  const eventsCount = (db.prepare(`SELECT COUNT(*) as cnt FROM events`).get() as { cnt: number }).cnt;
  const eventsRange = db
    .prepare(`SELECT MIN(published_at) as earliest, MAX(published_at) as latest FROM events`)
    .get() as { earliest: string | null; latest: string | null };
  const newsHistoryDays =
    eventsRange.earliest && eventsRange.latest
      ? Math.round(
          (new Date(eventsRange.latest).getTime() - new Date(eventsRange.earliest).getTime()) / 86_400_000
        )
      : 0;
  stats.push({
    id: "NEWS",
    name: "舆情新闻事件",
    activeProvider: "NewsNow",
    providers: [{ name: "NewsNow", configured: true }],
    dataCount: eventsCount,
    earliestData: eventsRange.earliest,
    latestData: eventsRange.latest,
    historyDays: newsHistoryDays
  });

  return stats;
}

// ─── Init Status ──────────────────────────────────────────────────────────

export function getInitStatus(): {
  initialized: boolean;
  historyDays: number;
  historyMinutesCount: number;
  quotesCount: number;
  eventsCount: number;
  oandaConfigured: boolean;
  au9999Configured: boolean;
  dbSizeBytes: number;
} {
  // 以 XAU_USD 为基准计算历史跨度（天数从最早记录到现在）
  const historyDays = getHistoryDays("XAU_USD");

  // history_minutes 中 XAU_USD 的记录数
  const historyMinutesCount = getHistoryMinutesCount("XAU_USD");

  // quotes 表有数据即认为系统已成功抓到过行情
  const quotesCount = (db.prepare(`SELECT COUNT(*) as cnt FROM quotes`).get() as { cnt: number }).cnt;
  const eventsCount = (db.prepare(`SELECT COUNT(*) as cnt FROM events`).get() as { cnt: number }).cnt;

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(config.databasePath).size;
  } catch {
    // ignore
  }

  const hasEnoughHistory = historyDays >= 7 && historyMinutesCount >= 7 * 24 * 60 * 0.4;
  const initialized = hasEnoughHistory;

  return {
    initialized,
    historyDays,
    historyMinutesCount,
    quotesCount,
    eventsCount,
    oandaConfigured: Boolean(config.oandaToken),
    au9999Configured: Boolean(config.aktoolsBaseUrl),
    dbSizeBytes
  };
}

// ─── Export / Import ──────────────────────────────────────────────────────

export function exportAllData(): {
  quotes: Quote[];
  events: NewsEvent[];
  historyMinutes: Array<{ time: string; symbol: string; price: number }>;
} {
  const quotes = getAllQuotesFromDb();
  const events = getAllEventsFromDb();
  const historyMinutes = db
    .prepare(`SELECT time, symbol, price FROM history_minutes ORDER BY time ASC`)
    .all() as Array<{ time: string; symbol: string; price: number }>;
  return { quotes, events, historyMinutes };
}

export function importAllData(data: {
  quotes?: Quote[];
  events?: NewsEvent[];
  historyMinutes?: Array<{ time: string; symbol: string; price: number }>;
}) {
  if (data.quotes?.length) saveQuotes(data.quotes);
  if (data.events?.length) saveEvents(data.events);
  if (data.historyMinutes?.length) bulkSaveHistoryMinutes(data.historyMinutes);
}

// ─── Utils ────────────────────────────────────────────────────────────────

function alignToMinute(isoTime: string): string {
  const d = new Date(isoTime);
  d.setSeconds(0, 0);
  return d.toISOString();
}

// ─── Coverage Queries ─────────────────────────────────────────────────────

export interface DayCoverage {
  day: string;         // "YYYY-MM-DD"
  minuteCount: number; // 实际有多少分钟记录
  coveragePct: number; // 0–100，相对于完整1天(1440分钟)
}

export interface MonthCoverage {
  month: string;           // "YYYY-MM"
  minuteCount: number;     // 该月总分钟数
  coveragePct: number;     // 0–100，相对于标准月(30天×1440)
}

/**
 * 按天统计指定月份某 symbol 的行情覆盖情况。
 */
export function getDailyCoverage(symbol: string, year: number, month: number): DayCoverage[] {
  const y = String(year);
  const m = String(month).padStart(2, "0");
  const startDate = `${y}-${m}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', time) AS day, COUNT(*) AS cnt
       FROM history_minutes
       WHERE symbol = ? AND time >= ? AND time < ?
       GROUP BY day
       ORDER BY day`
    )
    .all(symbol, startDate, endDate) as { day: string; cnt: number }[];

  return rows.map((r) => ({
    day: r.day,
    minuteCount: r.cnt,
    coveragePct: Math.min(100, Math.round((r.cnt / 1440) * 100))
  }));
}

/**
 * 按月统计指定年份某 symbol 的行情覆盖情况。
 */
export function getMonthlyCoverage(symbol: string, year: number): MonthCoverage[] {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', time) AS month, COUNT(*) AS cnt
       FROM history_minutes
       WHERE symbol = ? AND time >= ? AND time < ?
       GROUP BY month
       ORDER BY month`
    )
    .all(symbol, startDate, endDate) as { month: string; cnt: number }[];

  return rows.map((r) => ({
    month: r.month,
    minuteCount: r.cnt,
    // 以 30 天标准月计算粗略覆盖率
    coveragePct: Math.min(100, Math.round((r.cnt / (30 * 1440)) * 100))
  }));
}

