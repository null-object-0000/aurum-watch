import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import type { NewsEvent, Quote } from "./types.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL");

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
`);

const upsertQuote = db.prepare(`
  INSERT INTO quotes(symbol, payload, updated_at)
  VALUES (@symbol, @payload, @updatedAt)
  ON CONFLICT(symbol) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
`);

const getQuoteQuery = db.prepare(`
  SELECT payload FROM quotes WHERE symbol = ?
`);

export function getQuote(symbol: string): Quote | null {
  try {
    const row = getQuoteQuery.get(symbol) as { payload: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload) as Quote;
  } catch {
    return null;
  }
}

const upsertEvent = db.prepare(`
  INSERT INTO events(id, payload, published_at)
  VALUES (@id, @payload, @publishedAt)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, published_at = excluded.published_at
`);

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
