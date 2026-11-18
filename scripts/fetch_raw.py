"""Stage 1 — download raw data from Wikipedia + Wikidata into data/raw/.

Sources
  * Wikipedia categories "Cars introduced in <year>"  -> the list of car models
    (+ short description, lead image and Wikidata id of every article)
  * Wikidata  -> brand / manufacturer, country of origin, popularity
                 (= number of Wikipedia language editions covering the car)
  * Wikipedia/Wikidata for every brand / manufacturer found
  * A curated list of milestone articles from the history of the automobile
  * Wikipedia body-style / class / power categories (Sedans, Roadsters, ...)
  * Wikipedia categories "Cars discontinued in <year>"

Requests are kept to a minimum (~550) because anonymous API clients are
limited to ~10 requests/minute. Set VERBIEST_CONTACT (see wikiapi.py) to go
~15x faster. Every response is cached, so the script can be stopped and
restarted at any time; each stage writes its own file to data/raw/.

Run:  python3 scripts/fetch_raw.py
"""
import json
import os
import re
import sys
import time

from wikiapi import STATS, WIKIPEDIA_API, chunks, get_json, query_all, wikidata_entities

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
os.makedirs(RAW, exist_ok=True)
T0 = time.time()


def log(*a):
    m, s = divmod(int(time.time() - T0), 60)
    print(f"[{m:02d}:{s:02d}] net={STATS['network']} cache={STATS['cached']} |", *a,
          file=sys.stderr, flush=True)


