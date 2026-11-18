"""Stage 2 — turn data/raw/*.json into the app's data file data/verbiest-data.js.

No network access. Works with partial raw data (stages that have not been
downloaded yet are simply skipped), so it can be re-run at any time:

    python3 scripts/build_data.py
"""
import collections
import datetime
import hashlib
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "verbiest-data.js")


def load(name, default):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        print(f"  (missing {name} — skipped)")
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()


def year_of(wd_time):
    """'+1919-06-04T00:00:00Z' -> 1919"""
    if isinstance(wd_time, dict):
        m = re.match(r"([+-]\d+)-", wd_time.get("time", ""))
        if m:
            return int(m.group(1))
    return None


def first_year(ent, prop):
    ys = [year_of(v) for v in ent.get(prop, [])]
    ys = [y for y in ys if y]
    return min(ys) if ys else None


def img_code(filename, free=True):
    """Encode a Wikimedia file as '<repo><md5[:2]>|<File_name>' (see js/util.js)."""
    if not filename:
        return None
    f = filename.replace(" ", "_")
    f = f[0].upper() + f[1:]
    h = hashlib.md5(f.encode("utf-8")).hexdigest()
    return ("c" if free else "e") + h[:2] + "|" + f


# --------------------------------------------------------------- vocabulary
COUNTRY_ALIASES = {
    "West Germany": "Germany", "German Empire": "Germany", "Weimar Republic": "Germany",
    "Nazi Germany": "Germany", "Kingdom of Prussia": "Germany",
    "Kingdom of Italy": "Italy", "Empire of Japan": "Japan",
    "French Third Republic": "France", "French Fourth Republic": "France",
    "Kingdom of Great Britain": "United Kingdom", "England": "United Kingdom", "Scotland": "United Kingdom",
    "Wales": "United Kingdom", "Northern Ireland": "United Kingdom",
    "United Kingdom of Great Britain and Ireland": "United Kingdom",
    "People's Republic of China": "China", "Republic of China": "Taiwan",
    "Russian Empire": "Russia", "Russian Soviet Federative Socialist Republic": "Russia",
    "Kingdom of the Netherlands": "Netherlands", "Austria-Hungary": "Austria",
    "Czech Republic": "Czechia", "Cisleithania": "Austria",
    "Kingdom of Belgium": "Belgium", "Kingdom of Spain": "Spain", "Francoist Spain": "Spain",
    "Second Polish Republic": "Poland", "Polish People's Republic": "Poland",
    "Socialist Federal Republic of Yugoslavia": "Yugoslavia", "Kingdom of Yugoslavia": "Yugoslavia",
    "Korea": "South Korea", "Republic of Korea": "South Korea",
}

# Demonyms found in Wikipedia short descriptions ("American car (1908–1927)")
DEMONYMS = [
    ("East German", "East Germany"), ("West German", "Germany"), ("South Korean", "South Korea"),
    ("North Korean", "North Korea"), ("South African", "South Africa"), ("New Zealand", "New Zealand"),
    ("American", "United States"), ("German", "Germany"), ("French", "France"), ("British", "United Kingdom"),
    ("English", "United Kingdom"), ("Scottish", "United Kingdom"), ("Welsh", "United Kingdom"),
    ("Italian", "Italy"), ("Japanese", "Japan"), ("Chinese", "China"), ("Korean", "South Korea"),
    ("Swedish", "Sweden"), ("Czechoslovak", "Czechoslovakia"), ("Czech", "Czechia"), ("Belgian", "Belgium"),
    ("Dutch", "Netherlands"), ("Australian", "Australia"), ("Spanish", "Spain"), ("Soviet", "Soviet Union"),
    ("Russian", "Russia"), ("Austrian", "Austria"), ("Swiss", "Switzerland"), ("Canadian", "Canada"),
    ("Indian", "India"), ("Brazilian", "Brazil"), ("Argentine", "Argentina"), ("Argentinian", "Argentina"),
    ("Danish", "Denmark"), ("Polish", "Poland"), ("Romanian", "Romania"), ("Turkish", "Turkey"),
    ("Iranian", "Iran"), ("Malaysian", "Malaysia"), ("Taiwanese", "Taiwan"), ("Yugoslav", "Yugoslavia"),
    ("Hungarian", "Hungary"), ("Mexican", "Mexico"), ("Norwegian", "Norway"), ("Finnish", "Finland"),
    ("Portuguese", "Portugal"), ("Irish", "Ireland"), ("Indonesian", "Indonesia"), ("Thai", "Thailand"),
    ("Vietnamese", "Vietnam"), ("Egyptian", "Egypt"), ("Serbian", "Serbia"), ("Ukrainian", "Ukraine"),
]
DEMONYM_RE = re.compile(r"\b(" + "|".join(re.escape(d) for d, _ in DEMONYMS) + r")\b")
DEMONYM_MAP = dict(DEMONYMS)


