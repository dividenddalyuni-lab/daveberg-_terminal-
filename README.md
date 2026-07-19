# Seraphin Terminal

Ein Bloomberg-Terminal-inspiriertes Finanz-Dashboard: schwarzer Hintergrund, amber Monospace-Schrift, Kachel-Layout. Backend liefert Kursdaten über [yfinance](https://pypi.org/project/yfinance/), Frontend ist statisches HTML/JS mit Chart.js — kein Framework.

## Features

- **Watchlist** mit Live-Kursen und Tagesveränderung (grün/rot): AAPL, MSFT, NVDA, SAP.DE, ^GDAXI, BTC-USD
- **Kurschart** für den ausgewählten Ticker, umschaltbar zwischen 1M / 6M / 1J
- **Kennzahlen-Panel**: KGV, Market Cap, 52-Wochen-Hoch/-Tief
- **News-Feed** zum ausgewählten Ticker
- **Crypto-News (Reuters)**: eigene Kachel auf der Hauptseite, unabhängig vom gewählten Ticker — zeigt immer die neuesten Reuters-Meldungen zum Krypto-Markt
- **Makro-Panel**: Inflation (CPI) Deutschland & USA, EZB- und Fed-Leitzins, EUR/USD, 10J Bund- und Treasury-Rendite — Daten über [OpenBB](https://pypi.org/project/openbb/), stündlich gecacht. Quellen ohne Daten/API-Key zeigen `N/A` statt abzustürzen.
- **KI-Analyst**: Chat-Panel unten rechts, das die Anthropic API (`claude-sonnet-4-6`) mit aktuellem Kontext (Watchlist, Kennzahlen, News des gewählten Tickers, Makrodaten) füttert. Antwortet auf Deutsch, kurz und sachlich — gibt grundsätzlich keine Kauf-/Verkaufsempfehlungen.
- **Auto-Refresh** aller Daten alle 60 Sekunden (Makrodaten stündlich)
- Header mit Titel und Live-Uhrzeit

## Setup

```bash
pip install -r requirements.txt
```

Für den KI-Analyst wird ein Anthropic API-Key benötigt:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Ohne gesetzten Key liefert `/api/analyst` einen sauberen 503-Fehler statt eines Absturzes; das restliche Terminal funktioniert unverändert.

## Start

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Danach im Browser öffnen: [http://localhost:8000](http://localhost:8000)

## Projektstruktur

```
main.py            FastAPI-Backend (REST-Endpunkte, liefert das Frontend aus)
static/index.html  Seitenstruktur
static/style.css    Bloomberg-Style (schwarz/amber, Kacheln)
static/app.js       Frontend-Logik (Fetch, Chart.js, Auto-Refresh)
requirements.txt    Python-Abhängigkeiten
```

## API-Endpunkte

| Endpunkt | Beschreibung |
| --- | --- |
| `GET /api/watchlist` | Kurse + Tagesveränderung für die Watchlist |
| `GET /api/chart/{symbol}?range=1M\|6M\|1J` | Historische Schlusskurse |
| `GET /api/quote/{symbol}` | KGV, Market Cap, 52W High/Low |
| `GET /api/news/{symbol}` | Aktuelle News zum Ticker |
| `GET /api/crypto-news` | Neueste Reuters-News zum Krypto-Markt (Hauptseite, tickerunabhängig) |
| `GET /api/macro` | Makrodaten (CPI, Leitzinsen, EUR/USD, Renditen), 1h gecacht |
| `POST /api/analyst` | KI-Analyst-Chat (`{symbol, messages}` → `{reply}`) |
