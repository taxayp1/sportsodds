require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
// NOTE: scheduler.js / node-cron intentionally removed.
// Odds fetching now runs as a separate k8s CronJob (see k8s/cronjob.yaml),
// decoupled from this web server's lifecycle. This pod only serves data.

// ----- Betfair Exchange support (new) -----
const BetfairExchange = require('./betfairExchange');
const betfair = new BetfairExchange();

// ----- Racing board support (oddspro.com.au /movers) -----
const dbRacing = require('./db-racing');

const sportKeyMap = {
  afl:     ['61420', 'aussierules_afl'],
  nrl:     ['1477',  'rugbyleague_nrl'],
  cricket: ['4',     'cricket'],
  tennis:  ['2',     'us_open_mens_singles'],
};

async function fetchExchangeFor(sportParam) {
  const key = (sportParam || 'all').toLowerCase();
  const bucket = exchangeCache[key] || exchangeCache.all;
  const now = Date.now();

  if (bucket.data.length && (now - bucket.ts < 110 * 1000)) {
    return bucket.data;
  }

  let data = [];
  if (sportParam && sportKeyMap[key]) {
    const [id, name] = sportKeyMap[key];
    if (betfair.getExchangeOddsForSport) {
      data = await betfair.getExchangeOddsForSport(id, name);
    } else {
      data = await betfair.getAllExchangeOdds();
      data = data.filter(m => (m.sport||'').toLowerCase().includes(name.replace('_','')));
    }
  } else {
    data = await betfair.getAllExchangeOdds();
  }

  bucket.data = Array.isArray(data) ? data : [];
  bucket.ts = now;
  return bucket.data;
}

// ~110s cache so the tab refreshes ~every 2 min without hammering API
const exchangeCache = {
  all: { ts: 0, data: [] },
  afl: { ts: 0, data: [] },
  nrl: { ts: 0, data: [] },
  cricket: { ts: 0, data: [] },
  tennis: { ts: 0, data: [] }
};
function filterExchangeBySport(arr, sport) {
  if (!sport) return arr;
  const s = sport.toLowerCase();
  return arr.filter(m => {
    const ms = (m.sport || '').toLowerCase();
    return ms.includes(s) ||
      (s === 'afl' && ms.includes('aussierules')) ||
      (s === 'nrl' && ms.includes('rugbyleague'));
  });
}

const app = express();
app.use(cors());
app.use(express.static('public'));

// ADD NO-CACHE HEADERS FOR ALL API ROUTES
app.use('/odds-db', (req, res, next) => {
  // Prevent all caching
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Last-Modified': new Date().toUTCString()
  });
  next();
});

function normalizeBookmakerKey(key) {
  // unify common AU variants and naming differences
  if (key === 'betfair_ex') return 'betfair_ex_au';
  if (key === 'betr') return 'betr_au';
  if (key === 'ladbrokes') return 'ladbrokes_au';
  if (key === 'pointsbet') return 'pointsbetau';
  if (key === 'dabble') return 'dabble_au';
  if (key === 'bet365com') return 'bet365';
  // already AU keys pass through
  return key;
}

// IMPROVED: Add timestamp logging and force fresh data
function buildBookmakersArray(allRecords, home_team, away_team) {
  const now = new Date().toISOString();
  console.log(`ðŸ“– [${now}] Building bookmakers for: "${home_team}" vs "${away_team}"`);
  console.log(`ðŸ“Š Processing ${allRecords.length} total records`);

  if (!allRecords.length) {
    console.log(`âŒ No records found for this match`);
    return [];
  }

  const bookmakerMap = new Map();

  // Always keep the most recent record for each bookmaker in the DB window
  allRecords.forEach(record => {
    const bookie = normalizeBookmakerKey(record.bookmaker);
    const h = parseFloat(record.home);
    const a = parseFloat(record.away);
    if (isNaN(h) || isNaN(a)) return;

    if (!bookmakerMap.has(bookie)) {
      bookmakerMap.set(bookie, record);
    } else {
      const existing = bookmakerMap.get(bookie);
      if (new Date(record.timestamp) > new Date(existing.timestamp)) {
        bookmakerMap.set(bookie, record);
      }
    }
  });

  console.log(`ðŸ¢ Found ${bookmakerMap.size} unique bookmakers: ${Array.from(bookmakerMap.keys()).join(', ')}`);

  const result = [];

  bookmakerMap.forEach((record, bookie) => {
    const h = parseFloat(record.home);
    const a = parseFloat(record.away);
    const d = record.draw != null ? parseFloat(record.draw) : null;

    if (!isNaN(h) && !isNaN(a) && h >= 1.01 && a >= 1.01 && h <= 1000 && a <= 1000) {
      result.push({
        key: record.bookmaker,
        title: record.bookmaker
          .replace(/_au$/, '')
          .replace(/_/g, ' ')
          .replace('betfair_ex_au', 'betfair')
          .replace('betfair_ex', 'betfair'),
        last_update: record.timestamp,
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: home_team.trim(), price: h },
            { name: away_team.trim(), price: a },
            ...(d != null && !isNaN(d) && d >= 1.01 && d <= 10000
              ? [{ name: 'Draw', price: d }]
              : [])
          ]
        }]
      });
      console.log(`âœ… ${bookie}: FINAL RESULT - ${h} vs ${a} (${record.timestamp})`);
    } else {
      console.log(`âŒ ${bookie}: REJECTED - invalid odds ${h}/${a}`);
    }
  });

  console.log(`âœ… Final result: ${result.length} bookmakers accepted`);
  return result.sort((a, b) => a.title.localeCompare(b.title));
}

