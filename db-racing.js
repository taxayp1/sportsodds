// db-racing.js - PostgreSQL persistence for the Racing best-odds board.
//
// Separate module from db.js on purpose - the working sports/exchange pipeline
// isn't touched. Reuses the same CNPG connection pattern (DATABASE_URL from
// CNPG's '<cluster>-app' secret, discrete PG* fallback for local dev).
//
// Design (finalized): the Racing tab is a best-odds BOARD, not full race cards.
// Source is oddspro's /movers per code (T/H/G), which returns runners with a
// topOdds[] that actually contains the AU bookies you already support. So the
// model is FLAT: one row per (runner + bookmaker). No meetings/races/runners
// fan-out tables - those endpoints don't carry your bookies and aren't needed.
//
// Carried-over principles (db.js conventions + CNPG force-replace incident):
//   - TEXT for time columns (ISO strings), same as db.js.
//   - UPSERT on (runner_id, bookmaker) - never DELETE-then-INSERT, so a bad or
//     empty poll can't blank the board. Stale-but-present, never empty.
//   - fetched_at on every row -> "odds as of HH:MM" note + staleness alerting.
//   - best odds is computed at READ time via MAX(price) over YOUR bookies only,
//     never trusting oddspro's bestOdds (which points at books you don't carry).

const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || 'oddsjunction_app',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'oddsjunction'
    });

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres pool error (racing):', err.message);
});

async function runAsync(sql, params = []) { return pool.query(sql, params); }
async function allAsync(sql, params = []) { return (await pool.query(sql, params)).rows; }

async function ensureSchema() {
  // One flat table. race_key groups a runner's rows into a race on the board.
  // race_key = meetingType|track|raceNumber (stable within a day).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS racing_board (
      runner_id     TEXT NOT NULL,
      bookmaker     TEXT NOT NULL,          -- your canonical logo key
      price         REAL,                   -- decimal odds
      display_name  TEXT,
      -- race context (denormalized onto every row - it's a flat board)
      race_key      TEXT NOT NULL,          -- meetingType|track|raceNumber
      racing_code   TEXT,                   -- T | H | G
      track         TEXT,
      race_number   INTEGER,
      race_name     TEXT,
      runner_number INTEGER,
      runner_name   TEXT,
      start_time    TEXT,                   -- ISO 8601
      location      TEXT,                   -- NSW/VIC/... (from provider)
      fetched_at    TEXT NOT NULL,
      PRIMARY KEY (runner_id, bookmaker)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rboard_race  ON racing_board(race_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rboard_code  ON racing_board(racing_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rboard_start ON racing_board(start_time)`);
}

// Schema init runs on require. IMPORTANT: unlike db.js, a failure here must NOT
// process.exit() - db-racing is required by the long-running web server, and a
// racing hiccup should never take down the working sports/exchange tabs. The
// short-lived fetch job (racingFetch.js) checks schemaReady and will surface
// errors on its own writes instead. We swallow the error here and let individual
// queries fail gracefully (routes already try/catch -> 500 for racing only).
const schemaReady = ensureSchema().catch((err) => {
  console.error('❌ Failed to initialize racing schema (racing disabled, rest of app unaffected):', err.message);
  // do NOT exit - keep the web server alive for sports/exchange.
});

// --- WRITE (racingFetch.js) -------------------------------------------------
// One UPSERT per runner+bookmaker price.
async function upsertBoardOdds(row) {
  await schemaReady;
  await runAsync(
    `INSERT INTO racing_board
       (runner_id, bookmaker, price, display_name, race_key, racing_code,
        track, race_number, race_name, runner_number, runner_name,
        start_time, location, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (runner_id, bookmaker) DO UPDATE SET
       price         = EXCLUDED.price,
       display_name  = EXCLUDED.display_name,
       race_key      = EXCLUDED.race_key,
       racing_code   = EXCLUDED.racing_code,
       track         = EXCLUDED.track,
       race_number   = EXCLUDED.race_number,
       race_name     = EXCLUDED.race_name,
       runner_number = EXCLUDED.runner_number,
       runner_name   = EXCLUDED.runner_name,
       start_time    = EXCLUDED.start_time,
       location      = EXCLUDED.location,
       fetched_at    = EXCLUDED.fetched_at`,
    [row.runner_id, row.bookmaker, row.price, row.display_name, row.race_key,
     row.racing_code, row.track, row.race_number, row.race_name,
     row.runner_number, row.runner_name, row.start_time, row.location, row.fetched_at]
  );
}

// --- READ (server.js /odds-db/racing) ---------------------------------------
// Returns races grouped, each with runners, each runner with its bookies'
// prices and an is_best flag (best among YOUR bookies). Upcoming/live only.
async function getBoard(racingCode = null, maxAgeHours = 6) {
  await schemaReady;
  const params = [parseInt(maxAgeHours, 10)];
  let codeClause = '';
  if (racingCode) { params.push(racingCode); codeClause = `AND racing_code = $${params.length}`; }

  const rows = await allAsync(
    `SELECT * FROM racing_board
     WHERE fetched_at::timestamptz > (now() - ($1 || ' hours')::interval)
     ${codeClause}`,
    params
  );
  if (!rows.length) return [];

  // group -> race -> runner -> [bookie prices]
  const races = {};
  for (const r of rows) {
    const race = (races[r.race_key] ||= {
      race_key: r.race_key, racing_code: r.racing_code, track: r.track,
      race_number: r.race_number, race_name: r.race_name,
      start_time: r.start_time, location: r.location, runners: {}
    });
    const runner = (race.runners[r.runner_id] ||= {
      runner_id: r.runner_id, runner_number: r.runner_number,
      runner_name: r.runner_name, odds: []
    });
    if (r.price != null) runner.odds.push({ bookmaker: r.bookmaker, price: r.price, display_name: r.display_name });
  }

  // finalize: sort, compute best-among-your-bookies, drop empty runners
  const now = Date.now();
  return Object.values(races).map((race) => {
    const runners = Object.values(race.runners).map((rn) => {
      const best = rn.odds.reduce((mx, o) => (o.price > mx ? o.price : mx), 0);
      rn.odds.forEach((o) => { o.is_best = (o.price === best && best > 0); });
      rn.best_odds = best || null;
      rn.odds.sort((a, b) => b.price - a.price);
      return rn;
    }).filter((rn) => rn.odds.length > 0)
      .sort((a, b) => (b.best_odds || 0) - (a.best_odds || 0)); // favorites-ish first
    return { ...race, runners };
  })
  .filter((race) => race.runners.length > 0)
  .filter((race) => {
    // show races from 30 min ago up to 12h ahead. start_time is stored as UTC
    // ISO (normalized at ingest), so Date parsing is timezone-safe here.
    const t = new Date(race.start_time).getTime();
    if (!isFinite(t)) return true; // if unparseable, don't hide it
    return t > now - 30 * 60 * 1000 && t < now + 12 * 60 * 60 * 1000;
  })
  .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

async function getLastFetchedAt() {
  await schemaReady;
  const rows = await allAsync(`SELECT MAX(fetched_at) AS last FROM racing_board`);
  return rows[0]?.last || null;
}

async function cleanupOldRacing() {
  await schemaReady;
  try {
    await runAsync(
      `DELETE FROM racing_board
       WHERE start_time IS NOT NULL
         AND start_time::timestamptz < (now() - interval '3 hours')`
    );
    console.log('🧹 Racing board cleanup completed');
  } catch (err) {
    console.error('❌ Racing cleanup error:', err.message);
    throw err;
  }
}

module.exports = { upsertBoardOdds, getBoard, getLastFetchedAt, cleanupOldRacing };