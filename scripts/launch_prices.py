"""Launch prices of cars, from open sources, without any paid API.

Wikipedia has no price field (Wikidata's "price" property P2284 is almost never
filled in for cars), but many articles state the price of a new car in their
text or tables, often in the Wikipedia of the car's home country (German
articles give prices in DM, French ones in francs, Japanese ones in yen...).
So this script gathers, for each car:

  1. Wikidata's price statements (P2284), if any;
  2. from the English, French and German Wikipedias, plus the one of the
     maker's home country, the sentences and table rows that mention an amount
     of money, best candidates first (launch and list prices rank high,
     auctions and development costs low).

The passages are then read (by Claude in a Claude Code session, or by a
person) and the launch prices written to found/*.json in the batch folder, each
with the exact sentence it comes from (from Wikipedia, or from a web page found
by searching when Wikipedia has nothing). `verify` re-reads every source page and
checks the quote and the amount are really there, so nothing invented slips through.

Each batch lives in data/raw/prices/<batch>/:
    python3 scripts/launch_prices.py pick top100 --top 100      # the most famous cars on sale
    python3 scripts/launch_prices.py pick pilot12 --pilot       # one car per year asked for
    python3 scripts/launch_prices.py replace top100 "Title" --reason "never sold"
    python3 scripts/launch_prices.py gather top100              # download, write passages/
    python3 scripts/launch_prices.py verify top100              # check found/*.json

Everything downloaded is cached in scripts/.cache, so re-runs are instant.
"""
import argparse
import glob
import hashlib
import json
import os
import random
import re
import sys
import urllib.parse
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import wikiapi  # noqa: E402  (stdlib-only Wikimedia client with an on-disk cache)

PRICES_DIR = os.path.join(ROOT, "data", "raw", "prices")

# The first test: how many cars introduced in each year.
PILOT = {1960: 1, 1970: 1, 1980: 2, 1990: 2, 2000: 2, 2010: 2, 2024: 2}

# Wikipedias read for every car, plus the one of the maker's home country.
BASE_LANGS = ["en", "fr", "de"]
HOME_LANG = {
    "Japan": "ja", "Italy": "it", "Germany": "de", "East Germany": "de", "German Reich": "de", "Austria": "de",
    "France": "fr", "Sweden": "sv", "Czechia": "cs", "Czechoslovakia": "cs", "Spain": "es", "South Korea": "ko",
    "China": "zh", "Russia": "ru", "Soviet Union": "ru", "Netherlands": "nl", "Romania": "ro", "Brazil": "pt",
    "Poland": "pl", "Portugal": "pt", "Denmark": "da", "Norway": "no", "Finland": "fi", "Hungary": "hu",
    "Turkey": "tr", "Iran": "fa", "Malaysia": "ms", "Taiwan": "zh", "Hong Kong": "zh", "Vietnam": "vi", "Ukraine": "uk",
}


