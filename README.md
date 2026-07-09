# Seraphin Terminal

Ein Bloomberg-Terminal-inspiriertes Finanz-Dashboard: schwarzer Hintergrund, amber Monospace-Schrift, Kachel-Layout. Backend liefert Kursdaten über [yfinance](https://pypi.org/project/yfinance/), Frontend ist statisches HTML/JS mit Chart.js — kein Framework.

## Features

- **Watchlist** mit Live-Kursen und Tagesveränderung (grün/rot): AAPL, MSFT, NVDA, SAP.DE, ^GDAXI, BTC-USD
- **Kurschart** für den ausgewählten Ticker, umschaltbar zwischen 1M / 6M / 1J
- **Kennzahlen-Panel**: KGV, Market Cap, 52-Wochen-Hoch/-Tief
- **News-Feed** zum ausgewählten Ticker
- **Auto-Refresh** aller Daten alle 60 Sekunden
- Header mit Titel und Live-Uhrzeit

## Setup

```bash
pip install -r requirements.txt
```

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