def country_from_text(text):
    m = DEMONYM_RE.search(text or "")
    return DEMONYM_MAP[m.group(1)] if m else None


# Wikipedia category -> (display tag, body group key, kind key)
TAGS = {
    "Sedans": ("Sedan", "sedan", None),
    "Hatchbacks": ("Hatchback", "hatch", None),
    "Liftbacks": ("Liftback", "hatch", None),
    "Hot hatches": ("Hot hatch", "hatch", "sports"),
    "Station wagons": ("Station wagon", "estate", None),
    "Shooting brakes": ("Shooting brake", "estate", None),
    "Coupés": ("Coupé", "coupe", None),
    "Fastbacks": ("Fastback", "coupe", None),
    "Grand tourers": ("Grand tourer", "coupe", "sports"),
    "Convertibles": ("Convertible", "open", None),
    "Roadsters": ("Roadster", "open", "sports"),
    "Sport utility vehicles": ("SUV", "suv", None),
    "Crossover sport utility vehicles": ("Crossover SUV", "suv", None),
    "Off-road vehicles": ("Off-roader", "suv", None),
    "Minivans": ("Minivan", "van", None),
    "Vans": ("Van", "van", None),
    "Pickup trucks": ("Pickup truck", "van", None),
    "Limousines": ("Limousine", None, "luxury"),
    "Microcars": ("Microcar", None, "small"),
    "Kei cars": ("Kei car", None, "small"),
    "Cyclecars": ("Cyclecar", None, "small"),
    "Three-wheeled motor vehicles": ("Three-wheeler", None, "small"),
    "City cars": ("City car", None, "small"),
    "Subcompact cars": ("Subcompact", None, "small"),
    "Sports cars": ("Sports car", None, "sports"),
    "Supercars": ("Supercar", None, "sports"),
    "Muscle cars": ("Muscle car", None, "sports"),
    "Pony cars": ("Pony car", None, "sports"),
    "Luxury vehicles": ("Luxury", None, "luxury"),
    "Executive cars": ("Executive car", None, "luxury"),
    "Compact cars": ("Compact", None, None),
    "Mid-size cars": ("Mid-size", None, None),
    "Full-size vehicles": ("Full-size", None, None),
    "Racing cars": ("Racing car", None, "racing"),
    "Concept cars": ("Concept car", None, "concept"),
    "Taxi vehicles": ("Taxi", None, None),
    "Production electric cars": ("Electric", None, "electric"),
    "Battery electric vehicles": ("Electric", None, "electric"),
    "Electric vehicles": ("Electric", None, "electric"),
    "Hybrid electric vehicles": ("Hybrid", None, "electric"),
    "Plug-in hybrid vehicles": ("Plug-in hybrid", None, "electric"),
    "Hydrogen cars": ("Hydrogen", None, "electric"),
    "Fuel cell vehicles": ("Fuel cell", None, "electric"),
    "Steam vehicles": ("Steam", None, "steam"),
    "Steam cars": ("Steam", None, "steam"),
    # sub-categories
    "Mini sport utility vehicles": ("SUV", "suv", "small"),
    "Compact sport utility vehicles": ("SUV", "suv", None),
    "Mid-size sport utility vehicles": ("SUV", "suv", None),
    "Full-size sport utility vehicles": ("SUV", "suv", None),
    "Luxury sport utility vehicles": ("SUV", "suv", "luxury"),
    "Kei sport utility vehicles": ("SUV", "suv", "small"),
    "Hybrid sport utility vehicles": ("Hybrid", "suv", "electric"),
    "Sport utility trucks": ("SUV", "suv", None),
    "Subcompact crossover sport utility vehicles": ("Crossover SUV", "suv", None),
    "Compact crossover sport utility vehicles": ("Crossover SUV", "suv", None),
    "Mid-size crossover sport utility vehicles": ("Crossover SUV", "suv", None),
    "Full-size crossover sport utility vehicles": ("Crossover SUV", "suv", None),
    "Luxury crossover sport utility vehicles": ("Crossover SUV", "suv", "luxury"),
    "Sports sedans": ("Sports sedan", "sedan", "sports"),
    "Sport compact cars": ("Sport compact", None, "sports"),
    "Electric sports cars": ("Electric", None, "sports"),
    "Sports racing cars": ("Racing car", None, "racing"),
    "Front-wheel-drive sports cars": ("Sports car", None, "sports"),
    "Flagship vehicles": ("Flagship", None, "luxury"),
    "Personal luxury cars": ("Personal luxury car", "coupe", "luxury"),
}

