// racingBookies.js - AU bookmaker whitelist + name normalization for Racing.
//
// oddspro's topOdds[] uses its own bookmaker naming (e.g. "Betright", "Pointsbet",
// "Ladbrokes", "Tabtouch"). Your app already ships logos under /public/logo/*.png
// keyed differently (e.g. "betright", "pointsbetau", "ladbrokes_au", "tabtouch").
//
// This module does two jobs, matching how cronFetch.js already treats sports:
//   1. Map an oddspro name -> your canonical logo key.
//   2. Whitelist: only the AU bookies you already support pass through. Everything
//      else oddspro returns (Colossalbet, Baggybet, BetLegends, BetLocal, ...) is
//      dropped, so Racing shows the SAME bookie set as your other tabs.

// Canonical keys = your existing /public/logo/<key>.png filenames.
const SUPPORTED_LOGO_KEYS = new Set([
  'bet365', 'betdeluxe', 'betfair', 'betnation', 'betr', 'betright',
  'bluebet', 'boombet', 'dabble', 'draftstars', 'ladbrokes', 'neds',
  'palmerbet', 'picklebet', 'playup', 'pointsbetau', 'sportsbet',
  'swiftbet', 'tab', 'tabtouch', 'unibet'
]);

// oddspro name (lowercased) -> your canonical logo key.
// Only entries that resolve to a SUPPORTED_LOGO_KEYS value are shown.
const ODDSPRO_TO_LOGO = {
  bet365:      'bet365',
  betdeluxe:   'betdeluxe',
  betfair:     'betfair',
  betnation:   'betnation',
  betr:        'betr',
  betright:    'betright',
  bluebet:     'bluebet',
  boombet:     'boombet',
  dabble:      'dabble',
  draftstars:  'draftstars',
  ladbrokes:   'ladbrokes',
  neds:        'neds',
  palmerbet:   'palmerbet',
  picklebet:   'picklebet',
  playup:      'playup',
  pointsbet:   'pointsbetau',   // oddspro says "Pointsbet", your logo is pointsbetau
  pointsbetau: 'pointsbetau',
  sportsbet:   'sportsbet',
  swiftbet:    'swiftbet',
  tab:         'tab',
  tabtouch:    'tabtouch',
  unibet:      'unibet'
};

// Return canonical logo key for an oddspro bookmaker name, or null if it's not
// one of your supported AU bookies (caller should then skip it).
function toLogoKey(oddsproName) {
  if (!oddsproName) return null;
  const norm = String(oddsproName).toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = ODDSPRO_TO_LOGO[norm];
  if (mapped && SUPPORTED_LOGO_KEYS.has(mapped)) return mapped;
  return null;
}

// Filter a topOdds[] array down to supported AU bookies, rewriting each entry's
// bookmaker to your canonical logo key. Preserves price + displayName.
function filterTopOdds(topOdds) {
  if (!Array.isArray(topOdds)) return [];
  const out = [];
  for (const o of topOdds) {
    const key = toLogoKey(o.bookmaker);
    if (!key) continue; // drop non-AU / unsupported bookies
    out.push({
      bookmaker: key,
      price: typeof o.price === 'number' ? o.price : parseFloat(o.price),
      display_name: o.displayName || o.name || o.bookmaker
    });
  }
  return out;
}

// Filter /api/meetings' bookmakerMarkets[] down to your supported AU bookies.
// Each entry looks like: { bookmaker: "Betright", fixedWin: { price: 17, ... } }
// Returns [{ bookmaker: <logoKey>, price, display_name }].
function filterBookmakerMarkets(bookmakerMarkets) {
  if (!Array.isArray(bookmakerMarkets)) return [];
  const out = [];
  for (const m of bookmakerMarkets) {
    const key = toLogoKey(m.bookmaker);
    if (!key) continue; // drop the ~20 niche books you don't carry
    const fw = m.fixedWin || {};
    const price = typeof fw.price === 'number' ? fw.price : parseFloat(fw.price);
    if (!price || Number.isNaN(price)) continue; // skip no-price / suspended
    out.push({ bookmaker: key, price, display_name: m.bookmaker });
  }
  return out;
}

module.exports = { toLogoKey, filterTopOdds, filterBookmakerMarkets, SUPPORTED_LOGO_KEYS };