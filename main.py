import time
from datetime import datetime

import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="Seraphin Terminal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WATCHLIST = ["AAPL", "MSFT", "NVDA", "SAP.DE", "^GDAXI", "BTC-USD"]

PERIOD_MAP = {
    "1M": ("1mo", "1d"),
    "6M": ("6mo", "1d"),
    "1J": ("1y", "1wk"),
}

_cache: dict[str, tuple[float, object]] = {}


def cached(key: str, ttl: int, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value


def _safe_float(value):
    if value is None:
        return None
    try:
        f = float(value)
        if f != f:  # NaN check
            return None
        return f
    except (TypeError, ValueError):
        return None


@app.get("/api/watchlist")
def get_watchlist():
    result = []
    for symbol in WATCHLIST:
        try:
            hist = cached(f"hist5d:{symbol}", 30, lambda s=symbol: yf.Ticker(s).history(period="5d"))
            if hist.empty:
                result.append({"symbol": symbol, "error": "no data"})
                continue
            last_close = _safe_float(hist["Close"].iloc[-1])
            prev_close = _safe_float(hist["Close"].iloc[-2]) if len(hist) > 1 else None
            change = None
            change_pct = None
            if last_close is not None and prev_close:
                change = last_close - prev_close
                change_pct = (change / prev_close) * 100
            result.append(
                {
                    "symbol": symbol,
                    "price": last_close,
                    "change": change,
                    "change_pct": change_pct,
                }
            )
        except Exception as exc:
            result.append({"symbol": symbol, "error": str(exc)})
    return result


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, range: str = "1M"):
    if range not in PERIOD_MAP:
        raise HTTPException(status_code=400, detail="invalid range")
    period, interval = PERIOD_MAP[range]
    try:
        hist = cached(
            f"chart:{symbol}:{range}",
            60,
            lambda: yf.Ticker(symbol).history(period=period, interval=interval),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if hist.empty:
        raise HTTPException(status_code=404, detail="no data for symbol")
    return {
        "symbol": symbol,
        "range": range,
        "labels": [idx.strftime("%Y-%m-%d") for idx in hist.index],
        "prices": [_safe_float(v) for v in hist["Close"].tolist()],
    }


@app.get("/api/quote/{symbol}")
def get_quote(symbol: str):
    try:
        info = cached(f"info:{symbol}", 300, lambda: yf.Ticker(symbol).info)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if not info:
        raise HTTPException(status_code=404, detail="no data for symbol")
    return {
        "symbol": symbol,
        "pe_ratio": _safe_float(info.get("trailingPE")),
        "market_cap": _safe_float(info.get("marketCap")),
        "week52_high": _safe_float(info.get("fiftyTwoWeekHigh")),
        "week52_low": _safe_float(info.get("fiftyTwoWeekLow")),
        "name": info.get("shortName") or info.get("longName") or symbol,
        "currency": info.get("currency"),
    }


@app.get("/api/news/{symbol}")
def get_news(symbol: str):
    try:
        news = cached(f"news:{symbol}", 120, lambda: yf.Ticker(symbol).news or [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = []
    for entry in news[:10]:
        content = entry.get("content", entry)
        title = content.get("title") or entry.get("title")
        if not title:
            continue
        link = (
            (content.get("canonicalUrl") or {}).get("url")
            or (content.get("clickThroughUrl") or {}).get("url")
            or entry.get("link")
        )
        publisher = (content.get("provider") or {}).get("displayName") or entry.get(
            "publisher"
        )
        pub_date = content.get("pubDate")
        if pub_date:
            published = pub_date
        else:
            ts = entry.get("providerPublishTime")
            published = (
                datetime.utcfromtimestamp(ts).isoformat() if ts else None
            )
        items.append(
            {
                "title": title,
                "publisher": publisher,
                "link": link,
                "published": published,
            }
        )
    return items


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