# Fallback: body style / kind words in the Wikipedia short description
DESC_BODY = [
    (r"\b(suv|sport utility|crossover|off-road(er)?|4x4)\b", "suv"),
    (r"\b(pickup|pick-up|minivan|mpv|people carrier|van|ute)\b", "van"),
    (r"\b(sedan|saloon|limousine)\b", "sedan"),
    (r"\b(hatchback|liftback|hot hatch)\b", "hatch"),
    (r"\b(station wagon|estate( car)?|shooting brake|wagon)\b", "estate"),
    (r"\b(coup[eé]|fastback|grand tourer|gt car)\b", "coupe"),
    (r"\b(convertible|roadster|cabriolet|spider|spyder|speedster|phaeton|tourer)\b", "open"),
]
DESC_KIND = [
    (r"\b(sports? cars?|supercar|hypercar|muscle car|pony car|grand tourer|roadster|hot hatch)\b", "sports"),
    (r"\b(luxury|executive|limousine|flagship)\b", "luxury"),
    (r"\b(city car|microcar|kei car|cyclecar|bubble car|subcompact|three-wheel)", "small"),
    (r"\b(electric|hybrid|fuel cell|hydrogen|ev)\b", "electric"),
    (r"\bsteam\b", "steam"),
    (r"\b(racing car|race car|racecar|formula one|sports prototype|le mans)\b", "racing"),
    (r"\b(concept car|concept vehicle|show car|prototype)\b", "concept"),
]


def from_desc(desc, rules):
    d = (desc or "").lower()
    return [key for rx, key in rules if re.search(rx, d)]


BODY_GROUPS = [  # slot order = colour order
    ("sedan", "Sedan"),
    ("hatch", "Hatchback"),
    ("estate", "Estate / wagon"),
    ("coupe", "Coupé & GT"),
    ("open", "Convertible & roadster"),
    ("suv", "SUV & off-road"),
    ("van", "Van, MPV & pickup"),
]
BODY_PRIORITY = ["suv", "van", "sedan", "hatch", "estate", "coupe", "open"]

KINDS = [
    ("sports", "Sports cars", "Sports cars, GTs, roadsters, supercars, muscle cars"),
    ("luxury", "Luxury", "Luxury, executive cars and limousines"),
    ("small", "Small cars", "City cars, microcars, kei cars, cyclecars"),
    ("electric", "Electric & hybrid", "Battery-electric, hybrid, hydrogen"),
    ("steam", "Steam", "Steam-powered cars"),
    ("racing", "Racing", "Racing cars"),
    ("concept", "Concept cars", "Concept and show cars"),
]

