// Fixed script.js - Better team matching and validation + Ultra Smooth Enhancements

const container = document.getElementById('odds-container');
let allMatches = [];
let activeSport = '';
let lastRacingCode = 'all';
let lastRacingPayload = { races: [] };
let lastExchangeSport = 'all';
let lastOddsMap = new Map();
let lastExchangeList = []; // cache last exchange payload

// --- Helper: show/hide bookmaker filter instantly (prevents flash on mobile) ---
function setBookmakerFilterVisible(visible) {
  const el = document.getElementById('bookmakerFilter');
  if (!el) return;
  el.style.display = visible ? '' : 'none';
}

// FIXED: Properly centered loading state
function showLoadingState() {
  container.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; justify-content: center; align-items: center; min-height: 300px; width: 100%;">
      <div style="text-align: center;">
        <div style="font-size: 1.2rem; margin-bottom: 10px; color: #003366;">Loading odds...</div>
        <div class="loading-dots">
          <span style="animation: dot-bounce 1.4s infinite; animation-delay: 0s;">●</span>
          <span style="animation: dot-bounce 1.4s infinite; animation-delay: 0.2s;">●</span>
          <span style="animation: dot-bounce 1.4s infinite; animation-delay: 0.4s;">●</span>
        </div>
      </div>
    </div>
  `;
  
  // Add loading animation styles
  if (!document.querySelector('#loading-styles')) {
    const style = document.createElement('style');
    style.id = 'loading-styles';
    style.textContent = `
      @keyframes dot-bounce {
        0%, 20%, 50%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
        40% { transform: translateY(-10px); opacity: 1; }
        60% { transform: translateY(-5px); opacity: 0.8; }
      }
      .loading-dots span {
        display: inline-block;
        margin: 0 2px;
        font-size: 1.5rem;
        color: #003366;
      }
    `;
    document.head.appendChild(style);
  }
}

// ENHANCED: Debounced search for smoother performance
let searchTimeout;
function debouncedSearch(callback, delay = 300) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(callback, delay);
}

document.getElementById('searchInput').addEventListener('input', () => {
  const searchInput = document.getElementById('searchInput');
  
  // Add subtle loading indicator
  searchInput.style.backgroundColor = '#f8f9fa';
  
  debouncedSearch(() => {
    requestAnimationFrame(() => {
      if (activeSport === 'racing') { renderRacing(lastRacingPayload); }
      else if (activeSport === 'exchange' && lastExchangeSport === 'racing') { loadExchange('racing'); }
      else if (activeSport === 'exchange') { renderExchange(lastExchangeList); }
      else { renderOdds(allMatches); }
      
      // Restore normal background
      setTimeout(() => {
        searchInput.style.backgroundColor = '';
      }, 200);
    });
  });
});

document.getElementById('bookmakerFilter').addEventListener('change', () => {
  requestAnimationFrame(() => {
    if (activeSport === 'racing') { renderRacing(lastRacingPayload); }
    else if (activeSport === 'exchange') { renderExchange(lastExchangeList); }
    else { renderOdds(allMatches); }
  });
});

// Hamburger menu setup with smooth animations
document.addEventListener('DOMContentLoaded', function() {
  const hamburger = document.querySelector('.hamburger');
  const dropdown = document.getElementById('dropdown');
  
  if (hamburger && dropdown) {
    console.log('Setting up hamburger menu');
    dropdown.style.display = 'none';
    dropdown.style.transform = 'translate3d(0, -10px, 0) scale(0.95)';
    dropdown.style.opacity = '0';
    dropdown.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    hamburger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      if (dropdown.style.display === 'block') {
        // Smooth close
        dropdown.style.transform = 'translate3d(0, -10px, 0) scale(0.95)';
        dropdown.style.opacity = '0';
        
        setTimeout(() => {
          dropdown.style.display = 'none';
        }, 300);
      } else {
        // Smooth open
        dropdown.style.display = 'block';
        
        requestAnimationFrame(() => {
          dropdown.style.transform = 'translate3d(0, 0, 0) scale(1)';
          dropdown.style.opacity = '1';
        });
      }
    });
    
    document.addEventListener('click', function(e) {
      if (!hamburger.contains(e.target) && !dropdown.contains(e.target)) {
        // Smooth close
        dropdown.style.transform = 'translate3d(0, -10px, 0) scale(0.95)';
        dropdown.style.opacity = '0';
        
        setTimeout(() => {
          dropdown.style.display = 'none';
        }, 300);
      }
    });
    
    dropdown.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  }
});

const header = document.querySelector('header');
const timeDisplay = document.createElement('div');
timeDisplay.className = 'last-updated-header';
Object.assign(timeDisplay.style, {
  position: 'absolute',
  top: '3.2rem',
  right: '1.5rem',
  color: 'white',
  fontSize: '0.85rem',
  opacity: '0.9',
  transition: 'all 0.3s ease',
});
header.appendChild(timeDisplay);

// Map the-odds-api sport keys -> clean display labels for the card tag.
// e.g. cricket_international_t20 -> "T20 International"
const SPORT_LABELS = {
  cricket_international_t20: 'T20 International',
  cricket_test_match:        'Test Match',
  cricket_odi:               'ODI',
  cricket_big_bash:          'Big Bash',
  cricket_ipl:               'IPL',
  aussierules_afl:           'AFL',
  rugbyleague_nrl:           'NRL',
  rugby_league_nrl:          'NRL',
  mma_mixed_martial_arts:    'UFC / MMA',
  tennis_atp_wimbledon:      'Wimbledon (ATP)',
  tennis_wta_wimbledon:      'Wimbledon (WTA)'
};

function sportTagLabel(key) {
  if (!key) return 'Unknown';
  const k = String(key).toLowerCase();
  if (SPORT_LABELS[k]) return SPORT_LABELS[k];
  // Fallback: tidy up any unmapped key (tennis_atp_us_open -> "Tennis Atp Us Open")
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function loadSport(sportKey) {
  // ensure bookmaker filter is visible on normal sports
  setBookmakerFilterVisible(true);
  removeRacingFilterBar();
  removeExchangeFilterBar();
  activeSport = sportKey;
  
  // Use smooth loading state
  showLoadingState();
  
  try {
    const requestTime = new Date().toISOString();
    console.log(`Loading sport: ${sportKey}`);
    
    // ADD CACHE-BUSTING PARAMETERS
    const cacheBuster = Date.now();
    const url = `/odds-db/${sportKey}?t=${cacheBuster}&_=${Math.random()}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    
    const responseTime = new Date().toISOString();
    console.log(`Received ${data.length} matches for ${sportKey}`);
    
    // Log timestamps to verify data freshness
    if (data.length > 0) {
      const timestamps = data.map(m => m.last_updated).filter(Boolean).sort().reverse();
      console.log(`Latest data timestamp: ${timestamps[0]}`);
      console.log(`Data age: ${timestamps[0] ? Math.round((Date.now() - new Date(timestamps[0]).getTime()) / 1000 / 60) : 'unknown'} minutes old`);
    }

    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = `<p>No matches found for ${sportKey}. <a href="/debug/raw" target="_blank">Check debug info</a></p>`;
      return;
    }

    allMatches = data;
    populateBookmakerDropdown(data);
    renderOdds(data);
    
    const lastUpdate = new Date().toLocaleString('en-AU', {
      timeStyle: 'short'
    });
    timeDisplay.textContent = `Updated: ${lastUpdate}`;
    
  } catch (err) {
    console.error('Error loading sport:', err);
    container.innerHTML = `<p>Error loading odds: ${err.message}. <a href="/debug/raw" target="_blank">Check debug info</a></p>`;
  }
}