// IMPROVED: Add better filtering and logging
function processMatches(allRows, sportFilter = null) {
  const startTime = Date.now();
  console.log(`ðŸš€ Processing matches... (${allRows.length} total records)`);
  
  // Filter by sport if specified
  let filteredRows = allRows;
if (sportFilter) {
  filteredRows = allRows.filter(r => {
    const s = (r.sport || '').toLowerCase();
    // Handle both variations
    return s.includes(sportFilter.toLowerCase()) || 
           (sportFilter === 'rugby_league_nrl' && s.includes('nrl')) ||
           (sportFilter === 'nrl' && s.includes('rugby_league_nrl')) ||
           // the-odds-api's real sport_key for UFC/MMA is 'mma_mixed_martial_arts' -
           // it contains no 'ufc' substring, so the frontend's ?sport=ufc param
           // needs an explicit mapping here rather than relying on .includes()
           (sportFilter === 'ufc' && s.includes('mma')) ||
           (sportFilter === 'us_open_mens_singles' && s.includes('us_open_mens_singles'));
  });
}

  if (!filteredRows.length) {
    console.log('âŒ No records found after filtering');
    return [];
  }

  // Group by match
  const matchGroups = {};
  filteredRows.forEach(r => {
    const k = r.match;
    (matchGroups[k] ||= []).push(r);
  });

  console.log(`ðŸ† Found ${Object.keys(matchGroups).length} unique matches`);

  const result = Object.entries(matchGroups).map(([match, recs]) => {
    // Fix team name errors
    let correctedMatch = match
      .replace('Australia vs Norway', 'Austria vs Norway')
      .replace('Norway vs Australia', 'Norway vs Austria');
    
    let home_team, away_team;
    if (correctedMatch.includes(' vs ')) {
      [home_team, away_team] = correctedMatch.split(' vs ');
    } else if (correctedMatch.includes(' v ')) {
      [home_team, away_team] = correctedMatch.split(' v ');
    } else {
      const parts = correctedMatch.split(/[\s@-]+/);
      home_team = parts.slice(0, -1).join(' ') || 'Home';
      away_team = parts[parts.length - 1] || 'Away';
    }

    const latest = recs.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))[0];
    const bookmakers = buildBookmakersArray(recs, home_team, away_team);

    return {
      home_team: home_team.trim(),
      away_team: away_team.trim(),
      bookmakers,
      commence_time: latest.match_start_time || latest.timestamp,
      last_updated: latest.timestamp,
      sport: latest.sport || 'unknown'
    };
  }).filter(m => m.bookmakers.length > 0)
    .filter(m => { // live (<=4h since start) or upcoming (<=7d)
      const now = Date.now();
      const start = new Date(m.commence_time).getTime();
      const maxFutureDays = sportFilter === 'ufc' ? 120 : 
      sportFilter === 'aussierules_afl' ? 60 : 
      sportFilter === 'tennis' ? 14 : 7; 
const maxFutureMs = maxFutureDays * 24 * 60 * 60 * 1000;
return isFinite(start) && ((start <= now && start + 4*60*60*1000 >= now) || (start > now && start <= now + maxFutureMs));
    })
    .sort((a,b) => {
      const now = Date.now();
      const sa = new Date(a.commence_time).getTime();
      const sb = new Date(b.commence_time).getTime();
      const aLive = sa <= now && sa >= now - 4*60*60*1000;
      const bLive = sb <= now && sb >= now - 4*60*60*1000;
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      return sa - sb;
    });

  const endTime = Date.now();
  console.log(`âœ… Processing complete: ${result.length} active matches (${endTime - startTime}ms)`);
  return result;
}

