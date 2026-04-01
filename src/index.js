// ====================================================
// uptime.lumosdhia.com — Cloudflare Worker
// Monitors your VPS and serves a live status dashboard
// ====================================================

// The list of services to check
const SERVICES = [
  { name: "Main Portfolio", url: "https://lumosdhia.com", group: "Core" },
  { name: "EcoSpot App",    url: "https://ecospot.lumosdhia.com", group: "Apps" },
];

// ——— CRON: Runs every 5 minutes ———
async function runChecks(env, shouldAlert = false) {
  const results = [];
  
  // Get historical stats from KV with safety fallback
  let statsData = await env.UPTIME_KV.get("UPTIME_STATS");
  let historyData = await env.UPTIME_KV.get("UPTIME_HISTORY");
  
  let stats = statsData ? JSON.parse(statsData) : {};
  let history = historyData ? JSON.parse(historyData) : {};

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  for (const service of SERVICES) {
    const start = Date.now();
    let status = "DOWN";
    let statusCode = null;

    try {
      const res = await fetch(service.url, {
        method: "GET",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      statusCode = res.status;
      if (res.ok) status = "UP";
    } catch (e) {
      statusCode = "TIMEOUT";
    }

    const latency = Date.now() - start;
    
    // Update total historical stats
    if (!stats[service.name]) stats[service.name] = { total: 0, up: 0 };
    stats[service.name].total += 1;
    if (status === "UP") stats[service.name].up += 1;

    // Update 90-day DAILY history
    if (!history[service.name]) history[service.name] = {};
    if (!history[service.name][today]) history[service.name][today] = { total: 0, up: 0 };
    
    history[service.name][today].total += 1;
    if (status === "UP") history[service.name][today].up += 1;

    // Cleanup: Keep only last 365 days
    const dates = Object.keys(history[service.name]).sort();
    while (dates.length > 365) {
      delete history[service.name][dates.shift()];
    }

    results.push({ 
      name: service.name, 
      url: service.url, 
      status, 
      statusCode, 
      latency,
      uptime: ((stats[service.name].up / stats[service.name].total) * 100).toFixed(2),
      daily: history[service.name]
    });
  }

  // Ensure we have data before saving back to KV
  if (results.length > 0) {
    const timestamp = new Date().toISOString();
    await env.UPTIME_KV.put("RESULTS", JSON.stringify(results));
    await env.UPTIME_KV.put("LAST_CHECK", timestamp);
    await env.UPTIME_KV.put("UPTIME_STATS", JSON.stringify(stats));
    await env.UPTIME_KV.put("UPTIME_HISTORY", JSON.stringify(history));
  }

  // Alert on Telegram if any service is DOWN AND shouldAlert is TRUE
  const downServices = results.filter((r) => r.status === "DOWN");
  if (shouldAlert && downServices.length > 0) {
    await sendTelegramAlert(env, downServices);
  }

  return results;
}

// ——— Telegram Alert ———
async function sendTelegramAlert(env, downServices) {
  const lines = downServices.map(
    (s) => `❌ *${s.name}* (${s.url})\n  Status Code: \`${s.statusCode}\``
  );
  const message = `🚨 *Uptime Alert — Services Down!*\n\n${lines.join("\n\n")}`;

  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    }
  );
}