HISTORY = "https://en.wikipedia.org/wiki/History_of_the_automobile"
ERAS = [
    dict(name="Pioneers", short="Pioneers", **{"from": 1660, "to": 1885}, link=HISTORY + "#Steam-powered_wheeled_vehicles",
         text="Steam carriages, early electric experiments and the first internal-combustion engines. From Verbiest’s "
              "toy-sized steam trolley to Cugnot’s artillery tractor and Lenoir’s Hippomobile, inventors proved that a "
              "vehicle could move under its own power — but nobody yet built cars to sell."),
    dict(name="Veteran era", short="Veteran", **{"from": 1886, "to": 1904}, link=HISTORY + "#Horseless_carriage_or_veteran_era",
         text="Karl Benz’s Patent-Motorwagen opens the age of the practical automobile. Steam, electric and petrol cars "
              "compete, steering wheels replace tillers, and the first companies — Panhard et Levassor, Peugeot, Duryea, "
              "Oldsmobile — begin building cars in series."),
    dict(name="Brass era", short="Brass", **{"from": 1905, "to": 1918}, link=HISTORY + "#Brass/Edwardian_era",
         text="Named after the brass lamps and fittings of the day (in Britain, the Edwardian era). Petrol engines win, "
              "the front-engine, rear-drive layout becomes the norm, and Ford’s Model T and moving assembly line put the "
              "car within reach of ordinary families."),
    dict(name="Vintage era", short="Vintage", **{"from": 1919, "to": 1929}, link=HISTORY + "#Vintage_era",
         text="From the end of the First World War to the Wall Street Crash. Closed bodies replace open tourers, controls "
              "are standardised, hydraulic brakes appear, and luxury makers chase ever larger engines."),
    dict(name="Pre-war era", short="Pre-war", **{"from": 1930, "to": 1945}, link=HISTORY + "#Pre-war_era",
         text="The Great Depression and the Second World War. Many makers disappear, while streamlining, integrated "
              "fenders, independent suspension and front-wheel drive point the way to the modern car."),
    dict(name="Post-war era", short="Post-war", **{"from": 1946, "to": 1985}, link=HISTORY + "#Postwar_era",
         text="Recovery and mass motoring: pontoon bodies, small economy cars such as the Beetle, 2CV and Mini, American "
              "tailfins and muscle cars — then the oil crises of the 1970s and the rise of Japanese makers."),
    dict(name="Modern era", short="Modern", **{"from": 1986, "to": 2100}, link=HISTORY + "#Modern_era",
         text="Platform sharing, electronics, safety and emissions rules shape the car. SUVs boom worldwide, and in the "
              "21st century hybrids and battery-electric cars move from niche to mainstream."),
]


