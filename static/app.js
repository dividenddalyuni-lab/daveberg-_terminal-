const WATCHLIST = ["AAPL", "MSFT", "NVDA", "SAP.DE", "^GDAXI", "BTC-USD"];
const REFRESH_MS = 60000;
const FUNCTIONS = ["W", "GP", "DES", "CN", "N", "ECO", "ASK"];

let selectedSymbol = "AAPL";
let selectedRange = "1M";
let chartInstance = null;
let analystHistory = [];
let analystBusy = false;
let watchlistData = [];
let lastPrices = {};

function fmtPrice(v) {
  if (v === null || v === undefined) return "--";
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(v) {
  if (v === null || v === undefined) return "--";
  const sign = v > 0 ? "+" : "";
  return sign + v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) {
  if (v === null || v === undefined) return "--";
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(2) + "%";
}

function fmtMarketCap(v) {
  if (v === null || v === undefined) return "--";
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  return v.toLocaleString("de-DE");
}

function changeClass(v) {
  if (v === null || v === undefined) return "neutral";
  if (v > 0) return "positive";
  if (v < 0) return "negative";
  return "neutral";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Bloomberg-artige Darstellung: "AAPL US Equity", "SAP GY Equity", "GDAXI Index", "BTC-USD Curncy"
function describeSymbol(symbol) {
  if (symbol.startsWith("^")) return { ticker: symbol.slice(1), type: "Index" };
  if (symbol.endsWith("-USD") || symbol.endsWith("=X")) return { ticker: symbol, type: "Curncy" };
  if (symbol.endsWith(".DE")) return { ticker: symbol.slice(0, -3) + " GY", type: "Equity" };
  if (symbol.includes(".")) return { ticker: symbol.split(".")[0], type: "Equity" };
  return { ticker: symbol + " US", type: "Equity" };
}

function nowTime() {
  return new Date().toLocaleTimeString("de-DE");
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString("de-DE");
  document.getElementById("clock-date").textContent = now.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function markUpdated() {
  document.getElementById("last-update").textContent = nowTime();
}

// ---------- Security-Header ----------

function renderSecurityHeader(price, change, changePct) {
  const desc = describeSymbol(selectedSymbol);
  document.getElementById("sec-ticker").textContent = desc.ticker;
  document.getElementById("sec-type").textContent = desc.type;

  const cls = changeClass(change);
  const arrow = document.getElementById("sec-arrow");
  arrow.textContent = change > 0 ? "▲" : change < 0 ? "▼" : "";
  arrow.className = `sec-arrow ${cls}`;
  document.getElementById("sec-price").textContent = fmtPrice(price);
  const chg = document.getElementById("sec-chg");
  chg.textContent = fmtChange(change);
  chg.className = `sec-chg ${cls}`;
  const pct = document.getElementById("sec-pct");
  pct.textContent = fmtPct(changePct);
  pct.className = `sec-chg ${cls}`;
}

function updateSecurityHeaderFromWatchlist() {
  const row = watchlistData.find((r) => r.symbol === selectedSymbol && !r.error);
  if (row) renderSecurityHeader(row.price, row.change, row.change_pct);
  return Boolean(row);
}

// ---------- Watchlist + Laufband ----------

async function loadWatchlist() {
  try {
    const res = await fetch("/api/watchlist");
    const data = await res.json();
    watchlistData = data;
    const tbody = document.getElementById("watchlist-body");
    tbody.innerHTML = "";
    data.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.symbol === selectedSymbol) tr.classList.add("selected");
      tr.addEventListener("click", () => selectSymbol(row.symbol));

      const desc = describeSymbol(row.symbol);
      const cls = changeClass(row.change);
      tr.innerHTML = `
        <td><span class="wl-sym">${escapeHtml(desc.ticker)}</span><span class="wl-type">${desc.type}</span></td>
        <td class="r wl-price">${fmtPrice(row.price)}</td>
        <td class="r ${cls}">${fmtChange(row.change)}</td>
        <td class="r ${cls}">${fmtPct(row.change_pct)}</td>
      `;

      const prev = lastPrices[row.symbol];
      if (prev !== undefined && row.price !== null && row.price !== undefined && row.price !== prev) {
        tr.children[1].classList.add(row.price > prev ? "flash-up" : "flash-down");
      }
      if (row.price !== null && row.price !== undefined) lastPrices[row.symbol] = row.price;

      tbody.appendChild(tr);
    });
    renderTape(data);
    updateSecurityHeaderFromWatchlist();
    markUpdated();
  } catch (err) {
    console.error("watchlist load failed", err);
  }
}