// ——— HTML Dashboard ———
function renderDashboard(results, lastCheck) {
  const overallUp = results.every((r) => r.status === "UP");
  const formattedTime = lastCheck
    ? new Date(lastCheck).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Never";

  // Compute logical statuses and health scores before rendering
  results.forEach(r => {
    const isUp = r.status === "UP";
    const hasUnstableDay = Object.values(r.daily || {}).some(d => {
      const ratio = d.up / d.total;
      return ratio < 1 && ratio >= 0.95;
    });
    r.computedStatus = !isUp ? "failing" : hasUnstableDay ? "unstable" : "healthy";
    r.healthScore = r.computedStatus === "healthy" ? 2 : (r.computedStatus === "unstable" ? 1 : 0);
  });

  // Default sort by health descending (2 -> 1 -> 0)
  results.sort((a, b) => b.healthScore - a.healthScore);

  const serviceCards = results
    .map((r) => {
      const isUp = r.status === "UP";
      const badgeClass = isUp ? "badge-up" : "badge-down";
      const badgeText = isUp ? "● Healthy" : "● Unhealthy";

      // Compute Today's Availability
      const todayStr = new Date().toISOString().split("T")[0];
      let todayUp = 0;
      let todayTotal = 0;
      if (r.daily && r.daily[todayStr]) {
        todayUp = r.daily[todayStr].up;
        todayTotal = r.daily[todayStr].total;
      }
      let todayAvail = todayTotal > 0 ? ((todayUp / todayTotal) * 100).toFixed(2) : "100.00";
      todayAvail = parseFloat(todayAvail);

      // Generate history bars
      const generateBars = (daysCount) => {
        const bars = [];
        const now = new Date();
        for (let i = daysCount - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split("T")[0];
          const dayData = r.daily ? r.daily[dateStr] : null;

          let barColor = "#585b70";
          let statusText = "No data";
          const isToday = i === 0;

          if (dayData) {
            const ratio = dayData.up / dayData.total;
            if (isToday) {
              barColor = isUp ? "#a6e3a1" : "#f38ba8";
            } else {
              if (ratio === 1) barColor = "#a6e3a1";
              else if (ratio > 0.95) barColor = "#f9e2af";
              else barColor = "#f38ba8";
            }
            statusText = (ratio * 100).toFixed(1) + "% uptime";
          } else if (isToday) {
            barColor = isUp ? "#a6e3a1" : "#f38ba8";
            statusText = "Current: " + (isUp ? "Healthy" : "Incident");
          }

          const pulseColor = isUp ? "#a6e3a1" : "#f38ba8";
          bars.push(
            `<div class="bar${isToday ? " pulse" : ""}" style="background:${barColor};${isToday ? "--pulse-color:" + pulseColor + ";" : ""}" title="${dateStr}: ${statusText}"></div>`
          );
        }
        return bars.join("");
      };

      const bars1w = generateBars(7);
      const bars1m = generateBars(30);
      const bars1y = generateBars(365);

      // Time since last check
      const timeSince = lastCheck
        ? (() => {
            const diff = Math.floor((Date.now() - new Date(lastCheck)) / 1000);
            if (diff < 60) return diff + "s ago";
            if (diff < 3600) return Math.floor(diff / 60) + "m ago";
            return Math.floor(diff / 3600) + "h ago";
          })()
        : "never";

      const safeId = r.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();

      return `
      <div class="card" 
        data-name="${r.name.toLowerCase()}" 
        data-group="${(r.group || 'misc').toLowerCase()}"
        data-status="${r.computedStatus}"
        data-health-score="${r.healthScore}">
        <div class="card-top">
          <div class="card-meta">
            <div class="card-name">${r.name}</div>
            <div class="card-group">${r.group || 'misc'} • ${r.url}</div>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        
        <div class="metrics">
          <div class="metric">
            <span class="metric-value">${todayAvail}%</span>
            <span class="metric-title">Today</span>
          </div>
          <div class="metric">
            <span class="metric-value">${parseFloat(r.uptime)}%</span>
            <span class="metric-title">All-Time</span>
          </div>
        </div>

        <div class="chart-section" style="margin-top: 1rem; border-top: 1px solid #45475a; padding-top: 0.8rem;">
          <div class="chart-head" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-size: 0.75rem; color: #a6adc8; font-weight: 600;">Availability Chart</span>
            <div class="chart-tabs">
              <button type="button" class="tab-btn active" onclick="switchTab(event, '1w', '${safeId}')">1W</button>
              <button type="button" class="tab-btn" onclick="switchTab(event, '1m', '${safeId}')">1M</button>
              <button type="button" class="tab-btn" onclick="switchTab(event, '1y', '${safeId}')">1Y</button>
            </div>
          </div>
          <div class="charts-container" id="charts-${safeId}">
            <div class="chart-view view-1w active">
              <div class="history-grid-1w history-grid">${bars1w}</div>
              <div class="chart-foot"><span>7 days ago</span><span>Today</span></div>
            </div>
            <div class="chart-view view-1m">
              <div class="history-grid-1m history-grid">${bars1m}</div>
              <div class="chart-foot"><span>30 days ago</span><span>Today</span></div>
            </div>
            <div class="chart-view view-1y">
              <div class="history-grid-1y history-grid">${bars1y}</div>
              <div class="chart-foot"><span>365 days ago</span><span>Today</span></div>
            </div>
          </div>
        </div>

        <div class="info-row" style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #a6adc8; margin-top: 0.5rem;">
          <span>Latency: ~${r.latency}ms</span>
          <span>Checked ${timeSince}</span>
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>uptime.lumosdhia.com — Health Dashboard</title>
  <meta name="description" content="Real-time health monitoring for lumosdhia.com services."/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <script>
    function scheduleNextRefresh() {
      var now = new Date();
      var minutes = now.getMinutes();
      var seconds = now.getSeconds();
      var nextCheckMin = Math.ceil((minutes + 0.1) / 5) * 5;
      var delayMs = ((nextCheckMin - minutes) * 60 - seconds + 8) * 1000;
      setTimeout(function() { location.reload(); }, delayMs);
    }
    window.onload = scheduleNextRefresh;

    function filterCards() {
      var q = document.getElementById('search').value.toLowerCase();
      var filter = document.getElementById('filter').value;
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {
        var name = cards[i].dataset.name;
        var status = cards[i].dataset.status;
        var matchQ = name.indexOf(q) !== -1;
        var matchF = filter === 'none'
          || (filter === 'failing' && status === 'failing')
          || (filter === 'unstable' && status === 'unstable');
        cards[i].style.display = (matchQ && matchF) ? '' : 'none';
      }
    }

    var sortDirection = 'desc';

    function toggleSortDir() {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      document.getElementById('sort-dir').innerText = sortDirection === 'asc' ? '↑' : '↓';
      sortCards();
    }

    function sortCards() {
      var sort = document.getElementById('sort').value;
      var grid = document.querySelector('.grid');
      var cards = Array.from(document.querySelectorAll('.card'));

      cards.sort(function(a, b) {
        var valA, valB;
        if (sort === 'name') {
          valA = a.dataset.name;
          valB = b.dataset.name;
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (sort === 'group') {
          valA = a.dataset.group;
          valB = b.dataset.group;
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (sort === 'health') {
          valA = parseInt(a.dataset.healthScore);
          valB = parseInt(b.dataset.healthScore);
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return 0;
      });

      cards.forEach(function(card) {
        grid.appendChild(card);
      });
    }

    function switchTab(e, range, id) {
      if (e) e.preventDefault();
      var container = document.getElementById('charts-' + id);
      if (!container) return;
      var views = container.querySelectorAll('.chart-view');
      views.forEach(v => v.classList.remove('active'));
      var targetView = container.querySelector('.view-' + range);
      if (targetView) targetView.classList.add('active');

      if (e && e.currentTarget) {
        var btns = e.currentTarget.parentElement.querySelectorAll('.tab-btn');
        btns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      }
    }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', sans-serif;
      background: #1e1e2e;
      color: #cdd6f4;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    nav {
      background: #181825;
      border-bottom: 1px solid #313244;
      padding: 0 2rem;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .nav-logo { display: flex; align-items: center; gap: 0.75rem; text-decoration: none; }
    .nav-logo-icon {
      background: #cba6f7;
      color: #1e1e2e;
      font-weight: 800;
      font-size: 0.85rem;
      width: 34px; height: 34px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      letter-spacing: -1px;
    }
    .nav-logo-name { font-weight: 700; font-size: 0.95rem; color: #cdd6f4; line-height: 1.2; }
    .nav-logo-sub  { font-size: 0.68rem; color: #a6adc8; }
    .nav-links { display: flex; gap: 1.5rem; }
    .nav-links a { color: #a6adc8; text-decoration: none; font-size: 0.85rem; transition: color 0.2s; }
    .nav-links a:hover { color: #cdd6f4; }

    main { flex: 1; padding: 2rem; max-width: 1200px; width: 100%; margin: 0 auto; }

    .page-header { margin-bottom: 1.75rem; }
    .page-title { font-size: 1.875rem; font-weight: 700; color: #cdd6f4; margin-bottom: 0.3rem; }
    .page-subtitle { font-size: 0.85rem; color: #a6adc8; }

    .controls { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: center; }

    .search-wrap { position: relative; flex: 1; }
    .search-icon { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: #a6adc8; font-size: 0.8rem; pointer-events: none; }
    .search-wrap input {
      width: 100%;
      background: #181825;
      border: 1px solid #313244;
      border-radius: 6px;
      padding: 0.55rem 0.75rem 0.55rem 2.2rem;
      color: #cdd6f4;
      font-size: 0.875rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-wrap input:focus { border-color: #cba6f7; }
    .search-wrap input::placeholder { color: #7f849c; }

    .control-label { font-size: 0.8rem; color: #a6adc8; white-space: nowrap; }

    select {
      background: #181825;
      border: 1px solid #313244;
      border-radius: 6px;
      padding: 0.55rem 0.75rem;
      color: #cdd6f4;
      font-size: 0.85rem;
      font-family: inherit;
      outline: none;
      cursor: pointer;
    }

    .sort-dir-btn { background: #181825; border: 1px solid #313244; border-radius: 6px; color: #a6adc8; cursor: pointer; padding: 0 0.6rem; font-size: 0.85rem; transition: border-color 0.2s, color 0.2s; }
    .sort-dir-btn:hover { border-color: #cba6f7; color: #cdd6f4; }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }

    .card {
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #585b70; }

    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
    .card-name { font-weight: 600; font-size: 0.95rem; color: #cdd6f4; }
    .card-group { font-size: 0.72rem; color: #a6adc8; margin-top: 2px; }

    .badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .badge-up   { background: rgba(166,227,161,0.12);  color: #a6e3a1; border: 1px solid rgba(166,227,161,0.3); }
    .badge-down { background: rgba(243,139,168,0.12);  color: #f38ba8; border: 1px solid rgba(243,139,168,0.3); }

    /* Card Metrics */
    .metrics { display: flex; gap: 1.5rem; margin-top: 0.8rem; }
    .metric { display: flex; flex-direction: column; }
    .metric-value { font-size: 1.2rem; font-weight: 700; color: #cdd6f4; }
    .metric-title { font-size: 0.65rem; font-weight: 600; color: #bac2de; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Tabs */
    .chart-tabs { display: flex; gap: 0.25rem; background: #11111b; padding: 2px; border-radius: 6px; border: 1px solid #45475a; }
    .tab-btn { background: transparent; border: none; color: #a6adc8; font-size: 0.65rem; font-weight: 600; cursor: pointer; padding: 2px 8px; border-radius: 4px; transition: 0.2s; }
    .tab-btn:hover { color: #cdd6f4; }
    .tab-btn.active { background: #45475a; color: #cdd6f4; }

    /* Charts */
    .chart-view { display: none; flex-direction: column; gap: 0.5rem; }
    .chart-view.active { display: flex; }
    .history-grid { height: 30px; display: flex; align-items: stretch; width: 100%; }
    .history-grid-1w { gap: 4px; }
    .history-grid-1m { gap: 2px; }
    .history-grid-1y { gap: 0; }
    .bar { border-radius: 2px; flex: 1; cursor: default; transition: opacity 0.2s; min-width: 0.5px; }
    .bar:hover { opacity: 0.8; }
    .history-grid-1y .bar { border-radius: 0; }
    .chart-foot { display: flex; justify-content: space-between; font-size: 0.65rem; color: #a6adc8; }

    .pulse { animation: glow 2s ease-in-out infinite; }
    @keyframes glow {
      0%   { opacity: 1;   box-shadow: 0 0 2px var(--pulse-color); }
      50%  { opacity: 0.7; box-shadow: 0 0 10px var(--pulse-color); }
      100% { opacity: 1;   box-shadow: 0 0 2px var(--pulse-color); }
    }

    /* removed card-foot */

    footer {
      border-top: 1px solid #45475a;
      padding: 0.875rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      color: #a6adc8;
    }
    .footer-left { display: flex; align-items: center; gap: 0.5rem; }
    .footer-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: ${overallUp ? "#a6e3a1" : "#f38ba8"};
      box-shadow: 0 0 6px ${overallUp ? "#a6e3a1" : "#f38ba8"};
    }
    footer a { color: #cba6f7; text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <nav>
    <a class="nav-logo" href="/">
      <div class="nav-logo-icon">MD</div>
      <div>
        <div class="nav-logo-name">LumosDhia</div>
        <div class="nav-logo-sub">Uptime Monitor</div>
      </div>
    </a>
    <div class="nav-links">
      <a href="https://lumosdhia.com" target="_blank">Contact Me ↗</a>
    </div>
  </nav>

  <main>
    <div class="page-header">
      <h1 class="page-title">Health Dashboard</h1>
      <p class="page-subtitle">Monitor the health of your endpoints in real-time · Last checked: ${formattedTime}</p>
    </div>

    <div class="controls">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input id="search" type="text" placeholder="Search endpoints..." oninput="filterCards()"/>
      </div>
      <span class="control-label">Filter by:</span>
      <select id="filter" onchange="filterCards()">
        <option value="none">None</option>
        <option value="failing">Failing</option>
        <option value="unstable">Unstable</option>
      </select>
      
      <span class="control-label" style="margin-left: 0.5rem;">Sort by:</span>
      <div style="display: flex; gap: 0.25rem;">
        <select id="sort" onchange="sortCards()">
          <option value="health" selected>Health</option>
          <option value="name">Name</option>
          <option value="group">Group</option>
        </select>
        <button id="sort-dir" class="sort-dir-btn" onclick="toggleSortDir()" title="Toggle Sort Direction">↓</button>
      </div>
    </div>

    <div class="grid">
      ${serviceCards}
    </div>
  </main>

  <footer>
    <div class="footer-left">
      <div class="footer-dot"></div>
      <span>${overallUp ? "All systems operational" : "Incident detected"}</span>
    </div>
    <span>Powered by <a href="https://workers.cloudflare.com/">Cloudflare Workers</a></span>
  </footer>
</body>
</html>`;
}

// ——— Worker Entry Point ———
export default {
  // Called by the Cron Trigger every 5 minutes
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env, true)); // TRUE = Send alerts
  },

  // Called when a browser visits uptime.lumosdhia.com
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // JSON API endpoint for programmatic access
    if (url.pathname === "/api/status") {
      const results = JSON.parse(await env.UPTIME_KV.get("RESULTS") || "[]");
      const lastCheck = await env.UPTIME_KV.get("LAST_CHECK");
      return new Response(JSON.stringify({ results, lastCheck }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // For local testing: run the check immediately and show the result
    if (url.pathname === "/test") {
      await runChecks(env, false); // FALSE = Do NOT send alerts on refresh
    }

    // Serve the HTML dashboard
    const results = JSON.parse(await env.UPTIME_KV.get("RESULTS") || "[]");
    const lastCheck = await env.UPTIME_KV.get("LAST_CHECK");
    return new Response(renderDashboard(results, lastCheck), {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};
