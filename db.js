// db.js - PostgreSQL persistence for Odds Junction, via CloudNativePG
//
// Migrated from SQLite. Every exported function below keeps the exact same
// name, parameters, and return shape as the old SQLite version - server.js
// and cronFetch.js call these without any changes on their end.
//
// Columns intentionally stay TEXT for match/sport/timestamp/match_start_time
// (not TIMESTAMPTZ) to match SQLite's original string-based behavior exactly.
// Downstream code (processMatches in server.js) does new Date(record.timestamp)
// string parsing - changing these to native Postgres timestamp types would
// make `pg` return JS Date objects instead of strings, a behavior change
// that code wasn't written to expect. Keeping TEXT avoids that risk.
const { Pool } = require('pg');

// CNPG's auto-generated '<cluster-name>-app' secret provides a ready-to-use
// 'uri' field, wired into DATABASE_URL via k8s/deployment.yaml and
// k8s/cronjob.yaml's envFrom. Falls back to discrete PG* vars for local dev
// without a full CNPG cluster (e.g. a local Postgres container).
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
  // Idle client errors (e.g. CNPG failover, network blip) shouldn't crash
  // the whole process - log and let the pool recover the connection.
  console.error('❌ Unexpected Postgres pool error:', err.message);
});

async function runAsync(sql, params = []) {
  return pool.query(sql, params);
}

async function allAsync(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS odds_history (
      id SERIAL PRIMARY KEY,
      match TEXT,
      bookmaker TEXT,
      home REAL,
      away REAL,
      draw REAL,
      match_start_time TEXT,
      sport TEXT,
      timestamp TEXT,
      inserted_at TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_odds_timestamp ON odds_history(timestamp)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_odds_sport ON odds_history(sport)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_odds_match ON odds_history(match)`);
}

// Both server.js (long-running) and cronFetch.js (short-lived, runs once
// and exits) require() this module, so schema setup runs on require in
// both cases - same behavior as the old SQLite version's db.serialize()
// block running synchronously at module load.
const schemaReady = ensureSchema().catch((err) => {
  console.error('❌ Failed to initialize Postgres schema:', err.message);
  process.exit(1);
});

module.exports = {
  insertOdds: async (record) => {
    await schemaReady;
    const sql = `
      INSERT INTO odds_history
      (match, bookmaker, home, away, draw, match_start_time, sport, timestamp, inserted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    const params = [
      record.match,
      record.bookmaker,
      record.home,
      record.away,
      record.draw,
      record.match_start_time,
      record.sport || 'unknown',
      record.timestamp,
      new Date().toISOString()
    ];
    await runAsync(sql, params);
  },

  clearOddsHistory: async () => {
    await schemaReady;
    await runAsync(`DELETE FROM odds_history`);
  },

  clearSportData: async (sport) => {
    await schemaReady;
    await runAsync(`DELETE FROM odds_history WHERE sport = $1`, [sport]);
  },

  getOddsHistory: async (match, bookmaker) => {
    await schemaReady;
    const sql = `
      SELECT * FROM odds_history
      WHERE match = $1 AND bookmaker = $2
      ORDER BY timestamp::timestamptz DESC
      LIMIT 10
    `;
    return allAsync(sql, [match, bookmaker]);
  },

  scanAll: async (maxAgeHours = 24) => {
    await schemaReady;
    const hours = parseInt(maxAgeHours, 10);
    const sql = `
      SELECT * FROM odds_history
      WHERE timestamp::timestamptz > (now() - ($1 || ' hours')::interval)
    `;
    const rows = await allAsync(sql, [hours]);

    const bookmakerCounts = {};
    const matchCounts = {};

    rows.forEach((item) => {
      bookmakerCounts[item.bookmaker] = (bookmakerCounts[item.bookmaker] || 0) + 1;
      matchCounts[item.match] = (matchCounts[item.match] || 0) + 1;
    });

    console.log(`📊 Found ${rows.length} total records`);
    console.log(`📈 Unique matches: ${Object.keys(matchCounts).length}`);
    console.log(`🏢 Bookmakers found:`, Object.keys(bookmakerCounts));
    console.log(`📋 Records per bookmaker:`, bookmakerCounts);

    return rows;
  },

  queryByMatch: async (matchExact, maxAgeHours = 168) => {
    await schemaReady;
    const hours = parseInt(maxAgeHours, 10);
    return allAsync(
      `
      SELECT * FROM odds_history
      WHERE match = $1 AND timestamp::timestamptz > (now() - ($2 || ' hours')::interval)
      `,
      [matchExact, hours]
    );
  },

  cleanupOldMatches: async () => {
    await schemaReady;
    try {
      await runAsync(`
        DELETE FROM odds_history
        WHERE timestamp::timestamptz < (now() - interval '24 hours')
           OR (
             match_start_time IS NOT NULL
             AND match_start_time::timestamptz < (now() - interval '6 hours')
           )
      `);
      console.log('🧹 Postgres cleanup completed');
    } catch (err) {
      console.error('❌ Cleanup error:', err.message);
      throw err;
    }
  }
};
