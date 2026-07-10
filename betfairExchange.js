// betfairExchange.js â€" with UFC and US Open Tennis support added
require('dotenv').config();
const axios = require('axios');

class BetfairExchange {
  constructor() {
    this.appKey = process.env.BETFAIR_APP_KEY;
    this.username = process.env.BETFAIR_USERNAME;
    this.password = process.env.BETFAIR_PASSWORD;
    this.sessionToken = null;
    this.lastAuth = 0;
    this.authUrl = 'https://identitysso.betfair.com/api/login';
    this.apiUrl = 'https://api.betfair.com/exchange/betting/json-rpc/v1';
  }

  async authenticate() {
    if (this.sessionToken && Date.now() - this.lastAuth < 10 * 60 * 60 * 1000) return true;
    console.log('🔐 Authenticating with Betfair...');
    try {
      const res = await axios.post(
        this.authUrl,
        `username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Application': this.appKey, Accept: 'application/json' } }
      );
      if (res.data.status === 'SUCCESS') {
        this.sessionToken = res.data.token;
        this.lastAuth = Date.now();
        console.log('✅ Betfair authentication successful');
        return true;
      }
      console.error('❌ Betfair auth failed:', res.data);
      return false;
    } catch (e) {
      console.error('❌ Betfair auth error:', e.message);
      return false;
    }
  }

  async makeRequest(method, params) {
    if (!(await this.authenticate())) return null;
    try {
      const { data } = await axios.post(
        this.apiUrl,
        [{ jsonrpc: '2.0', method: `SportsAPING/v1.0/${method}`, params, id: 1 }],
        { headers: { 'X-Application': this.appKey, 'X-Authentication': this.sessionToken, 'Content-Type': 'application/json', Accept: 'application/json' } }
      );
      if (data[0].error) {
        console.error(`❌ Betfair API Error (${method}):`, data[0].error);
        return null;
      }
      return data[0].result;
    } catch (e) {
      console.error(`❌ Betfair request failed (${method}):`, e.message);
      return null;
    }
  }

  _isWomens = (s='') => /\bnrlw\b|women|women's|\(w\)/i.test(s);
  _badRunner = (s='') => /(under|over|handicap|line|1st half|2nd half|first half|second half)/i.test(s);

  // FIXED: Much more inclusive NRL filtering
  _rugbyAllowed(comp = '', evt = '') {
    const t = `${comp} ${evt}`.toLowerCase();
    
    // Block women's matches
    if (this._isWomens(t)) return false;
    
    // Block international/non-NRL competitions
    if (/\bsuper\s*league\b|\bbetfred\b|\bchallenge\s*cup\b/.test(t)) return false;
    if (/\binternational\b|\btest\b|\bfriendly\b|\bworld\s*cup\b/.test(t)) return false;
    
    // FIXED: Allow anything with "nrl" explicitly
    if (/\bnrl\b/.test(t)) {
      console.log(`✅ Allowing explicit NRL: ${comp} ${evt}`);
      return true;
    }
    
    // FIXED: Allow based on NRL team names (more comprehensive list)
    const nrlTeams = [
      'storm', 'broncos', 'panthers', 'raiders', 'cowboys', 'rabbitohs', 'souths',
      'roosters', 'eels', 'parramatta', 'eagles', 'manly', 'dragons', 'bulldogs', 
      'tigers', 'wests', 'titans', 'knights', 'newcastle', 'dolphins', 'warriors',
      'melbourne', 'brisbane', 'penrith', 'canberra', 'north queensland', 'nth queensland',
      'south sydney', 'sydney roosters', 'sea eagles', 'st george', 'illawarra',
      'canterbury', 'gold coast', 'new zealand'
    ];
    
    const hasNrlTeams = nrlTeams.some(team => t.includes(team));
    if (hasNrlTeams) {
      console.log(`✅ Allowing NRL match based on team names: ${comp} ${evt}`);
      return true;
    }
    
    // FIXED: Allow rugby league matches from Australia
    if (/\brugby\s*league\b/.test(t) && !/\buk\b|\bengl/.test(t)) {
      console.log(`✅ Allowing Australian Rugby League: ${comp} ${evt}`);
      return true;
    }
    
    console.log(`❌ Filtered out non-NRL: ${comp} - ${evt}`);
    return false;
  }

  // Strict cricket allowlist + county team blacklist
  _cricketAllowed(s = '') {
    const x = s.toLowerCase();

    const allow = [
      'icc', 'international', 't20i', 't20 international',
      'odi', 'one day', 'test', 'test match',
      'world cup', 'the ashes',
      'indian premier league', 'ipl',
      'big bash', 'bbl'
    ];

    const blockWords = [
      'women', "women's", 'womens', 'u19', 'u-19', 'under 19', 'second xi', 'a team', 'reserves',
      'county', 'county championship', 'vitality blast', 't20 blast', 'the hundred', 'royal london',
      'psl', 'cpl', 'lpl', 'bpl', 'mzansi', 'super smash',
      'sheffield shield', 'marsh cup', 'deodhar', 'ranji', 'syed mushtaq', 'smat',
      't10', 'ecl', 'club', 'premier division', 'league division'
    ];

    const countyTeams = [
      'somerset','warwickshire','middlesex','yorkshire','sussex','worcestershire','gloucestershire',
      'kent','lancashire','glamorgan','nottinghamshire','leicestershire','essex','surrey',
      'hampshire','durham','derbyshire','northamptonshire'
    ];

    if (blockWords.some(b => x.includes(b))) return false;
    if (countyTeams.some(t => new RegExp(`\\b${t}\\b`).test(x))) return false;

    return allow.some(a => x.includes(a));
  }



  // General tennis singles filter (any tournament - Wimbledon, US Open, etc).
  // Keeps real head-to-head singles matches; drops doubles/juniors/qualifiers
  // and other non-match markets. Tournament-agnostic on purpose.
  _tennisAllowed(comp = '', evt = '') {
    const t = `${comp} ${evt}`.toLowerCase();

    // Block doubles, juniors, qualifiers, exhibitions, wheelchair, legends
    const blocked = [
      'doubles', 'mixed', 'junior', 'juniors', 'qualifying', 'qualifier',
      'boys', 'girls', 'wheelchair', 'legends', 'exhibition'
    ];
    if (blocked.some(b => t.includes(b))) {
      console.log(`❌ Blocked non-singles tennis: ${comp} - ${evt}`);
      return false;
    }

    // Otherwise allow - a two-runner tennis market is a singles match.
    // (We don't require a tournament name, so any tour event passes.)
    return true;
  }

  _fromFor(sportName) {
    if (sportName === 'rugbyleague_nrl') return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    if (sportName === 'aussierules_afl') return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    if (sportName === 'cricket') return new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    if (sportName === 'tennis') return new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    return new Date().toISOString();
  }

  async getExchangeOddsForSport(eventTypeId, sportName) {
    try {
      console.log(`💱 Fetching ${sportName} exchange odds (batched)…`);

      const from = this._fromFor(sportName);
      const to   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const events = await this.makeRequest('listEvents', {
        filter: { eventTypeIds: [eventTypeId], marketStartTime: { from, to } }
      });
      if (!events?.length) return [];

      const eventIds = events.map(e => e.event.id);

      const baseFilter = {
        eventIds,
        marketStartTime: { from, to },
        marketTypeCodes: ['MATCH_ODDS']
      };
      if (sportName === 'aussierules_afl') {
        baseFilter.marketCountries = ['AU'];
      }

      const cat = await this.makeRequest('listMarketCatalogue', {
        filter: baseFilter,
        marketProjection: ['COMPETITION','EVENT','RUNNER_DESCRIPTION'],
        maxResults: 1000
      });
      if (!cat?.length) return [];

      // DEBUG: Log all raw catalogue entries for debugging
      if (sportName === 'rugbyleague_nrl') {
        console.log('📋 Raw NRL catalogue entries:');
        cat.forEach(m => {
          console.log(`• COMP: ${m.competition?.name || ''} | EVT: ${m.event?.name || ''} | marketId=${m.marketId}`);
        });
      } else if (sportName === 'tennis') {
        console.log('🎾 Raw US Open Tennis catalogue entries:');
        cat.forEach(m => {
          console.log(`• COMP: ${m.competition?.name || ''} | EVT: ${m.event?.name || ''} | marketId=${m.marketId}`);
        });
      }

      // Apply filtering
      const filteredCat = cat.filter(m => {
        const comp = m.competition?.name || '';
        const evt  = m.event?.name || '';
        if (this._isWomens(comp) || this._isWomens(evt)) return false;

        if (sportName === 'rugbyleague_nrl') {
          return this._rugbyAllowed(comp, evt);
        }
        if (sportName === 'cricket') {
          return this._cricketAllowed(`${comp} ${evt}`);
        }
        if (sportName === 'tennis') {
          return this._tennisAllowed(comp, evt);
        }

        return true;
      });

      console.log(`📊 ${sportName}: ${cat.length} total → ${filteredCat.length} after filtering`);

      const meta = new Map();
      for (const m of filteredCat) {
        if (!m.runners || m.runners.length < 2) continue;
        const r0n = m.runners[0].runnerName || '';
        const r1n = m.runners[1].runnerName || '';
        if (this._badRunner(r0n) || this._badRunner(r1n)) continue;

        meta.set(m.marketId, {
          match: m.event?.name || '',
          openDate: m.event?.openDate,
          home: r0n,
          away: r1n
        });
      }
      const marketIds = Array.from(meta.keys());
      if (!marketIds.length) return [];

      const chunk = (arr, n) => arr.reduce((a,_,i)=> (i % n ? a : [...a, arr.slice(i, i+n)]), []);
      const chunks = chunk(marketIds, 40);

      const books = [];
      for (const ids of chunks) {
        const res = await this.makeRequest('listMarketBook', {
          marketIds: ids,
          priceProjection: { priceData: ['EX_BEST_OFFERS'] }
        });
        if (res?.length) books.push(...res);
      }

      const out = [];
      for (const b of books) {
        const info = meta.get(b.marketId);
        if (!info) continue;
        const [r0, r1] = b.runners || [];
        if (!r0 || !r1) continue;

        const r0b = r0.ex?.availableToBack?.[0] || {};
        const r0l = r0.ex?.availableToLay?.[0]  || {};
        const r1b = r1.ex?.availableToBack?.[0] || {};
        const r1l = r1.ex?.availableToLay?.[0]  || {};

        out.push({
          match: info.match,
          home_team: info.home,
          away_team: info.away,
          home_back: r0b.price ?? null,
          home_lay:  r0l.price ?? null,
          away_back: r1b.price ?? null,
          away_lay:  r1l.price ?? null,
          home_back_size: r0b.size ?? null,
          home_lay_size:  r0l.size ?? null,
          away_back_size: r1b.size ?? null,
          away_lay_size:  r1l.size ?? null,
          total_matched: b.totalMatched ?? 0,
          commence_time: info.openDate,
          sport: sportName,
          timestamp: new Date().toISOString()
        });
      }

      console.log(`✅ ${sportName}: kept ${out.length} clean exchange markets`);
      return out;
    } catch (err) {
      console.error(`❌ Error fetching ${sportName} exchange odds:`, err.message);
      return [];
    }
  }

  async getAllExchangeOdds() {
    try {
      console.log('💱 Fetching all Betfair Exchange odds (batched)…');
      const [afl, nrl, cri, usOpen] = await Promise.all([
        this.getExchangeOddsForSport('61420', 'aussierules_afl'),
        this.getExchangeOddsForSport('1477',  'rugbyleague_nrl'),
        this.getExchangeOddsForSport('4',     'cricket'),
        this.getExchangeOddsForSport('2',     'tennis')
      ]);
      const all = [...afl, ...nrl, ...cri, ...usOpen];
      console.log(`✅ Total Betfair Exchange odds: ${all.length}`);
      return all;
    } catch (e) {
      console.error('❌ Get all exchange odds error:', e.message);
      return [];
    }
  }
}

module.exports = BetfairExchange;