// SIMPLIFIED live detection
function isMatchLive(match) {
  const now = new Date();
  const startTime = new Date(match.commence_time);
  const timeDiff = now - startTime;
  
  // Live if now is after start, and within 4 hours of start
  const maxLiveTime = 4 * 60 * 60 * 1000;
  return now >= startTime && timeDiff >= 0 && timeDiff < maxLiveTime;
}

function isMatchUpcoming(match) {
  const now = new Date();
  const startTime = new Date(match.commence_time);
  const timeDiff = startTime - now;
  
  // Match is upcoming if it starts within next 7 days
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
  
  return timeDiff > 0 && timeDiff < sevenDaysInMs;
}

// IMPROVED team matching function
function findTeamOutcomes(outcomes, homeTeam, awayTeam) {
  const homeNameLower = homeTeam.toLowerCase();
  const awayNameLower = awayTeam.toLowerCase();
  
  console.log(`Finding outcomes for: ${homeTeam} vs ${awayTeam}`);
  console.log(`Available outcomes:`, outcomes.map(o => o.name));
  
  let homeObj = null;
  let awayObj = null;
  
  // Method 1: Exact name matching
  homeObj = outcomes.find(o => o.name.toLowerCase() === homeNameLower);
  awayObj = outcomes.find(o => o.name.toLowerCase() === awayNameLower);
  
  if (homeObj && awayObj) {
    console.log(`Method 1 (exact): Found both teams`);
    return { homeObj, awayObj };
  }
  
  // Method 2: Contains matching (but ensure they're different outcomes)
  if (!homeObj || !awayObj) {
    const homeMatches = outcomes.filter(o => {
      const oName = o.name.toLowerCase();
      return homeNameLower.includes(oName) || oName.includes(homeNameLower);
    });
    
    const awayMatches = outcomes.filter(o => {
      const oName = o.name.toLowerCase();
      return awayNameLower.includes(oName) || oName.includes(awayNameLower);
    });
    
    // Make sure we don't pick the same outcome for both teams
    homeObj = homeMatches[0];
    awayObj = awayMatches.find(o => o.name !== homeObj?.name);
    
    if (!awayObj && awayMatches.length > 0) {
      awayObj = awayMatches[0];
      homeObj = homeMatches.find(o => o.name !== awayObj.name);
    }
    
    if (homeObj && awayObj && homeObj.name !== awayObj.name) {
      console.log(`Method 2 (contains): Found different teams`);
      return { homeObj, awayObj };
    }
  }
  
  // Method 3: Key word matching (for team names with multiple words)
  if (!homeObj || !awayObj || homeObj.name === awayObj.name) {
    const homeWords = homeNameLower.split(/\s+/).filter(w => w.length > 2);
    const awayWords = awayNameLower.split(/\s+/).filter(w => w.length > 2);
    
    homeObj = outcomes.find(o => {
      const oName = o.name.toLowerCase();
      return homeWords.some(word => oName.includes(word));
    });
    
    awayObj = outcomes.find(o => {
      const oName = o.name.toLowerCase();
      return awayWords.some(word => oName.includes(word)) && o.name !== homeObj?.name;
    });
    
    if (homeObj && awayObj && homeObj.name !== awayObj.name) {
      console.log(`Method 3 (keywords): Found different teams`);
      return { homeObj, awayObj };
    }
  }
  
  // Method 4: Position-based (first = home, second = away) - only if we have exactly 2 or 3 outcomes
  if ((!homeObj || !awayObj || homeObj.name === awayObj.name) && outcomes.length >= 2 && outcomes.length <= 3) {
    // Filter out draw outcomes first
    const nonDrawOutcomes = outcomes.filter(o => !o.name.toLowerCase().includes('draw'));
    
    if (nonDrawOutcomes.length === 2) {
      homeObj = nonDrawOutcomes[0];
      awayObj = nonDrawOutcomes[1];
      console.log(`Method 4 (position): Using first/second non-draw outcomes`);
      return { homeObj, awayObj };
    }
  }
  
  console.log(`Could not find valid team matching`);
  return { homeObj: null, awayObj: null };
}

