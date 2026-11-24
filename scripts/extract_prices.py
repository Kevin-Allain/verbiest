"""Pilot: find the price of cars when new, in their English Wikipedia article, with Claude.

Wikipedia has no price field (neither in infoboxes nor on Wikidata), but many
articles mention prices in passing. This script keeps only the passages that
mention money and asks Claude to return the prices that are clearly the price
of a new car, each with the exact sentence it comes from. Every quote is then
checked against the article text, so nothing invented can slip through.

Setup (once):
    python3 -m venv scripts/.venv
    scripts/.venv/bin/pip install -r scripts/requirements-prices.txt
    export ANTHROPIC_API_KEY=...            # your key from the Claude Console, or save it once
                                            # (hidden input) in ~/.config/verbiest/anthropic_api_key

Run:
    scripts/.venv/bin/python scripts/extract_prices.py --fetch-only   # download texts only (free)
    scripts/.venv/bin/python scripts/extract_prices.py --limit 5      # try 5 cars
    scripts/.venv/bin/python scripts/extract_prices.py                 # the whole sample

Results go to data/raw/prices_pilot.json (re-runs skip cars already done).
"""
import argparse
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import time
from typing import List, Literal, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import wikiapi  # noqa: E402  (stdlib-only Wikipedia client with an on-disk cache)

OUT = os.path.join(ROOT, "data", "raw", "prices_pilot.json")
MODEL = "claude-opus-5-5"
PRICE_IN, PRICE_OUT = 4.00, 20.00          # US$ per million tokens for this model
PROMPT_VERSION = 1

# ------------------------------------------------------------------ sample
def load_cars():
    src = open(os.path.join(ROOT, "data", "verbiest-data.js"), encoding="utf-8").read()
    return json.loads(src[src.index("{"): src.rindex("}") + 1])["cars"]


