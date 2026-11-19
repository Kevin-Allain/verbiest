"""Company ownership over time ("who owns whom"), for the ownership graph.

Built from Wikidata statements on the makers' items (and on their parents):
  P127 owned by, P749 parent organization        (statement on the child)
  P355 subsidiary, P1830 owner of                 (statement on the parent)
with the qualifiers P580 start time, P582 end time and P1107 proportion.

Rules
  * minority stakes (proportion < 50 %) are skipped;
  * a maker's brand item and company item are merged into one node, so a
    brand "owned by" its own company is not an edge;
  * people and families are not owners here (the graph is about companies);
  * statements without dates are flagged as approximate (drawn dashed). They
    usually describe today's owner, so they start at the latest of: either
    company's founding, the end of the child's previous dated owner, and ten
    years ago; unless the child was founded by its parent (or carries its
    name, e.g. "Ford Australia"), in which case they start at its founding;
  * governments and state bodies are left out;
  * a short hand-checked list (FIXES) fills well-known gaps; those edges are
    flagged too. Everything else comes from Wikidata as is.

Output (compact, see js/app.js):
  {"nodes": [[makerIndex or -1, name, logo, founded, defunct, enwiki title (other companies)], ...],
   "links": [[child, parent, from, to, flags], ...]}   flags: 1 estimated start, 4 hand-added
"""
import collections
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")

NOT_COMPANIES = {"Q5", "Q8436", "Q13417114", "Q17350442"}  # human, family, noble family, person group
# governments and state bodies own many companies; they are left out to keep the graph about car groups
GOVERNMENT = {"Q11204", "Q327333", "Q2659904", "Q7188", "Q6256", "Q3624078", "Q35798", "Q1802419", "Q192350", "Q4471",
              "Q1615742", "Q10864048", "Q107390", "Q34876", "Q515", "Q1549591"}  # + provinces, states, cities
GOVERNMENT_NAME = re.compile(r"\b(Congress|Commission|Government|Ministry|Republic|Kingdom|State Council|Assets Supervision|Treasury|Federal)\b", re.I)

# (child, parent, from, to). Names are maker names as shown in the app, or
# Wikidata labels of parent companies. Only well-documented acquisitions.
FIXES = [
    ("Lamborghini", "Chrysler", 1987, 1994),
    ("Lamborghini", "Audi", 1998, None),
    ("Audi", "Volkswagen Group", 1965, None),
    ("Bentley", "Rolls-Royce Limited", 1931, 1971),
    ("Bentley", "Vickers", 1980, 1998),
    ("Bentley", "Volkswagen Group", 1998, None),
    ("Rolls-Royce Motor Cars", "BMW", 1998, None),
    ("Bugatti Automobiles S.A.S.", "Volkswagen Group", 1998, None),
    ("Aston Martin", "Ford", 1987, 2007),
    ("Volvo Cars", "Ford", 1999, 2010),
    ("Volvo Cars", "Geely", 2010, None),
    ("Land Rover", "BMW", 1994, 2000),
    ("Land Rover", "Ford", 2000, 2008),
    ("Land Rover", "Tata Motors Limited", 2008, None),
    ("Lotus Cars", "General Motors", 1986, 1993),
    ("Lotus Cars", "Proton", 1996, 2017),
    ("Lotus Cars", "Geely", 2017, None),
    ("Maserati", "Citroën", 1968, 1975),
    ("Maserati", "Fiat", 1993, 2014),
    ("Ferrari", "Fiat", 1969, 2016),
    ("Lancia", "Fiat", 1969, 2014),
    ("Alfa Romeo", "Fiat", 1986, 2014),
    ("Abarth", "Fiat", 1971, 2014),
    ("Chrysler", "Cerberus Capital Management", 2007, 2009),
    ("Jeep", "American Motors Corporation", 1970, 1987),
    ("Jeep", "Chrysler", 1987, 2014),
    ("Dodge", "Chrysler", 1928, 2014),
    ("Škoda", "Volkswagen Group", 1991, None),
    ("SEAT", "Volkswagen Group", 1986, None),
    ("Porsche", "Volkswagen Group", 2012, None),
    ("Volkswagen Group", "Porsche Automobil Holding SE", 2009, None),
    ("Citroën", "Michelin", 1935, 1976),
    ("Citroën", "Groupe PSA", 1976, 2021),
    ("Peugeot", "Groupe PSA", 1976, 2021),
    ("Vauxhall", "General Motors", 1925, 2017),
    ("Vauxhall", "Groupe PSA", 2017, 2021),
    ("Holden", "General Motors", 1931, 2020),
    ("Saturn", "General Motors", 1985, 2010),
    ("Hummer", "General Motors", 1998, 2010),
    ("Daewoo Motors", "General Motors", 2002, 2011),
    ("Dacia", "Renault", 1999, None),
    ("Alpine", "Renault", 1973, None),
    ("Kia", "Hyundai", 1998, None),
    ("Mercury", "Ford", 1938, 2011),
    ("Lincoln Motor Company", "Ford", 1922, None),
    ("Simca", "Chrysler Europe", 1963, 1978),
    ("Talbot", "Groupe PSA", 1978, None),
    ("Rover", "British Aerospace", 1988, 1994),
    ("Rover", "BMW", 1994, 2000),
    ("MG Motor", "SAIC Motor", 2007, None),
    ("Polestar", "Volvo Cars", 1996, None),
]


