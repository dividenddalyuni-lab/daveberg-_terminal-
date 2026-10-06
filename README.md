# Seraphin Terminal

Ein Finanz-Dashboard im Look des Bloomberg Terminals: Kommandozeile mit GO-Key, Security-Header, dichte Panels mit Funktions-Mnemonics (W, GP, DES, CN, ECO, ASK), Ticker-Laufband und Statuszeile. Backend liefert Kursdaten über [yfinance](https://pypi.org/project/yfinance/), Frontend ist statisches HTML/JS mit Chart.js — kein Framework.

## Features

- **Watchlist** mit Live-Kursen und Tagesveränderung (grün/rot): AAPL, MSFT, NVDA, SAP.DE, ^GDAXI, BTC-USD
- **Kurschart** für den ausgewählten Ticker, umschaltbar zwischen 1M / 6M / 1J
- **Kennzahlen-Panel**: KGV, Market Cap, 52-Wochen-Hoch/-Tief
- **News-Feed** zum ausgewählten Ticker
- **Makro-Panel**: Inflation (CPI) Deutschland & USA, EZB- und Fed-Leitzins, EUR/USD, 10J Bund- und Treasury-Rendite — Daten über [OpenBB](https://pypi.org/project/openbb/), stündlich gecacht. Quellen ohne Daten/API-Key zeigen `N/A` statt abzustürzen.
- **KI-Analyst**: Chat-Panel unten rechts, das die Anthropic API (`claude-sonnet-4-6`) mit aktuellem Kontext (Watchlist, Kennzahlen, News des gewählten Tickers, Makrodaten) füttert. Antwortet auf Deutsch, kurz und sachlich — gibt grundsätzlich keine Kauf-/Verkaufsempfehlungen.
- **Auto-Refresh** aller Daten alle 60 Sekunden (Makrodaten stündlich)
- **Kommandozeile** wie am Terminal: einfach lostippen, z. B. `NVDA` + Enter, `GP`, `SAP.DE DES` oder `MSFT CN` — Ticker wechseln und/oder Panel ansteuern
- Header mit Live-Uhrzeit, Laufband mit Watchlist-Kursen, Kurs-Flash bei Preisänderung

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
static/style.css    Bloomberg-Terminal-Style (schwarz/orange, Panels, Laufband)
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
| `GET /api/macro` | Makrodaten (CPI, Leitzinsen, EUR/USD, Renditen), 1h gecacht |
| `POST /api/analyst` | KI-Analyst-Chat (`{symbol, messages}` → `{reply}`) |