def main():
    print("Building data/verbiest-data.js")
    cars_raw = load("cars.json", {"cars": {}})["cars"]
    car_wd = load("car_wikidata.json", {})
    mk_raw = load("makers.json", {"wikidata": {}, "pages": {}})
    maker_wd, maker_pages = mk_raw["wikidata"], mk_raw["pages"]
    country_wd = load("countries.json", {})
    milestones_raw = load("milestones.json", [])
    tag_members = load("tags.json", {})
    disc = load("discontinued.json", {})

    # ---------------------------------------------------------- countries
    def country_name(qid):
        e = country_wd.get(qid)
        if not e or not e.get("label"):
            return None
        return COUNTRY_ALIASES.get(e["label"], e["label"])

    # ---------------------------------------------------------- makers
    enwiki_ent = {}  # article title -> entity qid (entity that *is* that article)
    for q, e in maker_wd.items():
        if e.get("enwiki"):
            enwiki_ent.setdefault(e["enwiki"], q)

    def resolve_article(q, depth=0):
        e = maker_wd.get(q)
        if not e:
            return None
        if e.get("enwiki"):
            return e["enwiki"]
        if depth < 2:
            for p in ("P176", "P127", "P749"):
                for q2 in e.get(p, []):
                    a = resolve_article(q2, depth + 1)
                    if a:
                        return a
        return None

    makers = {}  # key (article or qid) -> record

    def maker_key_for(q):
        e = maker_wd.get(q)
        if not e or not e.get("label"):
            return None
        art = resolve_article(q)
        key = art or ("Q:" + q)
        rec = makers.get(key)
        if rec is None:
            art_ent = maker_wd.get(enwiki_ent.get(art)) if art else None
            rec = makers[key] = {"labels": set(), "article": art, "ents": [], "art_ent": art_ent}
        rec["labels"].add(e["label"])
        if q not in rec["ents"]:
            rec["ents"].append(q)
        return key

    def pick_maker(e, title):
        tnorm = norm(title)
        brands = [q for q in e.get("P1716", []) if q in maker_wd]
        mfrs = [q for q in e.get("P176", []) if q in maker_wd]

        def in_title(q):
            lab = norm(maker_wd[q].get("label"))
            return lab and (tnorm.startswith(lab) or tnorm.startswith(lab.split(" ")[0]))

        for group in (brands, mfrs):
            for q in group:
                if in_title(q):
                    return q
        return (brands or mfrs or [None])[0]

    car_maker_key = {}
    for pid, c in cars_raw.items():
        e = car_wd.get(c.get("qid") or "", {})
        q = pick_maker(e, c["title"]) if e else None
        if q:
            k = maker_key_for(q)
            if k:
                car_maker_key[pid] = k

    # prefix fallback for cars without Wikidata maker
    def display_name(rec):
        labs = sorted(rec["labels"], key=lambda s: (len(s), s))
        return labs[0]

    prefix_index = sorted(((norm(display_name(r)), k) for k, r in makers.items()), key=lambda x: -len(x[0]))
    for pid, c in cars_raw.items():
        if pid in car_maker_key:
            continue
        t = norm(c["title"])
        for pref, k in prefix_index:
            if len(pref) >= 3 and (t.startswith(pref + " ") or t.startswith(pref + "-")):
                car_maker_key[pid] = k
                break

    # ---------------------------------------------------------- tags per car
    car_tags = collections.defaultdict(set)
    for cat, ids in tag_members.items():
        if cat in TAGS:
            for pid in ids:
                car_tags[str(pid)].add(cat)

    # ---------------------------------------------------------- assemble cars
    cars = []
    for pid, c in cars_raw.items():
        title = c["title"]
        if title.startswith("List of") or not c.get("intro"):
            continue
        y = min(c["intro"])
        e = car_wd.get(c.get("qid") or "", {})
        ends = [d for d in disc.get(pid, []) if d >= y]
        end = max(ends) if ends else None
        mk = car_maker_key.get(pid)
        # country: car's country of origin, else maker's country
        cname = None
        for q in e.get("P495", []):
            cname = country_name(q)
            if cname:
                break
        if not cname:
            cname = country_from_text(c.get("desc"))
        if not cname and mk:
            rec = makers[mk]
            for q in rec["ents"] + ([enwiki_ent.get(rec["article"])] if rec["article"] else []):
                ent = maker_wd.get(q) or {}
                for cq in ent.get("P17", []) + ent.get("P495", []):
                    cname = country_name(cq)
                    if cname:
                        break
                if cname:
                    break
        if not cname:
            cname = country_from_text(e.get("desc"))
        cats = car_tags.get(pid, set())
        bodies = {TAGS[cat][1] for cat in cats if TAGS[cat][1]}
        desc_txt = c.get("desc") or e.get("desc") or ""
        if not bodies:
            bodies = set(from_desc(desc_txt, DESC_BODY))
        body = next((b for b in BODY_PRIORITY if b in bodies), None)
        kinds = {TAGS[cat][2] for cat in cats if TAGS[cat][2]} | set(from_desc(desc_txt, DESC_KIND))
        if "Electric sports cars" in cats:
            kinds.add("electric")
        tag_names = []
        for cat in sorted(cats, key=lambda x: list(TAGS).index(x)):
            if TAGS[cat][0] not in tag_names:
                tag_names.append(TAGS[cat][0])
        img = c.get("img")
        img_c = img_code(img, c.get("img_free", True)) if img else None
        if not img_c and e.get("P18"):
            img_c = img_code(e["P18"][0])
        cars.append({
            "pid": pid, "n": title, "y": y, "e": end, "mk": mk, "country": cname,
            "body": body, "kinds": kinds, "tags": tag_names, "i": img_c,
            "s": c.get("desc") or e.get("desc"), "p": e.get("sitelinks") or 1, "len": c.get("len") or 0,
        })
    print(f"  {len(cars)} cars")

    # ---------------------------------------------------------- maker records
    used_makers = collections.Counter(c["mk"] for c in cars if c["mk"])
    maker_list = []
    maker_index = {}
    for k, rec in makers.items():
        if not used_makers.get(k):
            continue
        ents = [maker_wd[q] for q in rec["ents"]]
        art_ent = rec["art_ent"] or {}
        allents = ents + [art_ent]
        founded = next((first_year(x, "P571") for x in allents if first_year(x, "P571")), None)
        defunct = next((first_year(x, "P576") for x in allents if first_year(x, "P576")), None)
        if founded and defunct and defunct < founded:
            defunct = None
        cname = None
        for x in allents:
            for cq in x.get("P17", []) + x.get("P495", []):
                cname = country_name(cq)
                if cname:
                    break
            if cname:
                break
        logo = None
        for x in allents:
            if x.get("P154"):
                logo = img_code(x["P154"][0])
                break
        page = maker_pages.get(rec["article"]) if rec["article"] else None
        if not cname:
            cname = country_from_text((page or {}).get("desc")) or next(
                (country_from_text(x.get("desc")) for x in allents if country_from_text(x.get("desc"))), None)
        img = logo
        if not img and page and page.get("img"):
            img = img_code(page["img"], page.get("img_free", True))
        if not img:
            for x in allents:
                if x.get("P18"):
                    img = img_code(x["P18"][0])
                    break
        desc = (page or {}).get("desc") or next((x.get("desc") for x in allents if x.get("desc")), None)
        name = display_name(rec)
        maker_index[k] = len(maker_list)
        maker_list.append({
            "n": name, "a": rec["article"], "country": cname, "f": founded, "d": defunct,
            "i": img, "logo": bool(logo), "s": desc,
            "p": max([x.get("sitelinks", 0) for x in allents] + [1]),
        })
    # disambiguate duplicate display names
    seen = collections.Counter(m["n"] for m in maker_list)
    for m in maker_list:
        if seen[m["n"]] > 1 and m["a"] and m["a"] != m["n"]:
            m["n"] = m["a"]
    print(f"  {len(maker_list)} makers")

    # ---------------------------------------------------------- country groups
    cc = collections.Counter(c["country"] for c in cars if c["country"])
    for m in maker_list:
        if m["country"] and m["country"] not in cc:
            cc[m["country"]] += 0
    # the 7 countries with most models get their own colour; they are stacked in a
    # fixed, historical order (early car nations at the bottom), not by count
    preferred = ["United States", "Germany", "France", "United Kingdom", "Italy", "Japan", "China",
                 "South Korea", "Soviet Union", "Russia", "Sweden", "India", "Czechia", "Spain"]
    top = [n for n, _ in cc.most_common(7)]
    top.sort(key=lambda n: preferred.index(n) if n in preferred else 99)
    groups_country = [{"n": n} for n in top] + [{"n": "Other countries", "other": True}]
    country_names = sorted(cc, key=lambda n: (-cc[n], n))
    country_idx = {n: i for i, n in enumerate(country_names)}
    countries = [{"n": n, "g": top.index(n) if n in top else len(top)} for n in country_names]
    print("  top countries:", ", ".join(f"{n} ({cc[n]})" for n in top))

    # ---------------------------------------------------------- output records
    tag_list = sorted({t for c in cars for t in c["tags"]})
    tag_idx = {t: i for i, t in enumerate(tag_list)}
    body_idx = {k: i for i, (k, _) in enumerate(BODY_GROUPS)}
    kind_counts = collections.Counter(k for c in cars for k in c["kinds"])
    kinds = [k for k in KINDS if kind_counts[k[0]] >= 10]
    kind_bit = {k[0]: 1 << i for i, k in enumerate(kinds)}

    out_cars = []
    for c in sorted(cars, key=lambda c: (c["y"], c["n"])):
        rec = {"n": c["n"], "y": c["y"]}
        if c["e"]:
            rec["e"] = c["e"]
        rec["m"] = maker_index.get(c["mk"], -1) if c["mk"] else -1
        rec["c"] = country_idx.get(c["country"], -1) if c["country"] else -1
        rec["b"] = body_idx.get(c["body"], len(BODY_GROUPS))
        k = 0
        for kk in c["kinds"]:
            k |= kind_bit.get(kk, 0)
        if k:
            rec["k"] = k
        if c["tags"]:
            rec["t"] = [tag_idx[t] for t in c["tags"]]
        if c["i"]:
            rec["i"] = c["i"]
        if c["s"]:
            rec["s"] = c["s"]
        rec["p"] = c["p"]
        out_cars.append(rec)
    for c in out_cars:
        c.setdefault("k", 0)

    out_makers = []
    for m in maker_list:
        rec = {"n": m["n"], "a": m["a"], "c": country_idx.get(m["country"], -1) if m["country"] else -1,
               "f": m["f"], "d": m["d"], "p": m["p"]}
        if m["i"]:
            rec["i"] = m["i"]
            if m["logo"]:
                rec["logo"] = 1
        if m["s"]:
            rec["s"] = m["s"]
        out_makers.append(rec)

    def trim_extract(t, limit=1400):
        paras = [p.strip() for p in (t or "").split("\n") if len(p.strip()) > 1]
        out, n = [], 0
        for p in paras:
            if n + len(p) > limit and out:
                break
            out.append(p)
            n += len(p)
        return "\n".join(out)

    out_ms = []
    for m in milestones_raw:
        rec = {"year": m["year"], "label": m["label"], "title": m.get("title")}
        if m.get("desc"):
            rec["s"] = m["desc"]
        if m.get("extract"):
            rec["x"] = trim_extract(m["extract"])
        if m.get("img"):
            rec["i"] = img_code(m["img"], m.get("img_free", True))
        out_ms.append(rec)

    years = [c["y"] for c in out_cars] or [1860, datetime.date.today().year]
    last_year = max(max(years), datetime.date.today().year)
    eras = []
    for e in ERAS:
        e = dict(e)
        e["to"] = min(e["to"], last_year)
        eras.append(e)

    data = {
        "generated": datetime.date.today().isoformat(),
        "firstYear": min(years),
        "lastYear": last_year,
        "countries": countries,
        "dims": {
            "country": {"groups": groups_country},
            "body": {"groups": [{"n": n} for _, n in BODY_GROUPS] + [{"n": "Not stated", "other": True}]},
        },
        "kinds": [{"k": k, "n": n, "hint": hint} for k, n, hint in kinds],
        "tags": tag_list,
        "makers": out_makers,
        "cars": out_cars,
        "milestones": out_ms,
        "eras": eras,
    }
    js = "/* Generated by scripts/build_data.py from Wikipedia + Wikidata — do not edit by hand. */\n"
    js += "window.VERBIEST_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"  wrote {os.path.relpath(OUT, ROOT)} ({len(js.encode('utf-8')) / 1e6:.2f} MB)")
    with_maker = sum(1 for c in out_cars if c["m"] >= 0)
    with_country = sum(1 for c in out_cars if c["c"] >= 0)
    with_img = sum(1 for c in out_cars if c.get("i"))
    with_body = sum(1 for c in out_cars if c["b"] < len(BODY_GROUPS))
    n = max(1, len(out_cars))
    print(f"  coverage: maker {with_maker / n:.0%}, country {with_country / n:.0%}, image {with_img / n:.0%}, body {with_body / n:.0%}")


if __name__ == "__main__":
    main()