def _year(snak):
    v = (snak or {}).get("datavalue", {}).get("value", {})
    m = re.match(r"([+-]\d+)-", v.get("time", "")) if isinstance(v, dict) else None
    return int(m.group(1)) if m else None


def _first_year(ent, prop):
    ys = [_year(c.get("mainsnak")) for c in ent.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated"]
    ys = [y for y in ys if y]
    return min(ys) if ys else None


def _label(ent):
    return ((ent or {}).get("labels") or {}).get("en", {}).get("value")


def load_cached_entities():
    """Every Wikidata entity (with claims) found in the API cache."""
    ents = {}
    for path in glob.glob(os.path.join(CACHE, "*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        if isinstance(d, dict) and isinstance(d.get("entities"), dict):
            for q, e in d["entities"].items():
                if isinstance(e, dict) and "claims" in e:
                    ents[q] = e
    return ents


def _statements(ent, q):
    """(child, parent, start, end, rank) for ownership statements on `ent` (item q)."""
    out = []
    for prop, inverse in (("P127", False), ("P749", False), ("P355", True), ("P1830", True)):
        for c in ent.get("claims", {}).get(prop, []):
            if c.get("rank") == "deprecated":
                continue
            v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
            if not isinstance(v, dict) or "id" not in v:
                continue
            ql = c.get("qualifiers", {})
            share = (ql.get("P1107") or [{}])[0].get("datavalue", {}).get("value", {})
            share = float(share["amount"]) if isinstance(share, dict) and share.get("amount") else None
            if share is not None and share > 1:
                share /= 100.0
            if share is not None and share < 0.5:
                continue
            a, b = _year((ql.get("P580") or [None])[0]), _year((ql.get("P582") or [None])[0])
            child, parent = (v["id"], q) if inverse else (q, v["id"])
            out.append((child, parent, a, b, c.get("rank")))
    return out


def build(maker_list, maker_qids, fetch_entities=None, current_year=2026, fetch_sitelinks=None):
    """maker_list: the app's makers (dicts with n, i, logo, f, d); maker_qids: list of QID sets.
    fetch_entities(ids) -> {qid: entity} is used for parent companies missing from the cache."""
    ents = load_cached_entities()
    node_of = {}                       # qid -> node key
    for i, qs in enumerate(maker_qids):
        for q in qs:
            node_of.setdefault(q, ("m", i))

    # walk up from the makers, collecting statements (depth-limited)
    raw = []
    frontier = {q for qs in maker_qids for q in qs}
    seen = set()
    for depth in range(4):
        missing = [q for q in frontier if q not in ents]
        if missing and fetch_entities:
            print(f"    fetching {len(missing)} parent companies from Wikidata (level {depth + 1})")
            ents.update(fetch_entities(missing))
        nxt = set()
        for q in frontier:
            if q in seen or q not in ents:
                continue
            seen.add(q)
            for st in _statements(ents[q], q):
                raw.append(st)
                nxt.update((st[0], st[1]))
        frontier = nxt - seen
        if not frontier:
            break

    def kinds_of(q):
        return {c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
                for c in ents.get(q, {}).get("claims", {}).get("P31", [])}

    def is_company(q):
        if q not in ents:
            return True
        if kinds_of(q) & (NOT_COMPANIES | GOVERNMENT):
            return False
        return not GOVERNMENT_NAME.search(_label(ents[q]) or "")

    # nodes
    nodes, key_index = [], {}

    def node(key):
        if key in key_index:
            return key_index[key]
        if key[0] == "m":
            m = maker_list[key[1]]
            rec = [key[1], m["n"], m["i"] if m.get("logo") else None, m.get("f"), m.get("d")]
        elif key[0] == "q":
            e = ents.get(key[1], {})
            logo = None
            for c in e.get("claims", {}).get("P154", []):
                v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                if isinstance(v, str):
                    logo = v
                    break
            wiki = ((e.get("sitelinks") or {}).get("enwiki") or {}).get("title")
            rec = [-1, _label(e) or key[1], logo, _first_year(e, "P571"), _first_year(e, "P576"), wiki]
        else:  # hand-added company with no Wikidata item in the cache
            rec = [-1, key[1], None, None, None]
        key_index[key] = len(nodes)
        nodes.append(rec)
        return key_index[key]

    maker_by_name = {}
    for i, m in enumerate(maker_list):
        maker_by_name.setdefault(m["n"], i)

    def key_for(q):
        if q in node_of:
            return node_of[q]
        lab = _label(ents.get(q))
        if lab in maker_by_name:      # same name as one of the app's makers: treat as that maker
            return ("m", maker_by_name[lab])
        return ("q", q)

    # merge statements into links (child, parent) -> list of (start, end, dated?)
    spans = collections.defaultdict(list)
    for child, parent, a, b, rank in raw:
        if not is_company(parent) or not is_company(child):
            continue
        kc, kp = key_for(child), key_for(parent)
        if kc == kp:
            continue          # a brand owned by its own company
        spans[(kc, kp)].append((a, b))

    # only keep the part of the tree that leads to an app maker
    parents_of = collections.defaultdict(set)
    for kc, kp in spans:
        parents_of[kc].add(kp)
    keep = set()
    stack = [k for k in {k for k, _ in spans} if k[0] == "m"]
    while stack:
        k = stack.pop()
        if k in keep:
            continue
        keep.add(k)
        stack.extend(parents_of.get(k, ()))

    # labels -> keys, so the FIXES can name companies
    by_name = {}
    for i, m in enumerate(maker_list):      # the app's maker names win
        by_name.setdefault(m["n"], ("m", i))
    for k in keep | {kp for _, kp in spans}:
        name = maker_list[k[1]]["n"] if k[0] == "m" else (_label(ents.get(k[1])) or "")
        by_name.setdefault(name, k)
    for i, m in enumerate(maker_list):
        by_name.setdefault(m["n"], ("m", i))
    for q, e in ents.items():
        lab = _label(e)
        if lab and lab not in by_name:
            by_name[lab] = key_for(q)

    def founded(k):
        return node_of_year(k, 3)

    def node_of_year(k, idx):
        if k[0] == "m":
            return maker_list[k[1]].get("f" if idx == 3 else "d")
        e = ents.get(k[1]) if k[0] == "q" else None
        return _first_year(e, "P571" if idx == 3 else "P576") if e else None

    links = []
    by_child = collections.defaultdict(list)
    for (kc, kp), lst in spans.items():
        if kc not in keep:
            continue
        pf = founded(kp)
        dated = []
        for a, b in lst:
            if not (a or b):
                continue
            if a and pf and a < pf:
                a = pf                      # e.g. "owned by Stellantis since 2017" -> Stellantis began in 2021
            if b and a and b < a:
                continue
            dated.append((a, b))
        # merge overlapping spans between the same two companies
        merged = []
        for a, b in sorted(set(dated), key=lambda x: (x[0] or 0, x[1] or 9999)):
            if merged and (merged[-1][1] is None or (a or 0) <= merged[-1][1]):
                if merged[-1][1] is not None and (b is None or b > merged[-1][1]):
                    merged[-1][1] = b
                continue
            merged.append([a, b])
        if merged:
            for a, b in merged:
                by_child[kc].append([kc, kp, a, b, 0])
        else:
            by_child[kc].append([kc, kp, None, None, 1])

    # hand-added edges replace Wikidata ones between the same two companies
    unmatched = []
    for child, parent, a, b in FIXES:
        kc, kp = by_name.get(child), by_name.get(parent)
        if kc is None or kc[0] != "m":
            unmatched.append(child)
            continue  # this maker is not in the app's data
        if kp is None:
            unmatched.append("parent:" + parent)
        if kp is None:
            kp = ("x", parent)
        by_child[kc] = [l for l in by_child[kc] if l[1] != kp]
        by_child[kc].append([kc, kp, a, b, 4])
        keep.add(kc)

    def qids(k):
        return set(maker_qids[k[1]]) if k[0] == "m" else ({k[1]} if k[0] == "q" else set())

    def name_of(k):
        return (maker_list[k[1]]["n"] if k[0] == "m" else (_label(ents.get(k[1])) if k[0] == "q" else k[1])) or ""

    def born_inside(kc, kp):
        """Was the child set up by the parent (founded by it, or named after it)?"""
        founders = set()
        for q in qids(kc):
            for c in ents.get(q, {}).get("claims", {}).get("P112", []):
                v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                if isinstance(v, dict) and v.get("id"):
                    founders.add(v["id"])
        if founders & qids(kp):
            return True
        pn, cn = name_of(kp).split(" ")[0].lower(), name_of(kc).lower()
        return len(pn) >= 3 and cn.startswith(pn + " ")

    for kc, lst in by_child.items():
        # estimate missing start years (see the module docstring)
        lst.sort(key=lambda l: (l[2] or 9999))
        last_end = max([l[3] for l in lst if l[3]] or [0]) or None
        for l in lst:
            if l[2] is None:
                if born_inside(kc, l[1]):
                    cands = [founded(kc), founded(l[1])]
                else:
                    cands = [founded(kc), founded(l[1]), last_end,
                             None if node_of_year(kc, 4) else current_year - 10]
                cands = [y for y in cands if y]
                l[2] = max(cands) if cands else None
                l[4] |= 1
            if l[3] is None:
                d = node_of_year(kc, 4)
                l[3] = d if d and (not l[2] or d >= l[2]) else None
            if l[3]:
                last_end = max(last_end or 0, l[3])
            if l[2] is None or l[2] > current_year or (l[3] and l[3] < l[2]):
                continue
            links.append([node(kc), node(l[1]), l[2], l[3], l[4]])

    # English Wikipedia article titles for the other companies, so the app can show their story
    if fetch_sitelinks:
        need = [k[1] for k in key_index if k[0] == "q" and "sitelinks" not in ents.get(k[1], {})]
        if need:
            print(f"    fetching Wikipedia links for {len(need)} companies")
            got = fetch_sitelinks(need)
            for k, i in key_index.items():
                if k[0] == "q" and k[1] in got:
                    title = ((got[k[1]].get("sitelinks") or {}).get("enwiki") or {}).get("title")
                    if title:
                        nodes[i][5] = title

    return {"nodes": nodes, "links": links}, unmatched
