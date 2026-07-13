// racingFetch.js - CronJob: poll oddspro /api/meetings (FULL market) -> CNPG.
//
// Runs once and exits, like cronFetch.js. Scheduled every 5 min (oddspro
// refreshes via BetWatch every 5 min). No auth - single public URL.
//
// Endpoint choice (final): /api/meetings  (NOT /api/external/*).
//   - /api/external/meetings -> flat, names only, no odds.
//   - /top-favs & /movers    -> only top-5 bookies per runner, dominated by
//                               niche books you don't carry.
//   - /api/meetings          -> full tree: meetings->races->runners->
//                               bookmakerMarkets[] with ALL ~40 bookies and
//                               fixedWin.price each. Confirmed 21/21 of yours
//                               present. One call gets everything, no fan-out.
//
// We filter each runner's bookmakerMarkets[] to your 21 AU bookies, then the
// board highlights best price among them at read time. Resilience:
//   - 1 call total (/api/meetings returns all codes; we filter by type client-side
//     OR call per code via ?type=). UPSERT every row - a bad/empty poll can't
//     blank the board. try/catch per meeting/race/runner.

require('dotenv').config();
const axios = require('axios');
const dbr = require('./db-racing');
const { filterBookmakerMarkets } = require('./racingBookies');

const BASE_URL = process.env.ODDSPRO_BASE_URL || 'https://oddspro.com.au';
const CODES = ['T', 'H', 'G'];
// Australian state codes = domestic. Anything else (JPN, GBR, USA...) is dropped.
const AU_LOCATIONS = new Set(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT']);

function isValidPrice(p) {
  return typeof p === 'number' && !Number.isNaN(p) && p >= 1.01 && p <= 1000;
}
function pick(obj, ...keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

// oddspro /api/meetings returns startTime as "YYYY-MM-DD HH:MM:SS" (space, no TZ).
// new Date() parses that as LOCAL time, which breaks the read-side time window on
// any pod not set to UTC. Normalize to explicit UTC ISO ("...T...Z") at ingest so
// start_time is stored unambiguously, matching how the sports pipeline stores ISO.
function toUtcIso(s) {
  if (!s) return s;
  if (typeof s !== 'string') return s;
  // already ISO with T? trust it.
  if (s.includes('T')) return s;
  // "2026-07-09 06:00:00" -> "2026-07-09T06:00:00Z" (oddspro times are UTC)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}Z`;
  return s;
}

// One call returns the full tree for all codes. We fetch once and bucket by code.
async function fetchAllMeetings() {
  try {
    const res = await axios.get(`${BASE_URL}/api/meetings`, { timeout: 30000 });
    const data = Array.isArray(res.data) ? res.data : pick(res.data, 'data');
    if (!Array.isArray(data)) {
      console.warn('⚠️  Unexpected /api/meetings shape');
      return [];
    }
    return data;
  } catch (err) {
    console.error('❌ Failed /api/meetings:', err.message);
    return [];
  }
}

async function runAll() {
  const fetchedAt = new Date().toISOString();
  console.log(`🏇 Starting oddspro racing (/api/meetings) fetch at ${fetchedAt}`);

  const meetings = await fetchAllMeetings();
  if (!meetings.length) {
    console.log('⚠️  No meetings returned (leaving existing data intact)');
    return;
  }

  const counts = { T: 0, H: 0, G: 0 };
  let cRunners = 0, cOdds = 0, skippedIntl = 0;

  for (const m of meetings) {
    try {
      const code = pick(m, 'type', 'racingCode');
      if (!CODES.includes(code)) continue;              // only T/H/G
      const location = pick(m, 'location');
      if (!AU_LOCATIONS.has(location)) { skippedIntl++; continue; } // AU domestic only

      const track = pick(m, 'track', 'meetingName');
      const races = pick(m, 'races') || [];

      for (const race of races) {
        const raceNumber = pick(race, 'number', 'raceNumber');
        const raceName = pick(race, 'name', 'raceName');
        const startTime = toUtcIso(pick(race, 'startTime', 'raceStartTime'));
        const raceKey = `${code}|${track}|${raceNumber}`;
        const runners = pick(race, 'runners') || [];

        for (const rn of runners) {
          try {
            // skip scratched runners
            if (pick(rn, 'status') === 'SCRATCHED' || pick(rn, 'scratchedTime')) continue;

            const runnerId = String(pick(rn, 'id', 'runnerId'));
            if (!runnerId || runnerId === 'undefined') continue;

            const markets = filterBookmakerMarkets(pick(rn, 'bookmakerMarkets'));
            if (!markets.length) continue; // no AU-supported bookie -> skip runner

            const base = {
              runner_id: runnerId,
              race_key: raceKey,
              racing_code: code,
              track,
              race_number: raceNumber,
              race_name: raceName,
              runner_number: pick(rn, 'number', 'runnerNumber'),
              runner_name: pick(rn, 'name', 'runnerName'),
              start_time: startTime,
              location,
              fetched_at: fetchedAt
            };

            let wrote = false;
            for (const o of markets) {
              if (!isValidPrice(o.price)) continue;
              await dbr.upsertBoardOdds({
                ...base,
                bookmaker: o.bookmaker,
                price: o.price,
                display_name: o.display_name
              });
              cOdds++; wrote = true;
            }
            if (wrote) { cRunners++; counts[code]++; }
          } catch (err) {
            console.error(`❌ Runner ingest error:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error(`❌ Meeting ingest error:`, err.message);
    }
  }

  console.log(`💾 AU runners w/ your bookies: ${cRunners} (T:${counts.T} H:${counts.H} G:${counts.G}), ${cOdds} odds rows`);
  console.log(`   (skipped ${skippedIntl} international meetings)`);

  // Append this cycle's average-price-per-runner to the history table.
  // Must run AFTER all upserts (so the board is current) and BEFORE cleanup
  // (so runners about to be pruned still get their final data point).
  try { await dbr.snapshotRacingHistory(); }
  catch (err) { console.warn('⚠️  Racing history snapshot failed:', err.message); }

  try { await dbr.cleanupOldRacing(); }
  catch (err) { console.warn('⚠️  Racing cleanup failed:', err.message); }

  try { await dbr.cleanupRacingHistory(); }
  catch (err) { console.warn('⚠️  Racing history cleanup failed:', err.message); }

  console.log(`\n✅ Racing fetch completed: ${cOdds} odds rows at ${new Date().toISOString()}`);
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error('❌ Fatal error in racingFetch:', err.message);
    process.exit(1);
  });
}

module.exports = { runAll };