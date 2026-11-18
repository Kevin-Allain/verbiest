"""Small, polite client for the Wikipedia (MediaWiki) and Wikidata APIs.

Every response is cached on disk (scripts/.cache), so re-running the
pipeline is fast and does not hit Wikimedia servers again.
"""
import gzip
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache")
os.makedirs(CACHE_DIR, exist_ok=True)

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

# Wikimedia API rate limits (2026): clients that identify themselves with
# contact information in the User-Agent get ~200 requests/minute; anonymous
# clients only ~10 requests/minute. Set VERBIEST_CONTACT to an e-mail address
# or URL of yours to use the faster tier, e.g.
#     VERBIEST_CONTACT="me@example.org" python3 scripts/fetch_raw.py
CONTACT = os.environ.get("VERBIEST_CONTACT", "").strip()
if CONTACT:
    USER_AGENT = f"ProjectVerbiest/0.1 ({CONTACT}) python-urllib"
    MIN_INTERVAL = 0.4    # ~150 requests / minute, under the 200/min tier
else:
    USER_AGENT = "ProjectVerbiest/0.1 (car-history prototype) python-urllib"
    MIN_INTERVAL = 6.3    # just under 10 requests / minute

_last_call = 0.0
STATS = {"network": 0, "cached": 0}


def _cache_path(url):
    return os.path.join(CACHE_DIR, hashlib.sha1(url.encode("utf-8")).hexdigest() + ".json")


def get_json(base, params, use_cache=True):
    params = dict(params)
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    url = base + "?" + urllib.parse.urlencode(sorted(params.items()))
    path = _cache_path(url)
    if use_cache and os.path.exists(path):
        STATS["cached"] += 1
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    global _last_call
    STATS["network"] += 1
    delay = 6.0
    for attempt in range(8):
        wait = MIN_INTERVAL - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept-Encoding": "gzip",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8"))
            if "error" in data and data["error"].get("code") == "maxlag":
                time.sleep(delay)
                delay *= 1.6
                continue
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                retry_after = e.headers.get("Retry-After")
                time.sleep(float(retry_after) + 1 if retry_after and retry_after.isdigit() else delay)
                delay *= 1.6
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(delay)
            delay *= 1.6
    raise RuntimeError("Giving up on " + url)


def query_all(params, base=WIKIPEDIA_API):
    """Run an action=query request following every `continue`, merging page props."""
    params = dict(params, action="query", maxlag="5")
    pages = {}
    lists = {}
    cont = {}
    while True:
        data = get_json(base, {**params, **cont})
        q = data.get("query", {})
        for p in q.get("pages", []):
            key = p.get("pageid") or p.get("title")
            cur = pages.setdefault(key, {})
            for k, v in p.items():
                if isinstance(v, list):
                    cur.setdefault(k, []).extend(v)
                elif isinstance(v, dict) and isinstance(cur.get(k), dict):
                    cur[k].update(v)
                else:
                    cur.setdefault(k, v)
        for k, v in q.items():
            if k in ("pages", "normalized", "redirects"):
                continue
            if isinstance(v, list):
                lists.setdefault(k, []).extend(v)
        for k in ("normalized", "redirects"):
            if k in q:
                lists.setdefault(k, []).extend(q[k])
        if "continue" in data:
            cont = data["continue"]
        else:
            break
    return pages, lists


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def wikidata_entities(ids, props="labels|claims|sitelinks", **extra):
    """Fetch Wikidata entities in batches of 50. Returns {qid: entity}."""
    out = {}
    for batch in chunks(sorted(set(ids)), 50):
        data = get_json(WIKIDATA_API, {
            "action": "wbgetentities",
            "ids": "|".join(batch),
            "props": props,
            "languages": "en",
            "languagefallback": "1",
            **extra,
        })
        for qid, ent in data.get("entities", {}).items():
            if "missing" not in ent:
                out[qid] = ent
    return out