def pick_sample(cars, n, seed=7):
    """Half the best-known models, half picked at random (fixed seed, so the sample is stable)."""
    by_fame = sorted(cars, key=lambda c: -c.get("p", 0))
    top = [c["n"] for c in by_fame[: n // 2]]
    rest = [c["n"] for c in cars if c["n"] not in set(top)]
    random.Random(seed).shuffle(rest)
    return top + rest[: n - len(top)]

# ------------------------------------------------------------------ article text
def fetch_text(title):
    """Whole article as plain text, sections marked '== Heading =='. Cached on disk."""
    d = wikiapi.get_json(wikiapi.WIKIPEDIA_API, {
        "action": "query", "prop": "extracts", "explaintext": "1", "exsectionformat": "wiki",
        "redirects": "1", "titles": title,
    })
    pages = d.get("query", {}).get("pages", [])
    return (pages[0].get("extract") or "") if pages else ""


MONEY = re.compile(
    r"(?:US\$|A\$|AU\$|C\$|CA\$|NZ\$|R\$|HK\$|S\$|\$|£|€|¥|₹|₩)\s?\d"
    r"|\d[\d,.\s]*\s?(?:francs?|lire|lira|marks?|Reichsmarks?|RM|DM|yen|pounds?|dollars?|euros?|guineas?|"
    r"rupees?|won|yuan|RMB|kronor|kroner|pesetas?|escudos?|rubles?|roubles?|shillings?)\b"
    r"|\b(?:USD|GBP|EUR|DEM|FRF|ITL|JPY|SEK|CHF|CNY|INR|AUD|CAD)\s?\d",
    re.I)
SKIP_SECTIONS = re.compile(r"^(references|notes|see also|external links|further reading|bibliography|sources|citations|footnotes)$", re.I)


def price_passages(text, max_chars=12000):
    """The article's opening paragraphs plus every paragraph that mentions an amount of money."""
    lead, picked, section, skipping = [], [], None, False
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^(={2,6})\s*(.*?)\s*\1$", line)
        if m:
            section = m.group(2)
            skipping = bool(SKIP_SECTIONS.match(section))
            continue
        if skipping:
            continue
        if section is None and len(lead) < 2:
            lead.append(line)
        elif MONEY.search(line):
            picked.append(f"[{section or 'Introduction'}] {line}")
    if not picked:
        return None
    out = "\n\n".join(lead + picked)
    return out[:max_chars]

# ------------------------------------------------------------------ Claude
from pydantic import BaseModel, Field  # noqa: E402


class Price(BaseModel):
    amount: float = Field(description="The amount as a number, e.g. 2350 for '$2,350' (pre-decimal £sd: pounds as a decimal).")
    amount_text: str = Field(description="The amount exactly as written in the text, e.g. 'US$2,350'.")
    currency: str = Field(description="ISO 4217 code where possible (USD, GBP, FRF, DEM, ITL, JPY, AUD...).")
    year: Optional[int] = Field(description="Year the price applied, if stated or clearly implied by the text; otherwise null.")
    market: Optional[str] = Field(description="Country or market the price applied to, if stated; otherwise null.")
    version: Optional[str] = Field(description="Version, trim or body style the price is for, if stated; otherwise null.")
    kind: Literal["launch", "list"] = Field(description="'launch' if this is the price when the model or version first went on sale; 'list' for any other price of a new car.")
    quote: str = Field(description="The shortest exact span copied from the text that contains the amount, character for character.")


class Prices(BaseModel):
    prices: List[Price]


SYSTEM = """You extract historical car prices from Wikipedia article text for a car-history app.

The user gives you passages from the Wikipedia article about one car model. Return every price that the
text explicitly states as the price at which a NEW car of this model (or one of its versions) was sold or
offered: launch price, base or list price, starting price, the price of a version or in a given market or year.

Leave out:
- used-car, auction or collector prices, and values "in today's money" or adjusted for inflation;
- development, tooling, production or investment costs, fines, salaries, taxes and subsidies on their own;
- prices of options or accessories alone, and prices of other models, unless clearly a version of this one;
- amounts you would have to compute or guess; give only what the text states.

For each price, copy `quote` exactly from the text (the shortest span that contains the amount), so it can be
checked automatically. Give the year only if the text states it or it is clearly implied (for example the
model's launch when the sentence says "at launch"). If the passages contain no such price, return an empty list."""


KEY_FILE = os.path.expanduser("~/.config/verbiest/anthropic_api_key")


def make_client():
    import anthropic
    # Key: ANTHROPIC_API_KEY, else a private key file (see the README), else the SDK's own lookup.
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key and os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            key = f.read().strip() or None
    # Talk to the Anthropic API directly; an ANTHROPIC_BASE_URL meant for another tool is ignored.
    return anthropic.Anthropic(api_key=key, base_url=os.environ.get("VERBIEST_ANTHROPIC_BASE_URL", "https://api.anthropic.com"))


def ask_claude(client, title, passages):
    response = client.beta.messages.parse(
        model=MODEL,
        max_tokens=4000,
        output_config={"effort": "low"},            # a simple extraction task
        betas=["server-side-fallback-2026-07-01"],   # if the model declines, the API retries on a fallback model
        fallbacks="default",
        system=SYSTEM,
        messages=[{"role": "user", "content": f"Article: {title}\n\n{passages}"}],
        output_format=Prices,
    )
    usage = response.usage
    cost = (usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT) / 1e6
    if response.stop_reason == "refusal":
        return {"error": "refusal", "cost": cost}
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        return {"error": response.stop_reason or "no output", "cost": cost}
    return {"prices": [p.model_dump() for p in response.parsed_output.prices], "cost": cost,
            "tokens": [usage.input_tokens, usage.output_tokens], "model": response.model}

# ------------------------------------------------------------------ checks
def norm_ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


def verify(price, text):
    """The quote must be in the article, and must contain the amount as written."""
    q, t = norm_ws(price["quote"]), norm_ws(text)
    price["quote_ok"] = bool(q) and q in t
    digits = re.sub(r"\D", "", price["amount_text"])
    price["amount_ok"] = bool(digits) and digits in re.sub(r"\D", "", q)
    return price

# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--limit", type=int, default=0, help="only process this many cars (for a first test)")
    ap.add_argument("--fetch-only", action="store_true", help="download the article texts, do not call Claude")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    titles = pick_sample(load_cars(), args.sample)
    if args.limit:
        titles = titles[: args.limit]
    results = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}

    print(f"Downloading {len(titles)} articles (cached ones are instant)…", flush=True)
    texts = {}
    for k, t in enumerate(titles, 1):
        texts[t] = fetch_text(t)
        if k % 20 == 0:
            print(f"  {k}/{len(titles)} texts", flush=True)
    if args.fetch_only:
        found = sum(1 for t in titles if price_passages(texts[t]))
        print(f"Done. {found} of {len(titles)} articles mention an amount of money.")
        return

    todo = [t for t in titles if not (results.get(t, {}).get("v") == PROMPT_VERSION and "error" not in results[t])]
    client = make_client()
    print(f"Asking {MODEL} about {len(todo)} cars…", flush=True)

    def work(title):
        passages = price_passages(texts[title])
        if not passages:
            return title, {"v": PROMPT_VERSION, "prices": [], "skipped": "no amount of money in the article", "cost": 0}
        try:
            r = ask_claude(client, title, passages)
        except Exception as e:  # keep going; the car is retried on the next run
            return title, {"v": PROMPT_VERSION, "error": f"{type(e).__name__}: {e}", "cost": 0}
        r["v"] = PROMPT_VERSION
        for p in r.get("prices", []):
            verify(p, texts[title])
        return title, r

    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for k, (title, r) in enumerate(pool.map(work, todo), 1):
            results[title] = r
            if k % 10 == 0 or k == len(todo):
                json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
                print(f"  {k}/{len(todo)} cars ({time.time() - t0:.0f} s)", flush=True)
    json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- report
    done = [results[t] for t in titles if t in results]
    asked = [r for r in done if "skipped" not in r]
    errors = [r for r in done if "error" in r]
    with_price = [r for r in done if any(p["quote_ok"] and p["amount_ok"] for p in r.get("prices", []))]
    with_launch = [r for r in done if any(p["quote_ok"] and p["amount_ok"] and p["kind"] == "launch" for p in r.get("prices", []))]
    bad = sum(1 for r in done for p in r.get("prices", []) if not (p["quote_ok"] and p["amount_ok"]))
    total = sum(1 for r in done for p in r.get("prices", []))
    cost = sum(r.get("cost", 0) for r in done)
    print(f"""
Cars in the sample:           {len(titles)}
Mention an amount of money:   {len(asked)}  (only these were sent to Claude)
With at least one new price:  {len(with_price)}
With a launch price:          {len(with_launch)}
Prices found:                 {total}  ({bad} failed the quote check and are ignored)
Errors:                       {len(errors)}
Cost of this run:             ${cost:.2f}  (about ${cost / max(1, len(asked)):.3f} per car sent)""")


if __name__ == "__main__":
    main()
