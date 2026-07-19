import os
import time
from datetime import datetime, timezone

import anthropic
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

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


def _safe_openbb_call(fn):
    """Run an OpenBB call and swallow any failure (missing API key, no data,
    network issue, import error) so a single bad source never crashes the
    /api/macro response — the caller gets None and renders it as N/A."""
    try:
        return fn()
    except Exception:
        return None


def _fetch_cpi_yoy(country: str):
    def call():
        from openbb import obb

        df = obb.economy.cpi(
            country=country, provider="oecd", transform="yoy", frequency="monthly"
        ).to_df()
        if "expenditure" in df.columns:
            df = df[df["expenditure"] == "total"]
        if df.empty:
            return None
        value = _safe_float(df.sort_index().iloc[-1]["value"])
        return value * 100 if value is not None else None

    return _safe_openbb_call(call)


def _fetch_fixedincome_rate(fn_name: str, **kwargs):
    def call():
        from openbb import obb

        fn = getattr(obb.fixedincome.rate, fn_name)
        df = fn(provider="fred", **kwargs).to_df()
        if df.empty:
            return None
        row = df.sort_index().iloc[-1]
        col = "rate" if "rate" in df.columns else df.columns[0]
        return _safe_float(row[col]) * 100 if _safe_float(row[col]) is not None else None

    return _safe_openbb_call(call)


def _fetch_eurusd():
    def call():
        from openbb import obb

        df = obb.currency.price.historical("EURUSD", provider="yfinance").to_df()
        if df.empty:
            return None
        return _safe_float(df.sort_index()["close"].iloc[-1])

    return _safe_openbb_call(call)


def _fetch_index_yield(symbol: str):
    def call():
        from openbb import obb

        df = obb.index.price.historical(symbol, provider="yfinance").to_df()
        if df.empty:
            return None
        return _safe_float(df.sort_index()["close"].iloc[-1])

    return _safe_openbb_call(call)