function renderTape(data) {
  const items = data
    .filter((r) => !r.error)
    .map((r) => {
      const cls = changeClass(r.change);
      const arrow = r.change > 0 ? "▲" : r.change < 0 ? "▼" : "";
      return `<span class="tape-item"><span class="tape-sym">${escapeHtml(describeSymbol(r.symbol).ticker)}</span><span class="tape-px">${fmtPrice(r.price)}</span><span class="${cls}">${arrow} ${fmtPct(r.change_pct)}</span></span>`;
    })
    .join("");
  // Inhalt doppelt, damit die Animation (-50%) nahtlos läuft
  document.getElementById("tape-track").innerHTML = items + items;
}

// ---------- Chart (GP) ----------

// Zeichnet den letzten Kurs als farbiges Kästchen an der rechten Achse
const lastPriceTag = {
  id: "lastPriceTag",
  afterDraw(chart) {
    const values = chart.data.datasets[0]?.data || [];
    const last = values[values.length - 1];
    if (last === null || last === undefined) return;
    const first = values.find((v) => v !== null && v !== undefined);
    const color = last >= first ? "#2be37a" : "#ff433d";
    const y = chart.scales.y.getPixelForValue(last);
    const { ctx, chartArea } = chart;
    const label = fmtPrice(last);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "700 11px 'Roboto Mono', Consolas, monospace";
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(chartArea.right + 1, y - 8, w, 16);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chartArea.right + 6, y);
    ctx.restore();
  },
};

async function loadChart() {
  const desc = describeSymbol(selectedSymbol);
  document.getElementById("chart-title").textContent = `${desc.ticker} ${desc.type} · Kursverlauf`;
  try {
    const res = await fetch(`/api/chart/${encodeURIComponent(selectedSymbol)}?range=${selectedRange}`);
    if (!res.ok) throw new Error("chart fetch failed");
    const data = await res.json();

    // Symbol nicht in der Watchlist: Header aus den letzten beiden Schlusskursen
    if (!updateSecurityHeaderFromWatchlist()) {
      const p = data.prices.filter((v) => v !== null && v !== undefined);
      if (p.length >= 2) {
        const last = p[p.length - 1];
        const prev = p[p.length - 2];
        renderSecurityHeader(last, last - prev, ((last - prev) / prev) * 100);
      }
    }

    const canvas = document.getElementById("price-chart");
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 400);
    gradient.addColorStop(0, "rgba(0, 104, 255, 0.35)");
    gradient.addColorStop(1, "rgba(0, 104, 255, 0)");

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: data.symbol,
            data: data.prices,
            borderColor: "#f0f0f0",
            backgroundColor: gradient,
            borderWidth: 1.25,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHoverBackgroundColor: "#ffa028",
            fill: true,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1b1b1b",
            borderColor: "#ffa028",
            borderWidth: 1,
            cornerRadius: 0,
            titleColor: "#ffa028",
            bodyColor: "#f0f0f0",
            titleFont: { family: "Roboto Mono", size: 11 },
            bodyFont: { family: "Roboto Mono", size: 11 },
            displayColors: false,
            callbacks: { label: (c) => fmtPrice(c.parsed.y) },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#ffa028",
              maxTicksLimit: 8,
              maxRotation: 0,
              font: { family: "Roboto Mono", size: 10 },
              // "2026-09-08" -> "08.09."
              callback(v) {
                const [, m, d] = String(this.getLabelForValue(v)).split("-");
                return d && m ? `${d}.${m}.` : this.getLabelForValue(v);
              },
            },
            grid: { color: "#1e1e1e", tickColor: "#333" },
            border: { color: "#333" },
          },
          y: {
            position: "right",
            ticks: {
              color: "#ffa028",
              font: { family: "Roboto Mono", size: 10 },
              callback: (v) => v.toLocaleString("de-DE"),
            },
            grid: { color: "#1e1e1e", tickColor: "#333" },
            border: { color: "#333", dash: [2, 3] },
            afterFit: (scale) => { scale.width = Math.max(scale.width, 70); },
          },
        },
      },
      plugins: [lastPriceTag],
    });
  } catch (err) {
    console.error("chart load failed", err);
  }
}