// IMPROVED odds validation
function validateOdds(homePrice, awayPrice, bookmaker, teams) {
  // Check if odds are numbers
  if (isNaN(homePrice) || isNaN(awayPrice)) {
    console.log(`${bookmaker}: Non-numeric odds for ${teams}`);
    return false;
  }
  
  // Check reasonable range
  if (homePrice < 1.01 || homePrice > 1000 || awayPrice < 1.01 || awayPrice > 1000) {
    console.log(`${bookmaker}: Out of range odds for ${teams} - home: ${homePrice}, away: ${awayPrice}`);
    return false;
  }
  
  // Check if odds are exactly the same (suspicious)
  if (Math.abs(homePrice - awayPrice) < 0.001) {
    console.log(`${bookmaker}: Identical odds for ${teams} - home: ${homePrice}, away: ${awayPrice}`);
    // Don't reject identical odds completely, but flag them
  }
  
  // Check implied probability makes sense (should be > 100% due to bookmaker margin)
  const homeImplied = 1 / homePrice;
  const awayImplied = 1 / awayPrice;
  const totalImplied = homeImplied + awayImplied;
  
  if (totalImplied < 0.95 || totalImplied > 1.2) {
    console.log(`${bookmaker}: Unusual implied probability for ${teams} - total: ${(totalImplied * 100).toFixed(1)}%`);
    // Don't reject, but warn about unusual probabilities
  }
  
  return true;
}

// ENHANCED: renderOdds with smooth animations
async function renderOdds(matches) {
  // Render in one pass (like the racing tab) - no fade-out + setTimeout gap,
  // which was causing a visible flicker/blank flash on tab switches.
  {
    container.innerHTML = '';
    
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const selectedBookie = document.getElementById('bookmakerFilter').value;
    const uniqueMap = new Map();

    // Filter matches
    matches.forEach(match => {
      const key = `${match.home_team} vs ${match.away_team}`;
      const matchName = key.toLowerCase();

      // Only filter by search term and selected bookmaker
      if (searchTerm && !matchName.includes(searchTerm)) return;
      if (selectedBookie) {
        const hasBookie = match.bookmakers.some(b => b.key === selectedBookie);
        if (!hasBookie) return;
      }

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          ...match,
          bookmakers: [...match.bookmakers]
        });
      } else {
        const existing = uniqueMap.get(key);
        const existingKeys = new Set(existing.bookmakers.map(b => b.key));
        match.bookmakers.forEach(b => {
          if (!existingKeys.has(b.key)) {
            existing.bookmakers.push(b);
            existingKeys.add(b.key);
          }
        });
      }
    });

    // Sort matches: Live → Upcoming → Future
    const sortedMatches = Array.from(uniqueMap.values()).sort((a, b) => {
      const aLive = isMatchLive(a);
      const bLive = isMatchLive(b);
      const aUpcoming = isMatchUpcoming(a);
      const bUpcoming = isMatchUpcoming(b);
      
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      
      if (!aLive && !bLive) {
        if (aUpcoming && !bUpcoming) return -1;
        if (!aUpcoming && bUpcoming) return 1;
      }
      
      return new Date(a.commence_time) - new Date(b.commence_time);
    });

    console.log(`Rendering ${sortedMatches.length} matches after filtering`);

    sortedMatches.forEach((match, matchIndex) => {
      if (!Array.isArray(match.bookmakers) || !match.bookmakers.length) {
        console.log(`Skipping match with no bookmakers: ${match.home_team} vs ${match.away_team}`);
        return;
      }

      const teams = `${match.home_team} vs ${match.away_team}`;
      const rows = [];
      let drawPresent = false;
      
      console.log(`Processing: ${teams} with ${match.bookmakers.length} bookmakers`);

      match.bookmakers.forEach(b => {
        const mkt = b.markets?.find(m => m.key === 'h2h');
        if (!mkt || !Array.isArray(mkt.outcomes)) {
          console.log(`${b.key}: No valid h2h market`);
          return;
        }

        // Use improved team matching
        const { homeObj, awayObj } = findTeamOutcomes(mkt.outcomes, match.home_team, match.away_team);
        const drawObj = mkt.outcomes.find(o => o.name.toLowerCase() === 'draw');

        if (!homeObj || !awayObj) {
          console.log(`${b.key}: Could not match teams for ${teams}`);
          return;
        }

        // Make sure we found different outcomes
        if (homeObj.name === awayObj.name) {
          console.log(`${b.key}: Same outcome matched for both teams: ${homeObj.name}`);
          return;
        }

        const homePrice = parseFloat(homeObj.price);
        const awayPrice = parseFloat(awayObj.price);
        
        // Use improved validation
        if (!validateOdds(homePrice, awayPrice, b.key, teams)) {
          return;
        }

        console.log(`${b.key}: ACCEPTED - ${match.home_team}(${homeObj.name}): ${homePrice} vs ${match.away_team}(${awayObj.name}): ${awayPrice}`);

        const entry = { bookie: b.key, home: homePrice, away: awayPrice };

        if (drawObj && !isNaN(parseFloat(drawObj.price)) && 
            parseFloat(drawObj.price) >= 1.001 && parseFloat(drawObj.price) <= 10000) {
          entry.draw = parseFloat(drawObj.price);
          drawPresent = true;
        }
        rows.push(entry);
      });

      if (!rows.length) {
        console.log(`No valid bookmakers for ${teams} after validation`);
        return;
      }

      console.log(`Final: ${teams} has ${rows.length} bookmakers`);

      const bestHome = Math.max(...rows.map(r => +r.home));
      const bestAway = Math.max(...rows.map(r => +r.away));
      const bestDraw = drawPresent ? Math.max(...rows.map(r => r.draw ? +r.draw : 0)) : 0;

      // Chip design: one row per bookie -> logo + Home/Draw/Away price chips.
      // Best price in each column highlighted green. Matches racing tiles.
      const inner = rows.map(r => {
        const key = `${teams}-${r.bookie}`;
        const last = lastOddsMap.get(key) || {};
        const homeChg = last.home !== undefined && last.home !== r.home;
        const awayChg = last.away !== undefined && last.away !== r.away;
        lastOddsMap.set(key, { home: r.home, away: r.away });

        const logoKey = r.bookie.replaceAll('_au','').replaceAll('betfair_ex_au','betfair').replaceAll('betfair_ex','betfair');
        const betUrl = generateBetLink(r.bookie);
        const homeBest = +r.home === bestHome;
        const awayBest = +r.away === bestAway;
        const drawBest = drawPresent && r.draw && +r.draw === bestDraw;

        const priceChip = (val, isBest, changed) => `
          <a class="mc-odd ${isBest ? 'best' : ''} ${changed ? 'changed' : ''}" href="${betUrl}" target="_blank" rel="noopener">
            ${val != null && val !== '' ? (+val).toFixed(2) : '—'}
          </a>`;

        return `
          <div class="mc-row">
            <a class="mc-logo" href="${betUrl}" target="_blank" rel="noopener" title="${r.bookie}">
              <img src="logo/${logoKey}.png" alt="${r.bookie}" onerror="this.style.display='none'"/>
            </a>
            <div class="mc-prices ${drawPresent ? 'has-draw' : ''}">
              ${priceChip(r.home, homeBest, homeChg)}
              ${drawPresent ? priceChip(r.draw, drawBest, false) : ''}
              ${priceChip(r.away, awayBest, awayChg)}
            </div>
          </div>`;
      }).join('');

      // Match status display
      const now = new Date();
      const startTime = new Date(match.commence_time);
      const isLive = isMatchLive(match);
      const isUpcoming = isMatchUpcoming(match);
      
      let timeDisplay, statusClass = '', liveIndicator = '';
      
      if (isLive) {
        const timeSinceStart = now - startTime;
        const hoursSince = Math.floor(timeSinceStart / (1000 * 60 * 60));
        const minutesSince = Math.floor((timeSinceStart % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hoursSince > 0) {
          timeDisplay = `LIVE ${hoursSince}h ${minutesSince}m`;
        } else {
          timeDisplay = `LIVE ${minutesSince}m`;
        }
        statusClass = 'live-match';
        liveIndicator = '<div class="live-indicator">LIVE</div>';
      } else if (isUpcoming) {
        const timeUntil = startTime - now;
        const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
        const minutesUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hoursUntil < 1) {
          timeDisplay = `Starts in ${minutesUntil}m`;
        } else if (hoursUntil < 24) {
          timeDisplay = `Starts in ${hoursUntil}h ${minutesUntil}m`;
        } else {
          const daysUntil = Math.floor(hoursUntil / 24);
          timeDisplay = `Starts in ${daysUntil}d ${hoursUntil % 24}h`;
        }
        statusClass = 'upcoming-match';
      } else {
        timeDisplay = `Start: ${startTime.toLocaleString('en-AU', {
          dateStyle: 'short',
          timeStyle: 'short'
        })}`;
      }
      
      const card = document.createElement('div');
      card.className = `match-card ${statusClass} card-entrance`;
      
      card.innerHTML = `
        ${liveIndicator}
        <h3>${teams}</h3>
        <div class="start-time ${statusClass}">${timeDisplay}</div>
        <div class="sport-tag">${sportTagLabel(match.sport)}</div>
        <div class="mc-colhead ${drawPresent ? 'has-draw' : ''}">
          <span class="mc-colhead-logo"></span>
          <span>Home</span>
          ${drawPresent ? '<span>Draw</span>' : ''}
          <span>Away</span>
        </div>
        <div class="mc-list">${inner}</div>
      `;

      container.appendChild(card);
    });

    const hasDrawColumn = document.querySelector('th:nth-child(4)')?.textContent.toLowerCase() === 'draw';
    document.body.classList.toggle('draw-match', hasDrawColumn);
  }
}