def _build_macro():
    return {
        "cpi_de": _fetch_cpi_yoy("germany"),
        "cpi_us": _fetch_cpi_yoy("united_states"),
        "ecb_rate": _fetch_fixedincome_rate("ecb", interest_rate_type="deposit"),
        "fed_rate": _fetch_fixedincome_rate("effr"),
        "eur_usd": _fetch_eurusd(),
        "bund_10y": _fetch_index_yield("^GDBR10"),
        "treasury_10y": _fetch_index_yield("^TNX"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/macro")
def get_macro():
    return cached("macro", 3600, _build_macro)


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


def _parse_news_entry(entry: dict):
    content = entry.get("content", entry)
    title = content.get("title") or entry.get("title")
    if not title:
        return None
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
        published = datetime.utcfromtimestamp(ts).isoformat() if ts else None
    return {
        "title": title,
        "publisher": publisher,
        "link": link,
        "published": published,
    }


@app.get("/api/news/{symbol}")
def get_news(symbol: str):
    try:
        news = cached(f"news:{symbol}", 120, lambda: yf.Ticker(symbol).news or [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = []
    for entry in news[:10]:
        item = _parse_news_entry(entry)
        if item:
            items.append(item)
    return items


CRYPTO_NEWS_SYMBOL = "BTC-USD"


@app.get("/api/crypto-news")
def get_crypto_news():
    try:
        news = cached(
            f"news:{CRYPTO_NEWS_SYMBOL}",
            120,
            lambda: yf.Ticker(CRYPTO_NEWS_SYMBOL).news or [],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = []
    for entry in news:
        item = _parse_news_entry(entry)
        if item and item["publisher"] and "reuters" in item["publisher"].lower():
            items.append(item)
    items.sort(key=lambda i: i["published"] or "", reverse=True)
    return items[:10]


ANALYST_MODEL = "claude-sonnet-4-6"

ANALYST_SYSTEM_PROMPT = """Du bist der KI-Analyst des SERAPHIN TERMINAL, eines Bloomberg-artigen Finanz-Terminals.

Mit jeder Anfrage bekommst du aktuelle Marktdaten als Kontext: Watchlist-Kurse, Kennzahlen und News des ausgewählten Tickers sowie Makrodaten (Inflation, Leitzinsen, EUR/USD, Anleiherenditen).

Regeln, an die du dich strikt hältst:
- Antworte ausschließlich auf Deutsch, kurz und nüchtern-analytisch, ohne Floskeln.
- Du gibst NIEMALS Kauf- oder Verkaufsempfehlungen und keine impliziten Handlungsaufforderungen (z.B. "jetzt einsteigen", "Position reduzieren", "kaufenswert"). Diese Regel gilt ausnahmslos, auch wenn explizit danach gefragt wird. Weise in dem Fall knapp darauf hin, dass du keine Anlageberatung gibst, und ordne stattdessen die vorliegende Datenlage sachlich ein.
- Wenn Kontextdaten fehlen oder "N/A" sind, weise darauf hin statt zu spekulieren oder Werte zu erfinden.
"""


def _build_analyst_context(symbol: str) -> str:
    try:
        watchlist = get_watchlist()
    except Exception:
        watchlist = None
    try:
        quote = get_quote(symbol)
    except Exception:
        quote = None
    try:
        news = get_news(symbol)[:5]
    except Exception:
        news = None
    try:
        macro = get_macro()
    except Exception:
        macro = None

    lines = [f"Ausgewählter Ticker: {symbol}", "", "Watchlist:"]
    if watchlist:
        for row in watchlist:
            lines.append(
                f"- {row.get('symbol')}: {row.get('price')} ({row.get('change_pct')}%)"
            )
    else:
        lines.append("N/A")

    lines += ["", "Kennzahlen:"]
    if quote:
        lines.append(f"- Name: {quote.get('name')}")
        lines.append(f"- KGV: {quote.get('pe_ratio')}")
        lines.append(f"- Market Cap: {quote.get('market_cap')}")
        lines.append(
            f"- 52W High/Low: {quote.get('week52_high')} / {quote.get('week52_low')}"
        )
    else:
        lines.append("N/A")

    lines += ["", "News:"]
    if news:
        for item in news:
            lines.append(f"- {item.get('title')} ({item.get('publisher')})")
    else:
        lines.append("N/A")

    lines += ["", "Makrodaten:"]
    if macro:
        lines.append(f"- CPI Deutschland (YoY): {macro.get('cpi_de')}")
        lines.append(f"- CPI USA (YoY): {macro.get('cpi_us')}")
        lines.append(f"- EZB-Leitzins: {macro.get('ecb_rate')}")
        lines.append(f"- Fed-Leitzins: {macro.get('fed_rate')}")
        lines.append(f"- EUR/USD: {macro.get('eur_usd')}")
        lines.append(f"- 10J Bund-Rendite: {macro.get('bund_10y')}")
        lines.append(f"- 10J Treasury-Rendite: {macro.get('treasury_10y')}")
    else:
        lines.append("N/A")

    return "\n".join(lines)


class AnalystMessage(BaseModel):
    role: str
    content: str


class AnalystRequest(BaseModel):
    symbol: str
    messages: list[AnalystMessage]


@app.post("/api/analyst")
def post_analyst(payload: AnalystRequest):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY ist nicht gesetzt")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages darf nicht leer sein")

    context = _build_analyst_context(payload.symbol)
    system_prompt = f"{ANALYST_SYSTEM_PROMPT}\nAktueller Kontext:\n{context}"

    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model=ANALYST_MODEL,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Anthropic API Fehler: {exc.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(
            status_code=502, detail="Verbindung zur Anthropic API fehlgeschlagen"
        )

    text = "".join(block.text for block in response.content if block.type == "text")
    return {"reply": text}


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