// ---------- DES ----------

async function loadMetrics() {
  const ids = ["m-pe", "m-cap", "m-high", "m-low", "m-ccy"];
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(selectedSymbol)}`);
    if (!res.ok) throw new Error("quote fetch failed");
    const data = await res.json();
    document.getElementById("des-name").textContent = data.name || selectedSymbol;
    document.getElementById("sec-name").textContent = data.name || "";
    document.getElementById("sec-ccy").textContent = data.currency || "";
    document.getElementById("m-pe").textContent = data.pe_ratio ? data.pe_ratio.toFixed(2) : "--";
    document.getElementById("m-cap").textContent = fmtMarketCap(data.market_cap);
    document.getElementById("m-high").textContent = fmtPrice(data.week52_high);
    document.getElementById("m-low").textContent = fmtPrice(data.week52_low);
    document.getElementById("m-ccy").textContent = data.currency || "--";
  } catch (err) {
    console.error("metrics load failed", err);
    ids.forEach((id) => (document.getElementById(id).textContent = "--"));
  }
}

// ---------- CN ----------

function fmtNewsTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

async function loadNews() {
  const container = document.getElementById("news-body");
  document.getElementById("news-symbol").textContent = describeSymbol(selectedSymbol).ticker;
  container.innerHTML = `<div class="empty">Lade News...</div>`;
  try {
    const res = await fetch(`/api/news/${encodeURIComponent(selectedSymbol)}`);
    const data = await res.json();
    if (!data.length) {
      container.innerHTML = `<div class="empty">Keine News verfügbar.</div>`;
      return;
    }
    container.innerHTML = "";
    data.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "news-item";
      div.innerHTML = `
        <span class="news-num">${i + 1})</span>
        <a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>
        <span class="news-src">${escapeHtml(item.publisher || "")}</span>
        <span class="news-time">${fmtNewsTime(item.published)}</span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("news load failed", err);
    container.innerHTML = `<div class="empty">Fehler beim Laden der News.</div>`;
  }
}

// ---------- ECO ----------

function setMacro(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle("na", text === "N/A");
}

function fmtMacroPct(v) {
  if (v === null || v === undefined) return "N/A";
  return v.toFixed(2) + "%";
}