// Complete bet link generation for ALL AU bookmakers

// ===== Exchange Tab Support =====
async function loadExchange(subSport = 'all') {
  // hide bookmaker filter immediately to avoid flash on first render
  setBookmakerFilterVisible(false);
  removeRacingFilterBar();
  activeSport = 'exchange';
  lastExchangeSport = subSport;

  // sub-sport pills. afl/nrl/cricket/tennis/ufc = H2H; racing = multi-runner.
  const bar = ensureExchangeFilterBar();
  const pills = [['all','All'],['afl','AFL'],['nrl','NRL'],['cricket','Cricket'],
                 ['tennis','Tennis'],['ufc','UFC'],['racing','Racing']];
  bar.innerHTML = pills.map(([v,label]) => {
    const on = (lastExchangeSport === v);
    return `<button class="sub-pill ${on ? 'active' : ''}" onclick="loadExchange('${v}')">${label}</button>`;
  }).join('');

  showLoadingState();

  // Racing exchange uses a different endpoint + multi-runner card.
  if (subSport === 'racing') {
    try {
      const res = await fetch(`/odds-exchange/racing?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      renderRacingExchange(data);
      timeDisplay.textContent = `Updated: ${new Date().toLocaleString('en-AU', { timeStyle: 'short' })}`;
    } catch (err) {
      console.error('Error loading racing exchange:', err);
      container.innerHTML = `<p style="padding:20px;">Error loading racing exchange: ${err.message}.</p>`;
    }
    return;
  }

  try {
    const q = (subSport && subSport !== 'all') ? `?sport=${encodeURIComponent(subSport)}` : '';
    const url = `/odds-exchange${q}${q ? '&' : '?'}t=${Date.now()}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    lastExchangeList = Array.isArray(data) ? data : [];
    renderExchange(lastExchangeList);
    const lastUpdate = new Date().toLocaleString('en-AU', { timeStyle: 'short' });
    timeDisplay.textContent = `Updated: ${lastUpdate}`;
  } catch (err) {
    console.error('Error loading exchange:', err);
    container.innerHTML = `<p>Error loading exchange: ${err.message}. <a href="/debug/raw" target="_blank">Check debug info</a></p>`;
  }
}

function renderExchange(list) {
  // Hide bookmaker dropdown on Exchange (only one source)
  const dropdown = document.getElementById('bookmakerFilter');
  if (dropdown) dropdown.style.display = 'none';

  // Render in one pass (no fade-out + setTimeout gap = no flicker)
  {
    container.innerHTML = '';
    
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<p>No exchange markets found right now.</p>';
      return;
    }

    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const items = list.filter(m => {
      const key = `${m.home_team} vs ${m.away_team}`.toLowerCase();
      return !searchTerm || key.includes(searchTerm);
    });

    items.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    const fmtSize = v => (v != null && !Number.isNaN(v))
      ? '$' + Math.round(Number(v)).toLocaleString('en-AU')
      : '';

    items.forEach((m, index) => {
      if (m.market_id) { console.log(`Betfair marketId=${m.market_id} | ${m.home_team} vs ${m.away_team}`); }
      const teams = `${m.home_team} vs ${m.away_team}`;
      const card = document.createElement('div');

      // --- same live/upcoming logic as other tabs ---
      const now = new Date();
      const startTime = new Date(m.commence_time);
      const live = isMatchLive(m);
      const upcoming = isMatchUpcoming(m);

      let timeDisplay, statusClass = '', liveIndicator = '';

      if (live) {
        const elapsed = now - startTime;
        const h = Math.floor(elapsed / (1000 * 60 * 60));
        const mns = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
        timeDisplay = h > 0 ? `LIVE ${h}h ${mns}m` : `LIVE ${mns}m`;
        statusClass = 'live-match';
        liveIndicator = '<div class="live-indicator">LIVE</div>';
      } else if (upcoming) {
        const until = startTime - now;
        const h = Math.floor(until / (1000 * 60 * 60));
        const mns = Math.floor((until % (1000 * 60 * 60)) / (1000 * 60));
        if (h < 1) timeDisplay = `Starts in ${mns}m`;
        else if (h < 24) timeDisplay = `Starts in ${h}h ${mns}m`;
        else {
          const d = Math.floor(h / 24);
          timeDisplay = `Starts in ${d}d ${h % 24}h`;
        }
        statusClass = 'upcoming-match';
      } else {
        timeDisplay = `Start: ${startTime.toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}`;
      }

      card.className = `match-card ${statusClass} card-entrance`;
      
      const timeText = timeDisplay;
      // Prefer the competition/tournament name (e.g. "Wimbledon", "ICC T20 WC",
      // "The Ashes Test") over the generic sport code. Falls back to sport.
      const sportLabel = (m.competition && m.competition.trim())
        ? m.competition.trim()
        : (m.sport || 'exchange').toUpperCase();

      const exCell = (price, size, kind) => `
        <div class="exc-cell exc-${kind}">
          <span class="exc-price">${price != null ? (+price).toFixed(2) : '—'}</span>
          ${size ? `<span class="exc-size">${fmtSize(size)}</span>` : ''}
        </div>`;

      card.innerHTML = `
        ${liveIndicator}
        <h3>${teams}</h3>
        <div class="start-time ${statusClass}">${timeText}</div>
        <div class="sport-tag">${sportLabel}</div>
        <div class="exc-matched-row">Matched <strong>AUD ${(m.total_matched ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })}</strong></div>
        <div class="exc-grid">
          <div class="exc-side">
            <div class="exc-team">${m.home_team || 'Home'}</div>
            <div class="exc-pair">
              ${exCell(m.home_back, m.home_back_size, 'back')}
              ${exCell(m.home_lay, m.home_lay_size, 'lay')}
            </div>
            <div class="exc-labels"><span>Back</span><span>Lay</span></div>
          </div>
          <div class="exc-side">
            <div class="exc-team">${m.away_team || 'Away'}</div>
            <div class="exc-pair">
              ${exCell(m.away_back, m.away_back_size, 'back')}
              ${exCell(m.away_lay, m.away_lay_size, 'lay')}
            </div>
            <div class="exc-labels"><span>Back</span><span>Lay</span></div>
          </div>
        </div>
        <a class="exc-betfair-link" href="https://www.betfair.com.au" target="_blank" rel="noopener">
          <img src="logo/betfair.png" alt="Betfair" onerror="this.style.display='none'"/> Bet on Betfair
        </a>
      `;
      
      container.appendChild(card);
    });
  }
}

// ===== Racing Exchange (multi-runner Betfair win markets) =====
function racingExchStartLabel(iso) {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const mins = Math.round((t - Date.now()) / 60000);
  const hhmm = new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  if (mins <= 0) return `Jumped · ${hhmm}`;
  if (mins < 60) return `${mins}m · ${hhmm}`;
  return `${Math.floor(mins/60)}h ${mins%60}m · ${hhmm}`;
}

function renderRacingExchange(data) {
  const dropdown = document.getElementById('bookmakerFilter');
  if (dropdown) dropdown.style.display = 'none';

  const horse = (data && Array.isArray(data.horse)) ? data.horse : [];
  const grey  = (data && Array.isArray(data.greyhound)) ? data.greyhound : [];
  let races = [...horse, ...grey].sort((a,b) => new Date(a.start_time) - new Date(b.start_time));

  const term = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  if (term) races = races.filter(r => `${r.venue} ${r.market_name}`.toLowerCase().includes(term));

  if (!races.length) {
    container.innerHTML = `<p style="padding:20px;grid-column:1/-1;">No AU racing exchange markets right now.</p>`;
    return;
  }

  const icon = c => c === 'greyhound' ? '🐕' : '🐎';
  const codeLabel = c => c === 'greyhound' ? 'Greyhound' : 'Horse';
  const fmtSize = v => (v != null && !Number.isNaN(v)) ? '$' + Math.round(Number(v)).toLocaleString('en-AU') : '';

  container.innerHTML = races.map(race => {
    const rows = race.runners.map(rn => `
      <div class="rex-runner">
        <span class="rex-name">${rn.name}</span>
        <span class="rex-cell rex-back" title="Back liquidity ${fmtSize(rn.back_size)}">${rn.back != null ? (+rn.back).toFixed(2) : '—'}</span>
        <span class="rex-cell rex-lay" title="Lay liquidity ${fmtSize(rn.lay_size)}">${rn.lay != null ? (+rn.lay).toFixed(2) : '—'}</span>
      </div>`).join('');

    return `
      <div class="odds-card racing-card card-entrance">
        <div class="racing-card-head">
          <div class="racing-card-title">
            <div class="racing-track">${race.venue}</div>
            <div class="racing-racename">${race.market_name || ''} · Matched ${fmtSize(race.total_matched)}</div>
          </div>
          <div class="racing-card-meta">
            <span class="racing-tag">${icon(race.code)} ${codeLabel(race.code)} · Exchange</span>
            <div class="racing-start">${racingExchStartLabel(race.start_time)}</div>
          </div>
        </div>
        <div class="rex-header">
          <span class="rex-name">Runner</span>
          <span class="rex-cell">Back</span>
          <span class="rex-cell">Lay</span>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

function generateBetLink(bookmaker) {
  const normalized = bookmaker
    .toLowerCase()
    .replace(/_au$/, "")        // strip trailing "_au"
    .replace(/[^a-z0-9]/g, ""); // remove any non-alphanumeric

  const linkMap = {
    'sportsbet': 'https://www.sportsbet.com.au',
    'betfair_ex_au': 'https://www.betfair.com.au',
    'betfair_ex': 'https://www.betfair.com.au',
    'tab': 'https://www.tab.com.au',
    'neds': 'https://www.neds.com.au',
    'ladbrokes_au': 'https://www.ladbrokes.com.au',
    'betright': 'https://www.betright.com.au',
    'boombet': 'https://www.boombet.com.au',
    'betr_au': 'https://www.betr.com.au',
    'pointsbetau': 'https://www.pointsbet.com.au',
    'playup': 'https://www.playup.com.au',
    'dabble_au': 'https://www.dabble.com.au',
    'unibet': 'https://www.unibet.com.au',
    'tabtouch': 'https://www.tabtouch.com.au',
    'bet365': 'https://www.bet365.com.au',
    'bluebet': 'https://www.bluebet.com.au',
    'palmerbet': 'https://www.palmerbet.com',
    'picklebet': 'https://picklebet.com/en-au/sports/betting/?page=1&tab=next'
  };
  
  if (linkMap[bookmaker]) {
    return linkMap[bookmaker];
  }
  
  // Default fallback for any new bookmakers
  const cleanBookie = bookmaker
    .replace(/_au$/, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  return `https://www.${cleanBookie}.com.au`;
}

// ENHANCED: selectTab with smooth transitions
function selectTab(sportKey) {
  // Add loading state immediately
  showLoadingState();
  
  // Smooth tab switching animation
  document.querySelectorAll('.sport-tab').forEach(tab => {
    tab.style.transform = 'scale(0.95)';
    tab.classList.remove('active');
    
    requestAnimationFrame(() => {
      tab.style.transform = '';
    });
  });
  
  // Highlight selected tab with smooth animation
  const clickedTab = document.querySelector(`[onclick*="${sportKey}"]`);
  if (clickedTab) {
    requestAnimationFrame(() => {
      clickedTab.classList.add('active');
      clickedTab.style.transform = 'scale(1.05)';
      
      setTimeout(() => {
        clickedTab.style.transform = '';
      }, 200);
    });
  }
  
  const sportMap = {
    'aussierules_afl': 'afl',
    'rugbyleague_nrl': 'nrl',
    'cricket': 'cricket',
    'ufc': 'ufc',
    'tennis': 'tennis'
  };
  
  const mappedSport = sportMap[sportKey] || sportKey;
  localStorage.setItem('selectedTab', sportKey);
  history.replaceState(null, '', `?sport=${mappedSport}`);
  
  // Call with small delay for smooth transition
  setTimeout(() => {
    if (sportKey === 'racing' || mappedSport === 'racing') {
      loadRacing('all');
    } else if (sportKey === 'exchange' || mappedSport === 'exchange') { 
      loadExchange('all'); 
    } else { 
      loadSport(mappedSport); 
    }
  }, 100);
}

// ENHANCED: DOMContentLoaded with all smooth features
window.addEventListener('DOMContentLoaded', () => {
  // Add CSS for animations
  if (!document.querySelector('#smooth-animation-styles')) {
    const style = document.createElement('style');
    style.id = 'smooth-animation-styles';
    style.textContent = `
      .card-entrance {
        animation: cardSlideIn 0.5s ease-out forwards;
      }
      
      @keyframes cardSlideIn {
        from {
          opacity: 0;
          transform: translateY(30px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      
      @keyframes cardSlideOut {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(-20px) scale(0.95);
        }
      }
      
      .low-performance * {
        transition-duration: 0.1s !important;
        animation-duration: 0.1s !important;
      }
      
      .low-performance .match-card:hover {
        transform: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  try {
    const sel = localStorage.getItem('selectedTab');
    if (sel === 'exchange') { setBookmakerFilterVisible(false); }
    else { setBookmakerFilterVisible(true); }
  } catch (e) { /* ignore */ }

  const params = new URLSearchParams(window.location.search);
  const storedSport = localStorage.getItem('selectedTab');
  // Default to cricket instead of all
  const sport = storedSport || params.get('sport') || 'cricket';

  const sportMap = {
    'aussierules_afl': 'afl',
    'rugbyleague_nrl': 'nrl',
    'cricket': 'cricket',
    'ufc': 'ufc',
    'tennis': 'tennis'
  };
  
  const mappedSport = sportMap[sport] || sport;
  if (mappedSport === 'racing') { loadRacing('all'); }
  else if (mappedSport === 'exchange') { loadExchange('all'); }
  else { loadSport(mappedSport); }

  let pageVisible = true;
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
  });
  
  // ENHANCED: Auto-refresh with smooth transitions
  setInterval(() => {
    if (!pageVisible) return;
    
    const active = localStorage.getItem('selectedTab') || 'cricket';
    const sportMap = {
      'aussierules_afl': 'afl',
      'rugbyleague_nrl': 'nrl',
      'cricket': 'cricket',
      'ufc': 'ufc',
      'tennis': 'tennis'
    };
    const mappedActive = sportMap[active] || active;
    
    // Subtle refresh animation
    timeDisplay.style.transform = 'scale(0.9)';
    timeDisplay.style.opacity = '0.7';
    
    if (mappedActive === 'racing') {
      console.log('Auto-refreshing racing board...');
      loadRacing(lastRacingCode || 'all');
    } else if (mappedActive === 'exchange') {
      console.log('Auto-refreshing exchange markets...');
      loadExchange(lastExchangeSport || 'all');
    } else {
      console.log(`Auto-refreshing ${mappedActive} matches...`);
      loadSport(mappedActive);
    }
    
    setTimeout(() => {
      timeDisplay.style.transform = '';
      timeDisplay.style.opacity = '1';
    }, 300);
  }, 30000); // 30 seconds for faster updates
});

function populateBookmakerDropdown(matches) {
  const bookies = new Set();
  matches.forEach(match => {
    match.bookmakers.forEach(b => bookies.add(b.key));
  });
  const dropdown = document.getElementById('bookmakerFilter');
  dropdown.innerHTML = '<option value="">All Bookmakers</option>';
  [...bookies].sort().forEach(bk => {
    const opt = document.createElement('option');
    opt.value = bk;
    opt.textContent = bk.replace(/_au$/, '').replace(/_/g, ' ').replace('betfair_ex_au', 'betfair').replace('betfair_ex', 'betfair');
    dropdown.appendChild(opt);
  });
}
// ===== Racing Tab Support (oddspro best-odds board) =====
// Sub-filter across racing codes. 'all' shows T+H+G interleaved by start time.
async function loadRacing(code = 'all') {
  setBookmakerFilterVisible(true);
  removeExchangeFilterBar();
  activeSport = 'racing';
  lastRacingCode = code;
  showLoadingState();

  try {
    const q = (code && code !== 'all') ? `code=${encodeURIComponent(code)}&` : '';
    const url = `/odds-db/racing?${q}t=${Date.now()}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const payload = await res.json();
    lastRacingPayload = payload && Array.isArray(payload.races) ? payload : { races: [] };
    populateRacingBookmakerDropdown(lastRacingPayload);
    renderRacing(lastRacingPayload);
    if (payload.dataAsOf) {
      const asOf = new Date(payload.dataAsOf).toLocaleString('en-AU', { timeStyle: 'short' });
      timeDisplay.textContent = `Updated: ${asOf}`;
    }
  } catch (err) {
    console.error('Error loading racing:', err);
    container.innerHTML = `<p style="padding:20px;">Error loading racing: ${err.message}.</p>`;
  }
}

// Populate the shared bookmaker dropdown with the bookies present across racing.
function populateRacingBookmakerDropdown(payload) {
  const dropdown = document.getElementById('bookmakerFilter');
  if (!dropdown) return;
  const prev = dropdown.value;
  const bookies = new Set();
  (payload.races || []).forEach(race =>
    race.runners.forEach(rn => rn.odds.forEach(o => bookies.add(o.bookmaker))));
  dropdown.innerHTML = '<option value="">All Bookmakers</option>';
  [...bookies].sort().forEach(bk => {
    const opt = document.createElement('option');
    opt.value = bk;
    opt.textContent = bk.replace(/_au$/, '').replace(/pointsbetau/, 'pointsbet').replace(/_/g, ' ');
    dropdown.appendChild(opt);
  });
  // keep prior selection if still valid
  if (prev && bookies.has(prev)) dropdown.value = prev;
}

const RACING_CODE_LABEL = { T: 'Horse Racing', H: 'Harness', G: 'Greyhound' };
const RACING_CODE_ICON  = { T: '🐎', H: '🏇', G: '🐕' };

function racingStartLabel(iso) {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const diff = t - Date.now();
  const mins = Math.round(diff / 60000);
  const hhmm = new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  // already started
  if (mins <= 0) return `Jumped · ${hhmm}`;
  // upcoming
  if (mins < 60) return `${mins}m · ${hhmm}`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m · ${hhmm}`;
}

function ensureFilterBar(id) {
  // A full-width pill bar that lives OUTSIDE #odds-container (which is a CSS
  // grid) so the grid doesn't squash it into a column. Shared by racing +
  // exchange sub-filters.
  let bar = document.getElementById(id);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = id;
    bar.className = 'sub-filter-bar';
    container.parentNode.insertBefore(bar, container);
  }
  return bar;
}
function ensureRacingFilterBar() { return ensureFilterBar('racing-filter-bar'); }
function ensureExchangeFilterBar() { return ensureFilterBar('exchange-filter-bar'); }

function removeRacingFilterBar() {
  const bar = document.getElementById('racing-filter-bar');
  if (bar) bar.remove();
}
function removeExchangeFilterBar() {
  const bar = document.getElementById('exchange-filter-bar');
  if (bar) bar.remove();
}

// ---- Racing sparkline ------------------------------------------------------
// Builds a tiny inline SVG from the runner's average-price series, plus a
// firm/drift indicator. NOTE the direction convention: in racing, a FALLING
// price means the runner is FIRMING (money coming for it) and a RISING price
// means it's DRIFTING (money going away). So down = green, up = red.
let racingHistory = {};   // runner_id -> [{t, p}, ...]

function runnerSparkline(runnerId) {
  const series = racingHistory[runnerId];
  if (!Array.isArray(series) || series.length < 2) {
    return '<span class="spark-empty" title="Not enough history yet">–</span>';
  }

  const pts = series.map(d => Number(d.p)).filter(n => isFinite(n) && n > 0);
  if (pts.length < 2) return '<span class="spark-empty">–</span>';

  const first = pts[0];
  const last  = pts[pts.length - 1];
  const min   = Math.min(...pts);
  const max   = Math.max(...pts);
  const range = (max - min) || 1;          // avoid divide-by-zero on a flat line

  // Map the series into a 60x18 viewBox.
  const W = 60, H = 18, PAD = 2;
  const coords = pts.map((p, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    // invert y: higher price = higher on chart
    const y = (H - PAD) - ((p - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Trend: falling price = firming (green), rising = drifting (red).
  const pct = ((last - first) / first) * 100;
  let cls, arrow;
  if (Math.abs(pct) < 0.5) { cls = 'flat';  arrow = '–'; }
  else if (pct < 0)        { cls = 'firm';  arrow = '▼'; }   // shortened = firming
  else                     { cls = 'drift'; arrow = '▲'; }   // lengthened = drifting

  const title = `${first.toFixed(2)} → ${last.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) · avg across bookies`;

  return `
    <span class="spark ${cls}" title="${title}">
      <svg viewBox="0 0 ${W} ${H}" class="spark-svg" preserveAspectRatio="none">
        <polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5"
                  stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <span class="spark-trend">${arrow} ${Math.abs(pct).toFixed(1)}%</span>
    </span>`;
}

function renderRacing(payload) {
  const races0 = (payload && Array.isArray(payload.races)) ? payload.races : [];
  // Stash the odds-history series so runnerSparkline() can look up by runner_id.
  racingHistory = (payload && payload.history) ? payload.history : {};

  // pills OUTSIDE the grid, in their own full-width bar
  const bar = ensureRacingFilterBar();
  bar.innerHTML = ['all', 'T', 'H', 'G'].map(c => {
    const on = (lastRacingCode === c);
    const label = c === 'all' ? 'All' : RACING_CODE_LABEL[c];
    return `<button class="racing-pill ${on ? 'active' : ''}" onclick="loadRacing('${c}')">${label}</button>`;
  }).join('');

  // --- apply search + bookmaker filters (same inputs as the sports tabs) ---
  const term = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const bookieFilter = document.getElementById('bookmakerFilter')?.value || '';

  let races = races0;
  if (term) {
    races = races.filter(r =>
      (`${r.track} r${r.race_number} ${r.race_name || ''}`.toLowerCase().includes(term)) ||
      r.runners.some(rn => (rn.runner_name || '').toLowerCase().includes(term)));
  }
  if (bookieFilter) {
    // keep only races/runners that have the selected bookie, and show only its price
    races = races
      .map(r => ({
        ...r,
        runners: r.runners
          .map(rn => ({ ...rn, odds: rn.odds.filter(o => o.bookmaker === bookieFilter) }))
          .filter(rn => rn.odds.length > 0)
      }))
      .filter(r => r.runners.length > 0);
  }

  if (!races.length) {
    container.innerHTML =
      `<p style="padding:20px;grid-column:1/-1;">No races match your filters.</p>`;
    return;
  }

  container.innerHTML = races.map(race => {
    const icon = RACING_CODE_ICON[race.racing_code] || '🏁';
    const codeLabel = RACING_CODE_LABEL[race.racing_code] || race.racing_code;
    const loc = race.location ? ` · ${race.location}` : '';
    const tag = `${icon} ${codeLabel}${loc}`;
    const header = `${race.track} R${race.race_number}`;
    const start = racingStartLabel(race.start_time);

    const runnerRows = race.runners.map(rn => {
      const cells = rn.odds.map(o => `
        <a class="racing-odd ${o.is_best ? 'best' : ''}" href="${generateBetLink(o.bookmaker)}" target="_blank" rel="noopener" title="Go to ${o.bookmaker.replace(/pointsbetau/, 'pointsbet').replace(/_/g, ' ')}">
          <img src="logo/${o.bookmaker}.png" alt="${o.bookmaker}" onerror="this.style.display='none'"/>
          ${(+o.price).toFixed(2)}
        </a>`).join('');
      return `
        <div class="racing-runner">
          <div class="racing-runner-head">
            <span class="racing-runner-name">${rn.runner_number}. ${rn.runner_name}</span>
            <span class="racing-runner-meta">
              ${runnerSparkline(rn.runner_id)}
              <span class="racing-best">best ${(+rn.best_odds).toFixed(2)}</span>
            </span>
          </div>
          <div class="racing-odds-row">${cells}</div>
        </div>`;
    }).join('');

    return `
      <div class="odds-card racing-card card-entrance">
        <div class="racing-card-head">
          <div class="racing-card-title">
            <div class="racing-track">${header}</div>
            <div class="racing-racename">${race.race_name || ''}</div>
          </div>
          <div class="racing-card-meta">
            <span class="racing-tag">${tag}</span>
            <div class="racing-start">${start}</div>
          </div>
        </div>
        ${runnerRows}
      </div>`;
  }).join('');
}