// ---------- ALL MATCHES ----------
app.get('/odds-db/all', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\\nðŸ“¡ [${requestTime}] NEW REQUEST: /odds-db/all`);
    
    const rows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${rows?.length || 0} records from database`);
    
    if (!rows?.length) {
      console.log('âŒ No records found in database');
      return res.json([]);
    }

    // Log some timestamps to verify freshness
    const timestamps = rows.map(r => r.timestamp).sort().reverse();
    console.log(`ðŸ• Database timestamps - Latest: ${timestamps[0]}, Count: ${timestamps.length}`);
    console.log(`ðŸ• Last 3 timestamps: ${timestamps.slice(0, 3).join(', ')}`);

    const result = processMatches(rows);
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} matches to frontend`);
    res.json(result);
  } catch (err) {
    console.error('âŒ ALL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CRICKET ----------
app.get('/odds-db/cricket', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\\nðŸ [${requestTime}] NEW REQUEST: /odds-db/cricket`);
    
    const allRows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${allRows?.length || 0} total records from database`);
    
    const result = processMatches(allRows, 'cricket');
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} cricket matches`);
    res.json(result);
  } catch (err) {
    console.error('âŒ CRICKET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- AFL ----------
app.get('/odds-db/afl', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\\nðŸˆ [${requestTime}] NEW REQUEST: /odds-db/afl`);
    
    const allRows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${allRows?.length || 0} total records from database`);
    
    const result = processMatches(allRows, 'aussierules_afl');
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} AFL matches`);
    res.json(result);
  } catch (err) {
    console.error('âŒ AFL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- NRL ----------
app.get('/odds-db/nrl', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\\nðŸ‰ [${requestTime}] NEW REQUEST: /odds-db/nrl`);
    
    const allRows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${allRows?.length || 0} total records from database`);
    
    const result = processMatches(allRows, 'rugby_league_nrl');
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} NRL matches`);
    res.json(result);
  } catch (err) {
    console.error('âŒ NRL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- UFC ----------
app.get('/odds-db/ufc', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\nðŸ¥Š [${requestTime}] NEW REQUEST: /odds-db/ufc`);
    
    const allRows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${allRows?.length || 0} total records from database`);
    
    const result = processMatches(allRows, 'ufc');
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} UFC matches`);
    res.json(result);
  } catch (err) {
    console.error('âŒ UFC error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- TENNIS ----------
app.get('/odds-db/tennis', async (req, res) => {
  try {
    const requestTime = new Date().toISOString();
    console.log(`\nðŸŽ¾ [${requestTime}] NEW REQUEST: /odds-db/tennis`);
    
    const allRows = await db.scanAll(72);
    console.log(`ðŸ“¥ Retrieved ${allRows?.length || 0} total records from database`);
    
    // Matches 'tennis_atp_wimbledon' and 'tennis_wta_wimbledon' (or whatever
    // tennis_* tournament is currently live) via substring match in processMatches,
    // instead of hardcoding a specific tournament key that goes stale when the
    // tournament ends.
    const result = processMatches(allRows, 'tennis');
    
    console.log(`âœ… [${requestTime}] Returning ${result.length} tennis matches`);
    res.json(result);
  } catch (err) {
    console.error('âŒ TENNIS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- HISTORY ----------
app.get('/history/:match', async (req, res) => {
  const match = decodeURIComponent(req.params.match);
  try {
    const allRows = await db.scanAll(72);
    const rows = allRows
      .filter(r => r.match && r.match.toLowerCase().includes(match.toLowerCase()))
      .sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))
      .slice(0, 2000);

    const grouped = {};
    rows.forEach(r => {
      const h = parseFloat(r.home), a = parseFloat(r.away);
      if (Number.isNaN(h) || Number.isNaN(a) || h < 1.001 || h > 10000 || a < 1.001 || a > 10000) return;
      (grouped[r.bookmaker] ||= []).push({
        timestamp: r.timestamp,
        home: h,
        away: a,
        draw: r.draw != null && !Number.isNaN(parseFloat(r.draw)) ? parseFloat(r.draw) : null
      });
    });

    res.json(grouped);
  } catch (err) {
    console.error('âŒ HISTORY error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- DEBUG: match drilldown ----------
app.get('/debug/match', async (req, res) => {
  const q = (req.query.match || '').trim();
  if (!q) return res.status(400).json({ error: 'Provide ?match=Home vs Away' });
  try {
    const all = await db.scanAll(168); // last 7 days
    const rows = all.filter(r => (r.match||'').toLowerCase() === q.toLowerCase());
    const byBookie = {};
    for (const r of rows) {
      const key = r.bookmaker;
      if (!byBookie[key]) byBookie[key] = [];
      byBookie[key].push({ ts: r.timestamp, home: r.home, away: r.away, draw: r.draw });
    }
    // Keep latest per bookie
    const latest = Object.fromEntries(
      Object.entries(byBookie).map(([k,arr]) => [k, arr.sort((a,b)=>new Date(b.ts)-new Date(a.ts))[0]])
    );
    res.json({ match: q, total: rows.length, bookmakers_found: Object.keys(byBookie), latest_per_bookmaker: latest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- DEBUG ----------
app.get('/debug/raw', async (req, res) => {
  try {
    const all = await db.scanAll(72);
    const sportBreakdown = {};
    const timestampBreakdown = {};
    
    all.forEach(record => {
      const sport = record.sport || 'unknown';
      sportBreakdown[sport] = (sportBreakdown[sport] || 0) + 1;
      
      // Group by hour for timestamp analysis
      const hour = new Date(record.timestamp).toISOString().slice(0, 13);
      timestampBreakdown[hour] = (timestampBreakdown[hour] || 0) + 1;
    });
    
    // Get latest timestamps
    const latestTimestamps = all
      .map(r => r.timestamp)
      .sort()
      .reverse()
      .slice(0, 10);
    
    res.json({ 
      total_in_db: all.length, 
      sport_breakdown: sportBreakdown,
      latest_timestamps: latestTimestamps,
      timestamp_breakdown: timestampBreakdown,
      sample: all.slice(0, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD: Cache busting endpoint
app.get('/api/cache-bust', (req, res) => {
  const now = new Date().toISOString();
  res.json({ 
    timestamp: now, 
    message: 'Cache busted',
    server_time: Date.now()
  });
});

// ---------- EXCHANGE (Betfair back/lay) ----------
// ---------- EXCHANGE (Betfair back/lay) ----------
app.get('/odds-exchange', async (req, res) => {
  try {
    const sport = (req.query.sport || '').trim().toLowerCase();
    const data = await fetchExchangeFor(sport);
    res.json(data);
  } catch (e) {
    console.error('âŒ EXCHANGE route error:', e.message);
    res.status(500).json({ error: 'Failed to load exchange odds' });
  }
});

// ---------- ALIAS: /odds-db/exchange ----------
app.get('/odds-db/exchange', async (req, res) => {
  try {
    const sport = (req.query.sport || '').trim().toLowerCase();
    const data = await fetchExchangeFor(sport);
    res.json(data);
  } catch (e) {
    console.error('âŒ EXCHANGE alias error:', e.message);
    res.status(500).json({ error: 'Failed to load exchange odds' });
  }
});

// DEBUG: List Betfair competition IDs for AFL, NRL, and Cricket
app.get('/debug/competitions', async (req, res) => {
  try {
    const sports = [
      { name: 'AFL', id: '61420' },
      { name: 'NRL', id: '1477' },
      { name: 'Cricket', id: '4' }
    ];

    const results = {};

    for (const sport of sports) {
      const comps = await betfair.makeRequest('listCompetitions', {
        filter: { eventTypeIds: [sport.id] }
      });

      results[sport.name] = comps.map(c => ({
        competitionId: c.competition.id,
        competitionName: c.competition.name
      }));
    }

    res.json(results);
  } catch (err) {
    console.error('âŒ Error fetching competitions:', err);
    res.status(500).json({ error: 'Failed to fetch competitions', details: err.message });
  }
});

// ---------- RACING (best-odds board from oddspro /movers) ----------
// GET /odds-db/racing            -> all codes
// GET /odds-db/racing?code=T     -> Thoroughbred | H Harness | G Greyhound
// Response: { dataAsOf, races: [ { race tag + runners[ { odds[], best } ] } ] }
app.get('/odds-db/racing', async (req, res) => {
  try {
    const codeRaw = (req.query.code || '').trim().toUpperCase();
    const code = ['T', 'H', 'G'].includes(codeRaw) ? codeRaw : null;
    const [races, dataAsOf] = await Promise.all([
      dbRacing.getBoard(code, 6),
      dbRacing.getLastFetchedAt()
    ]);
    res.json({ dataAsOf, code: code || 'all', count: races.length, races });
  } catch (err) {
    console.error('❌ RACING error:', err.message);
    res.status(500).json({ error: 'Failed to load racing board' });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`ðŸš€ Server on http://${HOST}:${PORT}`);
  console.log(`ðŸ• Server started at: ${new Date().toISOString()}`);
});