"""Download the French data used when the app is switched to French.

  * French Wikidata descriptions (the one-line subtitle) for cars and makers
  * French Wikipedia titles for the milestones (via English langlinks)

French article titles for cars and makers come from the Wikidata sitelinks that
fetch_raw.py already cached, so they are not downloaded again here.
Writes data/raw/fr.json. Every response is cached, so re-runs are instant.
"""
import json
import os

import wikiapi

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "data", "raw")


def main():
    cars = json.load(open(os.path.join(RAW, "car_wikidata.json"), encoding="utf-8"))
    makers = json.load(open(os.path.join(RAW, "makers.json"), encoding="utf-8"))["wikidata"]
    milestones = json.load(open(os.path.join(RAW, "milestones.json"), encoding="utf-8"))
    ids = sorted(set(cars) | set(makers))
    print(f"French descriptions for {len(ids)} items…")
    ents = wikiapi.wikidata_entities(ids, props="descriptions", languages="fr")
    desc = {}
    for q, e in ents.items():
        d = (e.get("descriptions") or {}).get("fr")
        if d and d.get("language") == "fr" and d.get("value"):
            desc[q] = d["value"]
    print(f"  {len(desc)} with a French description")

    titles = [m["title"] for m in milestones if m.get("title")]
    ms_fr = {}
    for batch in wikiapi.chunks(titles, 50):
        data = wikiapi.get_json(wikiapi.WIKIPEDIA_API, {
            "action": "query", "prop": "langlinks", "lllang": "fr", "lllimit": "max",
            "titles": "|".join(batch), "redirects": "1",
        })
        q = data.get("query", {})
        back = {r["to"]: r["from"] for r in q.get("redirects", [])}
        for pg in q.get("pages", []):
            ll = pg.get("langlinks") or []
            if ll:
                ms_fr[back.get(pg["title"], pg["title"])] = ll[0].get("title")
    print(f"  {len(ms_fr)} of {len(titles)} milestones have a French article")

    out = {"desc": desc, "milestones": ms_fr}
    with open(os.path.join(RAW, "fr.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("wrote data/raw/fr.json", wikiapi.STATS)


if __name__ == "__main__":
    main()