function fmtMacroPrice(v, decimals) {
  if (v === null || v === undefined) return "N/A";
  return v.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function loadMacro() {
  try {
    const res = await fetch("/api/macro");
    if (!res.ok) throw new Error("macro fetch failed");
    const data = await res.json();
    setMacro("mac-cpi-de", fmtMacroPct(data.cpi_de));
    setMacro("mac-cpi-us", fmtMacroPct(data.cpi_us));
    setMacro("mac-ecb", fmtMacroPct(data.ecb_rate));
    setMacro("mac-fed", fmtMacroPct(data.fed_rate));
    setMacro("mac-eurusd", fmtMacroPrice(data.eur_usd, 4));
    setMacro("mac-bund", fmtMacroPct(data.bund_10y));
    setMacro("mac-treasury", fmtMacroPct(data.treasury_10y));
  } catch (err) {
    console.error("macro load failed", err);
    ["mac-cpi-de", "mac-cpi-us", "mac-ecb", "mac-fed", "mac-eurusd", "mac-bund", "mac-treasury"].forEach((id) =>
      setMacro(id, "N/A")
    );
  }
}

// ---------- ASK ----------

function renderAnalystMessage(role, text) {
  const container = document.getElementById("analyst-messages");
  const empty = container.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `analyst-msg ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendAnalystMessage(question) {
  if (analystBusy || !question.trim()) return;
  analystBusy = true;
  const input = document.getElementById("analyst-input");
  input.disabled = true;

  renderAnalystMessage("user", question);
  const pending = renderAnalystMessage("pending", "Analysiere...");
  analystHistory.push({ role: "user", content: question });

  try {
    const res = await fetch("/api/analyst", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, messages: analystHistory }),
    });
    const data = await res.json();
    pending.remove();
    if (!res.ok) {
      renderAnalystMessage("error", data.detail || "Fehler beim Abrufen der Analyse.");
      analystHistory.pop();
    } else {
      renderAnalystMessage("assistant", data.reply);
      analystHistory.push({ role: "assistant", content: data.reply });
    }
  } catch (err) {
    console.error("analyst request failed", err);
    pending.remove();
    renderAnalystMessage("error", "Verbindung zum Analyst fehlgeschlagen.");
    analystHistory.pop();
  } finally {
    analystBusy = false;
    input.disabled = false;
    input.focus();
  }
}

function setupAnalystInput() {
  const input = document.getElementById("analyst-input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const question = input.value;
      input.value = "";
      sendAnalystMessage(question);
    }
  });
}

// ---------- Kommandozeile ----------

function focusPanel(fn) {
  const key = fn === "N" ? "CN" : fn;
  const panel = document.querySelector(`.panel[data-fn="${key}"]`);
  if (!panel) return;
  document.querySelectorAll(".panel.focused").forEach((p) => p.classList.remove("focused"));
  panel.classList.add("focused");
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setTimeout(() => panel.classList.remove("focused"), 1500);
  if (key === "ASK") document.getElementById("analyst-input").focus();
}

// Akzeptiert: "NVDA", "GP", "NVDA GP", "SAP.DE DES", "AAPL US EQUITY GP"
function runCommand(raw) {
  const tokens = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return;

  let fn = null;
  if (FUNCTIONS.includes(tokens[tokens.length - 1])) fn = tokens.pop();
  const ignore = ["US", "GY", "EQUITY", "INDEX", "CURNCY"];
  const symbolToken = tokens.find((t) => !ignore.includes(t));

  if (symbolToken) {
    const match = WATCHLIST.find((s) => {
      const d = describeSymbol(s);
      return s === symbolToken || d.ticker.split(" ")[0] === symbolToken;
    });
    selectSymbol(match || symbolToken);
  }
  if (fn) focusPanel(fn);
}

function setupCommandLine() {
  const form = document.getElementById("cmd-form");
  const input = document.getElementById("cmd-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runCommand(input.value);
    input.value = "";
  });

  // Wie am echten Terminal: Tippen ohne Fokus landet in der Kommandozeile
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      if (e.key === "Escape") active.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1 && /[\w^.\-]/.test(e.key)) input.focus();
  });

  document.querySelectorAll(".fn-btn").forEach((btn) => {
    btn.addEventListener("click", () => focusPanel(btn.dataset.fn));
  });
}

// ---------- Steuerung ----------

function refreshDetail() {
  loadChart();
  loadMetrics();
  loadNews();
}

function selectSymbol(symbol) {
  selectedSymbol = symbol;
  document.getElementById("analyst-symbol-tag").textContent = describeSymbol(symbol).ticker;
  const hint = document.getElementById("analyst-hint-symbol");
  if (hint) hint.textContent = symbol;
  document.getElementById("sec-name").textContent = "";
  document.getElementById("sec-ccy").textContent = "";
  renderSecurityHeader(null, null, null);
  updateSecurityHeaderFromWatchlist();
  document.querySelectorAll("#watchlist-body tr").forEach((tr, i) => {
    tr.classList.toggle("selected", watchlistData[i]?.symbol === symbol);
  });
  refreshDetail();
}

function setupRangeButtons() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRange = btn.dataset.range;
      loadChart();
    });
  });
}

function init() {
  setupRangeButtons();
  setupAnalystInput();
  setupCommandLine();
  updateClock();
  setInterval(updateClock, 1000);

  document.getElementById("analyst-symbol-tag").textContent = describeSymbol(selectedSymbol).ticker;
  const hint = document.getElementById("analyst-hint-symbol");
  if (hint) hint.textContent = selectedSymbol;
  renderSecurityHeader(null, null, null);

  loadWatchlist();
  refreshDetail();
  loadMacro();

  setInterval(() => {
    loadWatchlist();
    refreshDetail();
  }, REFRESH_MS);

  setInterval(loadMacro, 3600000);
}

document.addEventListener("DOMContentLoaded", init);