class Batch:
    def __init__(self, name):
        self.dir = os.path.join(PRICES_DIR, name)
        self.sample = os.path.join(self.dir, "sample.json")
        self.excluded = os.path.join(self.dir, "excluded.json")
        self.gathered = os.path.join(self.dir, "gathered.json")
        self.passages = os.path.join(self.dir, "passages")
        self.found = os.path.join(self.dir, "found")

    def load_sample(self):
        return json.load(open(self.sample, encoding="utf-8"))

    def save_sample(self, s):
        os.makedirs(self.dir, exist_ok=True)
        json.dump(s, open(self.sample, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def api(lang):
    return f"https://{lang}.wikipedia.org/w/api.php"


def page_url(lang, title):
    return f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="()_,'-.!")

# ------------------------------------------------------------------ choosing cars
def load_data():
    src = open(os.path.join(ROOT, "data", "verbiest-data.js"), encoding="utf-8").read()
    return json.loads(src[src.index("{"): src.rindex("}") + 1])


NOT_FOR_SALE = re.compile(
    r"concept|prototype|show car|one-off|race car|racing|rally car|formula|land speed|experimental|"
    r"manufacturer|company|automaker|brand|marque|engine|study|design exercise|record", re.I)


def for_sale(c, D):
    """Leave out concept and racing cars, prototypes, and entries that are really companies or engines."""
    kinds = {k["k"]: 1 << i for i, k in enumerate(D["kinds"])}
    if c.get("k", 0) & (kinds["concept"] | kinds["racing"] | kinds["steam"]):
        return False
    tags = {D["tags"][t] for t in c.get("t", [])}
    if tags & {"Concept car", "Racing car"}:
        return False
    return not NOT_FOR_SALE.search(c["n"] + " " + (c.get("s") or ""))


def car_info(c, D):
    return {"n": c["n"], "y": c["y"], "p": c.get("p", 0), "maker": D["makers"][c["m"]]["n"] if c["m"] >= 0 else None,
            "country": D["countries"][c["c"]]["n"] if c["c"] >= 0 else None, "s": c.get("s")}


def cmd_pick(args):
    D = load_data()
    b = Batch(args.batch)
    if args.top:
        pool = sorted((c for c in D["cars"] if for_sale(c, D)), key=lambda c: (-c.get("p", 0), c["n"]))
        cars = [car_info(c, D) for c in pool[: args.top]]
        sample = {"how": "top", "cars": cars}
    else:
        rng = random.Random(args.seed)
        cars = []
        for year, n in PILOT.items():
            pool = sorted((c for c in D["cars"] if c["y"] == year and for_sale(c, D)), key=lambda c: c["n"])
            cars += [car_info(c, D) for c in rng.sample(pool, n)]
        sample = {"how": "pilot", "cars": cars}
    b.save_sample(sample)
    for k, p in enumerate(cars, 1):
        print(f"{k:3}. {p['y']}  {p['n']}  —  {p['maker']} ({p['country']}) · {p['s'] or ''}")


def cmd_replace(args):
    """Swap a car of the sample that turns out never to have been sold: for the most famous cars, by the next
    most famous one; for the pilot, by a random car of the same year."""
    D = load_data()
    b = Batch(args.batch)
    sample = b.load_sample()
    cars = sample["cars"]
    excluded = json.load(open(b.excluded, encoding="utf-8")) if os.path.exists(b.excluded) else {}
    excluded[args.title] = args.reason
    k = next(i for i, p in enumerate(cars) if p["n"] == args.title)
    taken = {p["n"] for p in cars} | set(excluded)
    if sample["how"] == "top":
        pool = sorted((c for c in D["cars"] if for_sale(c, D) and c["n"] not in taken), key=lambda c: (-c.get("p", 0), c["n"]))
        new = pool[0]
    else:
        pool = sorted((c for c in D["cars"] if c["y"] == cars[k]["y"] and for_sale(c, D) and c["n"] not in taken), key=lambda c: c["n"])
        new = random.Random(f"{args.title}/{len(excluded)}").choice(pool)
    cars[k] = car_info(new, D)
    b.save_sample(sample)
    json.dump(excluded, open(b.excluded, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{args.title} → {new['n']} ({new['y']})")

# ------------------------------------------------------------------ page text
SKIP_CLASSES = {"mw-editsection", "navbox", "navbox-styles", "reflist", "references", "mw-references-wrap",
                "noprint", "metadata", "sistersitebox", "mw-empty-elt", "printfooter", "catlinks"}
VOID = {"br", "img", "hr", "meta", "link", "input", "wbr", "area", "base", "col", "source", "track", "embed", "param"}
BLOCK = {"p", "li", "div", "tr", "dd", "dt", "caption", "table", "ul", "ol", "dl", "figcaption", "blockquote"}
HEADS = {"h2", "h3", "h4", "h5", "h6"}


class HtmlText(HTMLParser):
    """Rendered HTML → plain text: one line per paragraph, list item or table row
    (cells separated by ' | '), headings as '== Heading =='. Footnotes and navboxes dropped."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.stack, self.skip = [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if tag == "br" and not self.skip:
                self.out.append("\n")
            return
        cls = set((dict(attrs).get("class") or "").split())
        skip = tag in ("style", "script", "noscript") or (tag == "sup" and "reference" in cls) or bool(cls & SKIP_CLASSES)
        self.stack.append((tag, skip))
        if skip:
            self.skip += 1
        if self.skip:
            return
        if tag in HEADS:
            self.out.append("\n== ")
        elif tag in BLOCK:
            self.out.append("\n")
        elif tag in ("td", "th"):
            self.out.append(" | ")

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        idx = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if idx is None:
            return
        for _, sk in self.stack[idx:]:
            if sk:
                self.skip -= 1
        del self.stack[idx:]
        if self.skip:
            return
        if tag in HEADS:
            self.out.append(" ==\n")
        elif tag in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(html):
    p = HtmlText()
    p.feed(html)
    lines = []
    for line in "".join(p.out).split("\n"):
        line = re.sub(r"[ \t  ]+", " ", line).strip()
        line = re.sub(r"^\|\s*", "", line)
        line = re.sub(r"(\s*\|\s*)+$", "", line)
        if line and line != "|":
            lines.append(line)
    return "\n".join(lines)


def page_text(lang, title):
    """Whole article (prose, tables, infobox) as plain text, with its revision id. Cached on disk."""
    d = wikiapi.get_json(api(lang), {"action": "parse", "page": title, "prop": "text|revid", "redirects": "1",
                                     "disableeditsection": "1", "disabletoc": "1", "maxlag": "5"})
    if "parse" not in d:
        return None, None
    return html_to_text(d["parse"]["text"]), d["parse"].get("revid")

# ------------------------------------------------------------------ price passages
NUM = r"\d[\d.,'’   ]*"
# Currency words (any case) and symbols...
MONEY_WORDS = re.compile(
    r"(?:US\$|A\$|AU\$|C\$|CA\$|NZ\$|R\$|HK\$|S\$|CN¥|\$|£|€|¥|₹|₩|₽)\s?\d"
    r"|" + NUM + r"\s?(?:€|£|\$|¥|円|万円|億円|元|원|₩|₽|francs?|lire|lira|euros?|dollars?|pounds?|guineas?|yen|"
    r"pesetas?|escudos?|kronor|kroner|korun|rubles?|roubles?|руб|рубл|yuan|cruzeiros?|reais|forints?|lakh|crore)", re.I)
# ...and abbreviations that only mean money in this exact case ("Ft" forint, not "ft" feet).
MONEY_ABBR = re.compile(
    NUM + r"\s?(?:Kč|Kčs|zł|kr\b|SEK|DM\b|D-Mark|Mark\b|Fr\.|CHF|Lit\.|Euro\b|EUR\b|ptas|Pts\b|RMB|lei\b|Ft\b)"
    # one-letter marks only after a real amount (3+ digits), so "2F" or "4RM" in engine codes do not count
    r"|\b\d{1,3}(?:[ .,'  ]\d{3})+\s?(?:F|FF|NF|RM|L\.)(?![\w-])|\b\d{3,}\s?(?:F|FF|NF|RM|L\.)(?![\w-])"
    r"|\bDM\s?(?:\d{1,3}(?:[.,]\d{3})+|\d{3,})|\bRs\.?\s?\d|\b(?:USD|GBP|EUR|DEM|DDM|FRF|ITL|JPY|SEK|NOK|CHF|CNY|RMB|INR|AUD|CAD|ESP|CZK|KRW|RUB|NLG|BEF|BRL)\s?\d")


def has_money(s):
    return bool(MONEY_WORDS.search(s) or MONEY_ABBR.search(s))


PRICE_WORD = re.compile(
    r"\bprice|\bpriced|MSRP|\bcost|\bretail|\bprix\b|\btarif|Preis|kostete|prezzo|listino|precio|\bpris\b|\bcena\b|"
    r"価格|售价|价格|가격|цена|стоимость", re.I)
LAUNCH_WORD = re.compile(
    r"launch|introduc|on sale|went on sale|base price|base model|list price|MSRP|starting|retail|"
    r"lancé|lancement|commercialis|prix de base|Neupreis|Grundpreis|Einführung|kostete|vorgestellt|Markteinführung|"
    r"lanciat|listino|発売|新車価格|上市|售价|起售|指导价", re.I)
NOISE_WORD = re.compile(
    r"auction|sold for|Sotheby|Bonhams|Barrett|Mecum|Gooding|hammer|record price|collector|development|invest|budget|"
    r"tooling|revenue|profit|\bloss|\bfine[ds]?\b|settlement|lawsuit|salary|subsid|bailout|\bloan|valued|\bworth|in today|"
    r"inflation|adjusted|Versteigerung|versteigert|enchères|adjugé|Entwicklungskosten|investi|Umsatz|chiffre d'affaires", re.I)
SKIP_SECTIONS = re.compile(
    r"^(references|notes|see also|external links|further reading|bibliography|sources|citations|footnotes|"
    r"notes et références|références|voir aussi|liens externes|bibliographie|articles connexes|"
    r"einzelnachweise|weblinks|literatur|anmerkungen|siehe auch|quellen|note|bibliografia|collegamenti esterni|voci correlate|"
    r"脚注|出典|関連項目|外部リンク|参考文献|referencias|enlaces externos|véase también|reference|externí odkazy|"
    r"källor|externa länkar|se även)$", re.I)
SENTENCE_END = re.compile(r"(?<=[.!?。])\s+(?=[A-ZÀ-ÖØ-Þ\"“„«(0-9])|(?<=。)")


def price_passages(text, keep=6, max_len=420):
    """The sentences and table rows that mention an amount of money, best candidates first, in page order.
    Returns (kept, how many were left out)."""
    found, section, skipping = [], None, False
    for line in text.split("\n"):
        m = re.match(r"^==\s*(.*?)\s*==$", line)
        if m:
            section, skipping = m.group(1), bool(SKIP_SECTIONS.match(m.group(1)))
            continue
        if skipping:
            continue
        pieces = [line] if len(line) <= max_len else SENTENCE_END.split(line)
        for piece in pieces:
            piece = piece.strip()
            short_row = len(piece) < 200 and PRICE_WORD.search(piece) and re.search(r"\d{3}", piece)
            if not (has_money(piece) or short_row):
                continue
            score = 1 + 3 * bool(PRICE_WORD.search(piece)) + 2 * bool(LAUNCH_WORD.search(piece)) - 4 * bool(NOISE_WORD.search(piece))
            if len(piece) > max_len:
                piece = piece[:max_len] + "…"
            found.append((score, len(found), f"[{section or 'Intro'}] {piece}"))
    best = sorted(found, key=lambda x: (-x[0], x[1]))[:keep]
    return [s for _, _, s in sorted(best, key=lambda x: x[1])], max(0, len(found) - keep)

# ------------------------------------------------------------------ gather
def wikidata_prices(entity):
    prices = []
    for st in entity.get("claims", {}).get("P2284", []):
        v = st.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        if not v:
            continue
        when = [q["datavalue"]["value"]["time"][1:5] for q in st.get("qualifiers", {}).get("P585", []) if "datavalue" in q]
        prices.append({"amount": v.get("amount"), "unit": v.get("unit", "").rsplit("/", 1)[-1], "year": when[0] if when else None})
    return prices


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]


def cmd_gather(args):
    b = Batch(args.batch)
    cars = b.load_sample()["cars"]
    qids = {v["enwiki"]: q for q, v in json.load(open(os.path.join(ROOT, "data", "raw", "car_wikidata.json"))).items() if v.get("enwiki")}
    for car in cars:
        if car["n"] not in qids:
            pp = wikiapi.get_json(api("en"), {"action": "query", "prop": "pageprops", "ppprop": "wikibase_item", "titles": car["n"], "redirects": "1"})
            pages = pp.get("query", {}).get("pages", [])
            if pages and pages[0].get("pageprops", {}).get("wikibase_item"):
                qids[car["n"]] = pages[0]["pageprops"]["wikibase_item"]
    entities = {}  # Wikidata in batches of 50: language links and price statements
    for chunk in wikiapi.chunks(sorted({qids[c["n"]] for c in cars if c["n"] in qids}), 50):
        d = wikiapi.get_json(wikiapi.WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(chunk), "props": "claims|sitelinks"})
        entities.update(d.get("entities", {}))
    os.makedirs(b.passages, exist_ok=True)
    gathered = []
    for k, car in enumerate(cars, 1):
        title, qid = car["n"], qids.get(car["n"])
        entity = entities.get(qid, {})
        links = {s[:-4]: v["title"] for s, v in entity.get("sitelinks", {}).items() if s.endswith("wiki") and s.count("wiki") == 1}
        links["en"] = links.get("en", title)
        langs = list(BASE_LANGS)
        home = HOME_LANG.get(car.get("country") or "")
        if home and home not in langs:
            langs.append(home)
        entry = {"n": title, "y": car["y"], "maker": car["maker"], "country": car["country"], "qid": qid,
                 "wikidata_prices": wikidata_prices(entity), "pages": {}}
        md = [f"# {k}. {title} ({car['y']}) — {car['maker']}, {car['country']}",
              f"{car.get('s') or ''}", f"Wikidata {qid}: price statements {entry['wikidata_prices'] or 'none'}"]
        for lang in langs:
            t = links.get(lang)
            if not t:
                md.append(f"\n## {lang}: no article")
                continue
            text, revid = page_text(lang, t)
            if text is None:
                md.append(f"\n## {lang}: {t} (could not be read)")
                continue
            kept, left = price_passages(text)
            entry["pages"][lang] = {"title": t, "revid": revid, "url": page_url(lang, t), "chars": len(text), "passages": len(kept) + left}
            md.append(f"\n## {lang}: {t} — {len(text):,} characters" + (f", {left} weaker passages left out" if left else ""))
            md.extend(f"- {s}" for s in kept)
        open(os.path.join(b.passages, f"{k:03}-{slug(title)}.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
        gathered.append(entry)
        json.dump(gathered, open(b.gathered, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  {k}/{len(cars)}  {title}: " + ", ".join(f"{l} {p['passages']}" for l, p in entry["pages"].items()), flush=True)
    print(f"Done: passages in {os.path.relpath(b.passages, ROOT)} ({wikiapi.STATS['network']} downloads, {wikiapi.STATS['cached']} from cache)")

# ------------------------------------------------------------------ verify
WEB_CACHE = os.path.join(HERE, ".cache", "web")


def fetch_web_text(url):
    """A web page as plain text (cached on disk). Only ever read as text, never run."""
    import urllib.request
    if not url:
        return ""
    os.makedirs(WEB_CACHE, exist_ok=True)
    path = os.path.join(WEB_CACHE, hashlib.sha1(url.encode("utf-8")).hexdigest() + ".html")
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh) ProjectVerbiest-price-check/0.1",
                                                       "Accept-Language": "en,fr;q=0.8"})
            with urllib.request.urlopen(req, timeout=30) as r:
                open(path, "wb").write(r.read())
        except Exception as e:  # some sites refuse scripts; the price then stays "not re-checked"
            print(f"    (could not read {url}: {type(e).__name__})")
            return ""
    return html_to_text(open(path, encoding="utf-8", errors="replace").read())


def norm_ws(s):
    return re.sub(r"[\s  ]+", " ", s or "").replace("’", "'").strip()


def cmd_verify(args):
    b = Batch(args.batch)
    cars = b.load_sample()["cars"]
    gathered = {g["n"]: g for g in json.load(open(b.gathered, encoding="utf-8"))}
    results, ok, bad, texts = {}, 0, 0, {}
    for path in sorted(glob.glob(os.path.join(b.found, "*.json"))):
        chunk = json.load(open(path, encoding="utf-8"))
        for car in chunk:
            results[car["n"]] = car
            for p in car.get("prices", []):
                src = p.get("source", "")
                if src == "wikidata":
                    p["quote_ok"] = p["amount_ok"] = True
                    ok += 1
                    continue
                if src.startswith("wikipedia:") and not p.get("url"):  # the article's address, from the download
                    page = gathered.get(car["n"], {}).get("pages", {}).get(src.split(":", 1)[1])
                    p["url"] = page["url"] if page else None
                key = (src, p.get("url"))
                if key not in texts:
                    if src.startswith("wikipedia:"):
                        page = gathered.get(car["n"], {}).get("pages", {}).get(src.split(":", 1)[1])
                        texts[key] = page_text(src.split(":", 1)[1], page["title"])[0] if page else ""
                    else:
                        texts[key] = fetch_web_text(p.get("url"))
                q = norm_ws(p.get("quote"))
                p["quote_ok"] = bool(q) and q in norm_ws(texts[key])
                digits = re.sub(r"\D", "", p.get("amount_text", ""))
                p["amount_ok"] = bool(digits) and digits in re.sub(r"\D", "", q)
                good = p["quote_ok"] and p["amount_ok"]
                ok += good
                bad += not good
                if not good:
                    print(f"  ✗ {car['n']}: {p.get('amount_text')} ({src}) quote_ok={p['quote_ok']} amount_ok={p['amount_ok']}")
        json.dump(chunk, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    def main_price(r):
        return next((p for p in r.get("prices", []) if p.get("main") and p["quote_ok"] and p["amount_ok"]), None)
    done = [c for c in cars if c["n"] in results]
    with_price = [c for c in done if main_price(results[c["n"]])]
    by_src, by_conf = {}, {}
    for c in with_price:
        p = main_price(results[c["n"]])
        s = "Wikipedia" if p["source"].startswith("wikipedia") else "Wikidata" if p["source"] == "wikidata" else "web"
        by_src[s] = by_src.get(s, 0) + 1
        by_conf[p.get("confidence", "?")] = by_conf.get(p.get("confidence", "?"), 0) + 1
    print(f"""
Cars in the batch:        {len(cars)}
With a result recorded:   {len(done)}
With a checked price:     {len(with_price)}   (from {', '.join(f'{k} {v}' for k, v in sorted(by_src.items()))})
Confidence:               {', '.join(f'{k} {v}' for k, v in sorted(by_conf.items()))}
Prices checked:           {ok} found on their source page, {bad} not""")
    missing = [c["n"] for c in cars if c["n"] not in results]
    if missing:
        print(f"No result yet for {len(missing)}: " + "; ".join(missing))


# ------------------------------------------------------------------ export to the app
PRICES_JSON = os.path.join(ROOT, "data", "prices.json")
APPROX = {"about": "~", "around": "~", "just under": "<", "more than": ">"}
VERSION_FR = {
    "1.0 litre, 37 kW": "1,0 litre, 37 kW", "1.1 L three-door": "1.1 L trois portes", "1.2 TFSI (base)": "1.2 TFSI (de base)",
    "1.3S, 2WD, automatic": "1.3S, deux roues motrices, automatique", "1953 roadster": "roadster 1953", "1958 coupé": "coupé 1958",
    "1973 450SE": "450SE 1973", "2008 model": "modèle 2008", "2008 model, two seats, lithium-ion battery": "modèle 2008, deux places, batterie lithium-ion",
    "2017 A4 Ultra FWD Premium": "A4 Ultra FWD Premium 2017", "230 G open-top (cheapest)": "230 G découvrable (la moins chère)",
    "3.2 V6, manual": "3.2 V6, boîte manuelle", "40 kWh (base)": "40 kWh (de base)", "55 km Sailing Edition (plug-in hybrid)": "55 km Sailing Edition (hybride rechargeable)",
    "A 140 (1.4 litre, 82 PS)": "A 140 (1,4 litre, 82 ch)", "A3 Sportback Attraction (petrol)": "A3 Sportback Attraction (essence)",
    "A4 1.6 100 ch, automatic": "A4 1.6 100 ch, boîte automatique", "Austin Se7en / Morris Mini-Minor, basic": "Austin Se7en / Morris Mini-Minor, de base",
    "BMW 520 (E12), the first 5 Series": "BMW 520 (E12), la première Série 5", "Base": "de base", "Base (45 PS)": "de base (45 ch)",
    "Base (Mechanic)": "de base (Mechanic)", "Base Fiesta": "Fiesta de base", "Base hardtop": "hardtop de base", "Base model": "modèle de base",
    "Base three-door": "trois portes de base", "Base two-door": "deux portes de base", "Base version": "version de base",
    "Cayenne S (the first, cheapest version)": "Cayenne S (la première et la moins chère)", "Celica XX 2.0 L, standard grade": "Celica XX 2.0 L, finition standard",
    "Cheapest version": "version la moins chère", "Civic 1200 two-door Standard": "Civic 1200 deux portes Standard", "Coupé (first version)": "coupé (première version)",
    "E30 M3 (road version, with catalytic converter)": "M3 E30 (version route, avec catalyseur)", "Eighth generation (C8)": "huitième génération (C8)",
    "Facelift": "restylage", "First generation": "première génération", "First generation (021A)": "première génération (021A)",
    "First generation (E10)": "première génération (E10)", "First generation (NHW10)": "première génération (NHW10)",
    "First generation, Panamera (base)": "première génération, Panamera (de base)", "First generation, cheapest version": "première génération, version la moins chère",
    "First generation, first engine listed": "première génération, premier moteur du tableau", "Five-door, small engines": "cinq portes, petits moteurs",
    "Ford-era Think City": "Think City de l'époque Ford", "Fourth generation (A80)": "quatrième génération (A80)",
    "Fourth generation (C7), four-cylinder diesel Ambiente": "quatrième génération (C7), diesel quatre cylindres Ambiente",
    "Fourth generation, 1.2 12V 70 ch Reference": "quatrième génération, 1.2 12V 70 ch Reference", "G 500 (second generation)": "G 500 (deuxième génération)",
    "Gallardo (first version)": "Gallardo (première version)", "Golf I, cheapest version": "Golf I, version la moins chère",
    "Hummer H1, basic version": "Hummer H1, version de base", "Junior three-door": "Junior trois portes", "LaFerrari (499 cars)": "LaFerrari (499 exemplaires)",
    "Model 3, the first series-produced car": "Modèle 3, la première voiture de série", "Mégane RS Ultime (limited edition)": "Mégane RS Ultime (série limitée)",
    "Polo N (base)": "Polo N (de base)", "Range across versions ($6,360 to $6,650)": "selon les versions (de 6 360 $ à 6 650 $)",
    "Rear-wheel drive (base)": "propulsion (de base)", "Renault 3, the cheapest twin of the R4": "Renault 3, la jumelle la moins chère de la R4",
    "Right-hand drive": "conduite à droite", "Roadster (base)": "Roadster (de base)", "Saloon": "berline", "Second generation": "deuxième génération",
    "Second generation, cheapest": "deuxième génération, la moins chère", "Seventh generation, SS-I": "septième génération, SS-I",
    "Signature (the first cars, limited edition)": "Signature (les premières, série limitée)", "Single motor (announced)": "un moteur (annoncée)",
    "Third generation": "troisième génération", "Third generation (range 11,000 to 17,000 DM)": "troisième génération (de 11 000 à 17 000 DM)",
    "Third generation hatchback": "troisième génération, berline", "Third generation, 1.2 TSI 63 kW": "troisième génération, 1.2 TSI 63 kW",
    "Third generation, special edition": "troisième génération, série spéciale", "Three-door (base)": "trois portes (de base)",
    "Touring car": "Touring", "Two-door": "deux portes", "VN GTS V6, manual": "VN GTS V6, boîte manuelle",
    "Vitz 3-door B Business Package, manual": "Vitz 3 portes B Business Package, boîte manuelle",
    "W 116 (first S-Class), cheapest version": "W 116 (première Classe S), version la moins chère", "With rented battery": "batterie en location",
    "With two airbags and ABS": "avec deux airbags et ABS", "i3 (base)": "i3 (de base)", "Lada 1200": "Lada 1200",
}


def checked_prices():
    """Every price that passed `verify`, from every batch: {title: [price, ...]} with the main one first."""
    out = {}
    for path in sorted(glob.glob(os.path.join(PRICES_DIR, "*", "found", "*.json"))):
        for car in json.load(open(path, encoding="utf-8")):
            good = [p for p in car.get("prices", []) if p.get("quote_ok") and p.get("amount_ok")]
            if good:
                out[car["n"]] = sorted(good, key=lambda p: not p.get("main"))
    return out


def compact(p):
    """A price as stored in the app: short keys, only what the car page shows."""
    site = p.get("site", "")
    rec = {"a": p["amount"], "c": p["currency"], "y": p.get("year"), "k": "l" if p.get("kind") == "list" else "n",
           "m": p.get("market"), "v": p.get("version"), "u": p.get("url"),
           "s": ("w:" + p["source"].split(":", 1)[1]) if p["source"].startswith("wikipedia:") else site.split(" (")[0]}
    if p.get("main"):
        rec["main"] = 1
    rng = re.match(r"between ([\d,.\s]+) and ([\d,.\s]+)$", p.get("approx") or "")
    if rng:  # a range: show "4,000–5,000", not "about 4,000"
        rec["a2"] = float(re.sub(r"[^\d.]", "", rng.group(2).replace(",", "")))
    elif p.get("approx"):
        rec["x"] = APPROX.get(p["approx"], "~")
    if p.get("version") in VERSION_FR and VERSION_FR[p["version"]] != p.get("version"):
        rec["vf"] = VERSION_FR[p["version"]]
    return {k: v for k, v in rec.items() if v is not None}


def cmd_export(args):
    prices = {n: [compact(p) for p in ps] for n, ps in sorted(checked_prices().items())}
    json.dump(prices, open(PRICES_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    missing = sorted({p["v"] for ps in prices.values() for p in ps if p.get("v") and "vf" not in p and re.search(r"[a-z]{3,}", p["v"]) and p["v"] not in VERSION_FR})
    print(f"Wrote {os.path.relpath(PRICES_JSON, ROOT)}: {len(prices)} cars, {sum(map(len, prices.values()))} prices")
    if missing:
        print("Versions without a French form (shown as is):", "; ".join(missing))


def cmd_apply(args):
    """Put data/prices.json into the app's data file as it is (no rebuild): each car gets "pr"."""
    path = os.path.join(ROOT, "data", "verbiest-data.js")
    src = open(path, encoding="utf-8").read()
    head, data = src[: src.index("window.VERBIEST_DATA")], json.loads(src[src.index("{"): src.rindex("}") + 1])
    prices = json.load(open(PRICES_JSON, encoding="utf-8"))
    n = 0
    for c in data["cars"]:
        c.pop("pr", None)
        if c["n"] in prices:
            c["pr"] = prices[c["n"]]
            n += 1
    open(path, "w", encoding="utf-8").write(head + "window.VERBIEST_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Prices added to {n} cars in data/verbiest-data.js")


def cmd_look(args):
    """Search one car's saved article (no download): lines matching a pattern, or every line with money."""
    b = Batch(args.batch)
    entry = json.load(open(b.gathered, encoding="utf-8"))[args.k - 1]
    page = entry["pages"].get(args.lang)
    if not page:
        print(f"{entry['n']}: no {args.lang} article")
        return
    text = page_text(args.lang, page["title"])[0]
    pat = re.compile(args.pattern, re.I) if args.pattern else None
    lines, shown, last = text.split("\n"), 0, -1
    for i, line in enumerate(lines):
        if shown >= args.max:
            break
        if args.context:
            if pat.search(line) if pat else has_money(line):
                for j in range(max(i - args.context, last + 1), min(len(lines), i + args.context + 1)):
                    print(("» " if j == i else "  ") + lines[j][:300])
                last = i + args.context
                print("  ·")
                shown += 1
            continue
        for piece in ([line] if len(line) <= 600 else SENTENCE_END.split(line)):
            if (pat.search(piece) if pat else has_money(piece)) and shown < args.max:
                print("-", piece[:600])
                shown += 1
    print(f"({shown} matches in {args.lang}: {page['title']})")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pick")
    p.add_argument("batch")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--top", type=int, help="the N most famous cars that were on sale")
    g.add_argument("--pilot", action="store_true", help="the first test: random cars from chosen years")
    p.add_argument("--seed", type=int, default=2026)
    p = sub.add_parser("replace", help="swap a car that was never sold")
    p.add_argument("batch")
    p.add_argument("title")
    p.add_argument("--reason", required=True)
    for name in ("gather", "verify"):
        sub.add_parser(name).add_argument("batch")
    sub.add_parser("export", help="write data/prices.json from every batch's checked prices")
    sub.add_parser("apply", help="put data/prices.json into data/verbiest-data.js without a rebuild")
    p = sub.add_parser("look", help="search one car's saved article")
    p.add_argument("batch")
    p.add_argument("k", type=int, help="the car's number in the batch")
    p.add_argument("lang")
    p.add_argument("pattern", nargs="?")
    p.add_argument("--max", type=int, default=25)
    p.add_argument("--context", type=int, default=0, help="also show this many lines before and after")
    args = ap.parse_args()
    {"pick": cmd_pick, "replace": cmd_replace, "gather": cmd_gather, "verify": cmd_verify, "look": cmd_look,
     "export": cmd_export, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    main()