def save(name, obj):
    with open(os.path.join(RAW, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    log("saved", name)


# ------------------------------------------------------------------ helpers
def year_categories(prefix):
    _, lists = query_all({"list": "allcategories", "acprefix": prefix, "aclimit": "max"})
    out = {}
    for c in lists.get("allcategories", []):
        name = c["category"]
        m = re.fullmatch(re.escape(prefix) + r" (\d{4})", name)
        if m:
            out[int(m.group(1))] = name
    return dict(sorted(out.items()))


def members_with_props(cat):
    """All articles of a category, with short description, Wikidata id and lead image."""
    pages, _ = query_all({
        "generator": "categorymembers", "gcmtitle": "Category:" + cat,
        "gcmnamespace": "0", "gcmlimit": "max",
        "prop": "pageprops|info",
        "ppprop": "wikibase_item|wikibase-shortdesc|page_image_free|page_image|disambiguation",
    })
    return pages


def member_ids(cat):
    _, lists = query_all({"list": "categorymembers", "cmtitle": "Category:" + cat,
                          "cmnamespace": "0", "cmlimit": "max", "cmprop": "ids"})
    return [m["pageid"] for m in lists.get("categorymembers", [])]


def slim_page(p):
    pp = p.get("pageprops", {})
    return {
        "title": p.get("title"),
        "len": p.get("length"),
        "desc": pp.get("wikibase-shortdesc"),
        "qid": pp.get("wikibase_item"),
        "img": pp.get("page_image_free") or pp.get("page_image"),
        "img_free": bool(pp.get("page_image_free")),
    }


def titles_with_props(titles, extracts=False):
    """Page props (and optionally intro extracts) for a list of titles, following redirects."""
    out = {}
    size = 20 if extracts else 50
    for batch in chunks(titles, size):
        params = {"titles": "|".join(batch), "redirects": "1", "prop": "pageprops|info",
                  "ppprop": "wikibase_item|wikibase-shortdesc|page_image_free|page_image"}
        if extracts:
            params["prop"] += "|extracts"
            params.update({"exintro": "1", "explaintext": "1", "exlimit": "20"})
        pages, lists = query_all(params)
        alias = {}
        for k in ("normalized", "redirects"):
            for r in lists.get(k, []):
                alias[r["from"]] = r["to"]
        by_title = {p["title"]: p for p in pages.values() if p.get("pageid")}
        for t in batch:
            cur = t
            for _ in range(3):
                cur = alias.get(cur, cur)
            p = by_title.get(cur)
            if p:
                rec = slim_page(p)
                rec["pageid"] = p["pageid"]
                if extracts:
                    rec["extract"] = p.get("extract", "")
                out[t] = rec
    return out


def claim_ids(ent, prop):
    out = []
    for s in ent.get("claims", {}).get(prop, []):
        if s.get("rank") == "deprecated":
            continue
        v = s.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v:
            out.append(v["id"])
    return out


def claim_values(ent, prop):
    out = []
    for s in ent.get("claims", {}).get(prop, []):
        if s.get("rank") == "deprecated":
            continue
        v = s.get("mainsnak", {}).get("datavalue", {}).get("value")
        if v is not None:
            out.append(v)
    return out


def slim_entity(ent):
    keep_items = ["P31", "P17", "P176", "P1716", "P495", "P127", "P749", "P159", "P740", "P30"]
    keep_vals = ["P571", "P576", "P2669", "P154", "P18", "P297", "P856"]
    out = {
        "label": ent.get("labels", {}).get("en", {}).get("value"),
        "desc": ent.get("descriptions", {}).get("en", {}).get("value"),
        "enwiki": ent.get("sitelinks", {}).get("enwiki", {}).get("title"),
        "sitelinks": len(ent.get("sitelinks", {})),
    }
    for p in keep_items:
        ids = claim_ids(ent, p)
        if ids:
            out[p] = ids
    for p in keep_vals:
        vals = claim_values(ent, p)
        if vals:
            out[p] = vals
    return out


def fetch_entities(ids):
    ents = wikidata_entities(ids, props="labels|descriptions|claims|sitelinks")
    return {q: slim_entity(e) for q, e in ents.items()}


# ------------------------------------------------------------------ curated lists
MILESTONES = [
    # (year, article title, short label)
    (1672, "Ferdinand Verbiest", "Verbiest's steam trolley"),
    (1769, "Fardier à vapeur", "Cugnot's steam fardier"),
    (1801, "Puffing Devil", "Trevithick's Puffing Devil"),
    (1807, "François Isaac de Rivaz", "De Rivaz's hydrogen-engined car"),
    (1863, "Hippomobile", "Lenoir's Hippomobile"),
    (1881, "Gustave Trouvé", "Trouvé's electric tricycle"),
    (1886, "Benz Patent-Motorwagen", "Benz Patent-Motorwagen"),
    (1888, "Bertha Benz", "Bertha Benz's long-distance drive"),
    (1894, "Paris–Rouen (motor race)", "First motor competition"),
    (1899, "La Jamais Contente", "First car over 100 km/h"),
    (1901, "Mercedes 35 hp", "The first 'modern' car"),
    (1908, "Ford Model T", "Ford Model T"),
    (1913, "Assembly line", "Moving assembly line"),
    (1923, "1923 24 Hours of Le Mans", "First 24 Hours of Le Mans"),
    (1934, "Citroën Traction Avant", "Front-wheel drive & monocoque"),
    (1938, "Volkswagen Beetle", "Volkswagen Beetle"),
    (1948, "Citroën 2CV", "Citroën 2CV"),
    (1950, "1950 Formula One season", "First Formula One season"),
    (1955, "Citroën DS", "Citroën DS"),
    (1959, "Mini (marque)", "The Mini"),
    (1964, "Ford Mustang (first generation)", "Ford Mustang"),
    (1966, "Toyota Corolla", "Toyota Corolla"),
    (1973, "1973 oil crisis", "1973 oil crisis"),
    (1974, "Volkswagen Golf Mk1", "Volkswagen Golf"),
    (1997, "Toyota Prius", "Toyota Prius, mass-market hybrid"),
    (2008, "Tesla Roadster (first generation)", "Tesla Roadster"),
    (2023, "Tesla Model Y", "An electric car becomes the world's best-seller"),
]

TAG_CATEGORIES = [
    # body styles
    "Sedans", "Hatchbacks", "Station wagons", "Coupés", "Convertibles", "Roadsters",
    "Sport utility vehicles", "Crossover sport utility vehicles", "Pickup trucks",
    "Minivans", "Vans", "Limousines", "Microcars", "Kei cars", "Shooting brakes",
    "Liftbacks", "Fastbacks", "Cyclecars", "Off-road vehicles", "Three-wheeled motor vehicles",
    # character / class
    "Sports cars", "Grand tourers", "Supercars", "Muscle cars", "Pony cars", "Hot hatches",
    "Luxury vehicles", "Executive cars", "Compact cars", "Subcompact cars", "City cars",
    "Mid-size cars", "Full-size vehicles", "Racing cars", "Concept cars", "Taxi vehicles",
    # power
    "Production electric cars", "Battery electric vehicles", "Electric vehicles",
    "Hybrid electric vehicles", "Plug-in hybrid vehicles", "Steam vehicles", "Steam cars",
    "Hydrogen cars", "Fuel cell vehicles",
    # sub-categories (most SUVs, for example, are only filed in these)
    "Mini sport utility vehicles", "Compact sport utility vehicles", "Mid-size sport utility vehicles",
    "Full-size sport utility vehicles", "Luxury sport utility vehicles", "Kei sport utility vehicles",
    "Hybrid sport utility vehicles", "Sport utility trucks",
    "Subcompact crossover sport utility vehicles", "Compact crossover sport utility vehicles",
    "Mid-size crossover sport utility vehicles", "Full-size crossover sport utility vehicles",
    "Luxury crossover sport utility vehicles",
    "Sports sedans", "Sport compact cars", "Electric sports cars", "Sports racing cars",
    "Front-wheel-drive sports cars", "Flagship vehicles", "Personal luxury cars",
]


# ------------------------------------------------------------------ main
def main():
    # A. car models ----------------------------------------------------------
    log("A. 'Cars introduced in <year>' categories")
    intro_cats = year_categories("Cars introduced in")
    cars = {}
    for year, cat in intro_cats.items():
        for pid, p in members_with_props(cat).items():
            rec = cars.setdefault(str(pid), slim_page(p))
            rec.setdefault("intro", []).append(year)
        if year % 10 == 0:
            log(f"   up to {year}: {len(cars)} articles")
    save("cars.json", {"categories": intro_cats, "cars": cars})

    # B. Wikidata for every car ----------------------------------------------
    log("B. Wikidata for cars")
    qids = sorted({c["qid"] for c in cars.values() if c.get("qid")})
    car_wd = {}
    for i, batch in enumerate(chunks(qids, 500)):
        car_wd.update(fetch_entities(batch))
        log(f"   {len(car_wd)}/{len(qids)}")
    save("car_wikidata.json", car_wd)

    # C. makers ---------------------------------------------------------------
    log("C. makers")
    maker_ids = set()
    for e in car_wd.values():
        maker_ids.update(e.get("P1716", []))
        maker_ids.update(e.get("P176", []))
    makers = fetch_entities(maker_ids)
    hop = set()
    for e in makers.values():
        if not e.get("enwiki"):
            hop.update(e.get("P176", []) + e.get("P127", []) + e.get("P749", []))
    makers.update(fetch_entities(hop - set(makers)))
    maker_titles = sorted({e["enwiki"] for e in makers.values() if e.get("enwiki")})
    maker_pages = titles_with_props(maker_titles)
    save("makers.json", {"wikidata": makers, "pages": maker_pages})

    # D. countries -------------------------------------------------------------
    log("D. countries")
    cids = set()
    for e in list(car_wd.values()) + list(makers.values()):
        cids.update(e.get("P495", []) + e.get("P17", []))
    countries = fetch_entities(cids)
    save("countries.json", countries)

    # E. milestones ------------------------------------------------------------
    log("E. milestones")
    ms_pages = titles_with_props([t for _, t, _ in MILESTONES], extracts=True)
    ms = []
    for year, title, label in MILESTONES:
        if title not in ms_pages:
            log("   ! missing milestone article:", title)
            continue
        ms.append({"year": year, "title": title, "label": label, **ms_pages[title]})
    save("milestones.json", ms)

    # F. body style / class / power categories --------------------------------
    log("F. tag categories")
    tags = {}
    for cat in TAG_CATEGORIES:
        ids = member_ids(cat)
        if ids:
            tags[cat] = ids
        log(f"   {cat}: {len(ids)}")
    save("tags.json", tags)

    # G. discontinuation years --------------------------------------------------
    log("G. 'Cars discontinued in <year>'")
    disc_cats = year_categories("Cars discontinued in")
    disc = {}
    for year, cat in disc_cats.items():
        for pid in member_ids(cat):
            disc.setdefault(str(pid), []).append(year)
        if year % 10 == 0:
            log(f"   up to {year}: {len(disc)} articles")
    save("discontinued.json", disc)
    log("done")


if __name__ == "__main__":
    main()
