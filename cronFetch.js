require('dotenv').config();
const axios = require('axios');
const db = require('./db');

const API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4/sports/';
const SPORTS = [
  'aussierules_afl',
  'rugbyleague_nrl',
  'cricket_international_t20',
  'cricket_test_match',
  'cricket_odi',
  'tennis_atp_wimbledon',
  'tennis_wta_wimbledon',
  'mma_mixed_martial_arts'
];

const AU_BOOKMAKERS = [
  'sportsbet', 'betfair_ex_au', 'betfair', 'tab', 'neds', 'ladbrokes_au',
  'betright', 'boombet', 'betr_au', 'pointsbetau', 'playup', 'dabble_au',
  'unibet', 'tabtouch', 'bet365', 'bluebet', 'palmerbet', 'picklebet'
];

function normalizeBookmakerKey(key) {
  if (!key) return '';
  const lower = key.toLowerCase();
  if (lower === 'betfair_ex') return 'betfair_ex_au';
  if (lower === 'betfair') return 'betfair_ex_au';
  if (lower === 'betr') return 'betr_au';
  if (lower === 'ladbrokes') return 'ladbrokes_au';
  if (lower === 'pointsbet') return 'pointsbetau';
  if (lower === 'dabble') return 'dabble_au';
  if (lower === 'bet365com') return 'bet365';
  return lower;
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

function findOutcomeForTeam(outcomes, teamName) {
  const target = normalizeName(teamName);
  if (!target) return null;

  let outcome = outcomes.find(o => normalizeName(o.name) === target);
  if (outcome) return outcome;

  outcome = outcomes.find(o => normalizeName(o.name).includes(target) || target.includes(normalizeName(o.name)));
  if (outcome) return outcome;

  const firstWord = target.split(' ')[0];
  outcome = outcomes.find(o => normalizeName(o.name).startsWith(firstWord));
  if (outcome) return outcome;

  return null;
}

function isValidOdds(price) {
  return typeof price === 'number' && !Number.isNaN(price) && price >= 1.01 && price <= 1000;
}

function validateOdds(homePrice, awayPrice, drawPrice = null) {
  if (!isValidOdds(homePrice) || !isValidOdds(awayPrice)) return false;
  if (drawPrice !== null && drawPrice !== undefined && !isValidOdds(drawPrice)) return false;
  if (Math.abs(homePrice - awayPrice) < 0.001) return false;
  const total = 1 / homePrice + 1 / awayPrice + (drawPrice ? 1 / drawPrice : 0);
  return total >= 0.95 && total <= 1.2;
}

async function fetchOdds(sport) {
  try {
    const response = await axios.get(`${BASE_URL}${sport}/odds`, {
      params: {
        apiKey: API_KEY,
        regions: 'au',
        markets: 'h2h',
        oddsFormat: 'decimal',
        dateFormat: 'iso'
      },
      timeout: 20000
    });

    if (!Array.isArray(response.data)) {
      console.warn(`⚠️ Unexpected API response for ${sport}`, response.data);
      return [];
    }

    return response.data;
  } catch (err) {
    console.error(`❌ Failed fetching odds for ${sport}:`, err.message);
    return [];
  }
}

async function insertOddsToDatabase(matches, sport) {
  const timestamp = new Date().toISOString();
  let inserted = 0;

  for (const match of matches) {
    if (!match.home_team || !match.away_team || !Array.isArray(match.bookmakers)) continue;

    const homeTeam = match.home_team.trim();
    const awayTeam = match.away_team.trim();
    const matchName = `${homeTeam} vs ${awayTeam}`;
    const commenceTime = match.commence_time || match.commence_time;

    for (const bookmaker of match.bookmakers) {
      const key = normalizeBookmakerKey(bookmaker.key);
      if (!AU_BOOKMAKERS.includes(key)) continue;
      const market = Array.isArray(bookmaker.markets)
        ? bookmaker.markets.find(m => String(m.key).toLowerCase() === 'h2h')
        : null;
      if (!market || !Array.isArray(market.outcomes)) continue;

      const homeOutcome = findOutcomeForTeam(market.outcomes, homeTeam);
      const awayOutcome = findOutcomeForTeam(market.outcomes, awayTeam);
      const drawOutcome = market.outcomes.find(o => normalizeName(o.name) === 'draw');

      if (!homeOutcome || !awayOutcome || homeOutcome.name === awayOutcome.name) continue;

      const homePrice = parseFloat(homeOutcome.price);
      const awayPrice = parseFloat(awayOutcome.price);
      const drawPrice = drawOutcome ? parseFloat(drawOutcome.price) : null;

      if (!validateOdds(homePrice, awayPrice, drawPrice)) continue;

      try {
        await db.insertOdds({
          match: matchName,
          bookmaker: key,
          home: homePrice,
          away: awayPrice,
          draw: drawPrice || null,
          match_start_time: commenceTime,
          sport,
          timestamp
        });
        inserted += 1;
      } catch (err) {
        console.error(`❌ DB insert failed for ${matchName} / ${key}:`, err.message);
      }
    }
  }

  console.log(`💾 Inserted ${inserted} odds rows for ${sport}`);
}

async function runAll() {
  if (!API_KEY) {
    throw new Error('ODDS_API_KEY is missing. Set process.env.ODDS_API_KEY or provide a valid key.');
  }

  console.log(`🚀 Starting odds-api fetch at ${new Date().toISOString()}`);

  for (const sport of SPORTS) {
    console.log(`
🔄 Fetching ${sport}...`);
    const matches = await fetchOdds(sport);
    if (!matches.length) {
      console.log(`⚠️ No matches returned for ${sport}`);
      continue;
    }

    await insertOddsToDatabase(matches, sport);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  try {
    await db.cleanupOldMatches();
  } catch (err) {
    console.warn('⚠️ Cleanup failed after fetch:', err.message);
  }

  console.log(`✅ Odds fetch completed at ${new Date().toISOString()}`);
}

if (require.main === module) {
  runAll().catch(err => {
    console.error('❌ Fatal error in cronFetch:', err.message);
    process.exit(1);
  });
}

module.exports = { runAll };