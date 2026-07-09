const WATCHLIST = ["AAPL", "MSFT", "NVDA", "SAP.DE", "^GDAXI", "BTC-USD"];
const REFRESH_MS = 60000;

let selectedSymbol = "AAPL";
let selectedRange = "1M";
let chartInstance = null;

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

function updateClock() {
  const el = document.getElementById("clock");
  el.textContent = new Date().toLocaleTimeString("de-DE");
}

async function loadWatchlist() {
  try {
    const res = await fetch("/api/watchlist");
    const data = await res.json();
    const tbody = document.getElementById("watchlist-body");
    tbody.innerHTML = "";
    data.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.symbol === selectedSymbol) tr.classList.add("selected");
      tr.addEventListener("click", () => selectSymbol(row.symbol));

      const cls = changeClass(row.change);
      tr.innerHTML = `
        <td>${row.symbol}</td>
        <td>${fmtPrice(row.price)}</td>
        <td class="${cls}">${fmtChange(row.change)}</td>
        <td class="${cls}">${fmtPct(row.change_pct)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("watchlist load failed", err);
  }
}

async function loadChart() {
  const titleEl = document.getElementById("chart-title");
  titleEl.textContent = `CHART: ${selectedSymbol}`;
  try {
    const res = await fetch(`/api/chart/${encodeURIComponent(selectedSymbol)}?range=${selectedRange}`);
    if (!res.ok) throw new Error("chart fetch failed");
    const data = await res.json();

    const ctx = document.getElementById("price-chart").getContext("2d");
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: data.symbol,
            data: data.prices,
            borderColor: "#ffb000",
            backgroundColor: "rgba(255, 176, 0, 0.08)",
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#b87800", maxTicksLimit: 8 },
            grid: { color: "#1a1a1a" },
          },
          y: {
            ticks: { color: "#b87800" },
            grid: { color: "#1a1a1a" },
          },
        },
      },
    });
  } catch (err) {
    console.error("chart load failed", err);
  }
}

async function loadMetrics() {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(selectedSymbol)}`);
    if (!res.ok) throw new Error("quote fetch failed");
    const data = await res.json();
    document.getElementById("m-pe").textContent = data.pe_ratio ? data.pe_ratio.toFixed(2) : "--";
    document.getElementById("m-cap").textContent = fmtMarketCap(data.market_cap);
    document.getElementById("m-high").textContent = fmtPrice(data.week52_high);
    document.getElementById("m-low").textContent = fmtPrice(data.week52_low);
  } catch (err) {
    console.error("metrics load failed", err);
    document.getElementById("m-pe").textContent = "--";
    document.getElementById("m-cap").textContent = "--";
    document.getElementById("m-high").textContent = "--";
    document.getElementById("m-low").textContent = "--";
  }
}

async function loadNews() {
  const container = document.getElementById("news-body");
  container.innerHTML = `<div class="news-empty">Lade News...</div>`;
  try {
    const res = await fetch(`/api/news/${encodeURIComponent(selectedSymbol)}`);
    const data = await res.json();
    if (!data.length) {
      container.innerHTML = `<div class="news-empty">Keine News verfügbar.</div>`;
      return;
    }
    container.innerHTML = "";
    data.forEach((item) => {
      const div = document.createElement("div");
      div.className = "news-item";
      const published = item.published ? new Date(item.published).toLocaleString("de-DE") : "";
      div.innerHTML = `
        <a href="${item.link || "#"}" target="_blank" rel="noopener noreferrer">${item.title}</a>
        <div class="news-meta">${item.publisher || ""} ${published ? "· " + published : ""}</div>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("news load failed", err);
    container.innerHTML = `<div class="news-empty">Fehler beim Laden der News.</div>`;
  }
}

function refreshDetail() {
  loadChart();
  loadMetrics();
  loadNews();
}

function selectSymbol(symbol) {
  selectedSymbol = symbol;
  refreshDetail();
  loadWatchlist();
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
  updateClock();
  setInterval(updateClock, 1000);

  loadWatchlist();
  refreshDetail();

  setInterval(() => {
    loadWatchlist();
    refreshDetail();
  }, REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);
