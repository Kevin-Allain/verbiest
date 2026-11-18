# Verbiest — a visual history of the automobile

A first prototype of an app for exploring car history, built from Wikipedia data.
It runs in any modern browser on a computer, iPad or phone.

The project is named after **Ferdinand Verbiest** (1623–1688), the Flemish Jesuit who
built a small steam-powered trolley in China around 1672. It is possibly the first
self-propelled vehicle.

## The data in this first version

Snapshot taken on 18 November 2026:

- **7,400 car models**, from 1860 to 2026, from 49 countries
- **673 makers**, 459 of them with a logo
- **27 milestones**, from Verbiest's trolley (1672) to the Tesla Model Y (2023)
- Coverage: maker known for 85% of cars, country 87%, photo 90%, body style 62%,
  production end year 44%

## What it does

- **Timeline histogram**: the number of car models introduced each year, from 1860 to
  today. Bars are coloured by **country** or **body style**. The years before 1860
  (Verbiest, Cugnot, Trevithick…) are shown on a compressed scale at the left.
- **Play**: step through the years one by one, with each year's most famous cars.
- **Zoom & pan**: drag the chart, drag the window in the strip below it, pinch on touch
  screens, Ctrl/⌘ + scroll, double-click, or use the **era** buttons (Veteran, Brass,
  Vintage, Pre-war, Post-war, Modern).
- **Hover or tap a bar** to see that year's breakdown and its most famous cars. **Click a
  bar** to list all cars of that year below the chart.
- **Milestones**: the dots above the bars mark key moments (Benz Patent-Motorwagen,
  Model T, Le Mans, Citroën DS, Prius…). Click one to read about it.
- **Filters**: click legend entries to hide or show countries or body styles
  (Shift-click shows only that one). The pills filter by kind of car: sports, luxury,
  small, electric & hybrid, steam, racing or concept.
- **Makers founded**: switch the chart to count car makers by the year they were
  founded. The list then shows each maker's lifespan.
- **Detail panel** for every car, maker and milestone. It has the photo, key facts and the
  Wikipedia introduction (loaded live). Cars also show a "place in history" ribbon with the
  maker's other models, "more from this maker" and "also new that year". Makers show a
  models-per-year chart and the full model list.
- **Search** (press `/`) across all cars and makers. Type a year (e.g. `1955`) to jump
  to it.
- Light and dark themes, deep links (e.g. `#/car/Citroën DS`, `#/year/1955`) and
  "Add to Home Screen" support on iPad and iPhone.

## Running it

The app is plain HTML/CSS/JavaScript with no build step and no dependencies.

- **On this computer**: double-click `index.html`. It also works from `file://`.
- **With a local server** (closer to how it will be hosted):

  ```bash
  python3 -m http.server 8765
  ```

  then open <http://localhost:8765>.
- **On an iPad or phone**: put the folder on any static host (GitHub Pages, Netlify,
  Cloudflare Pages…), open the URL in Safari and use *Share → Add to Home Screen*.

Photos and the long article introductions are loaded live from Wikimedia, so an
internet connection is needed for those. Everything else (the timeline, lists, search,
facts) is in `data/verbiest-data.js` and works offline.

## Where the data comes from

| What | Source |
|---|---|
| List of car models and their introduction year | Wikipedia categories *Cars introduced in 1860 … 2026* |
| Discontinuation year | Wikipedia categories *Cars discontinued in …* |
| Body style, class, power (sedan, roadster, luxury, electric…) | Wikipedia categories such as *Sedans*, *Roadsters*, *Luxury vehicles*, *Production electric cars* |
| Short description, lead photo | Wikipedia page properties |
| Gaps in country / body style | Words in the short description, e.g. "American car", "compact crossover SUV" |
| Maker / brand, country of origin | Wikidata (*brand* P1716, *manufacturer* P176, *country of origin* P495) |
| Maker founding / closing year, country, logo | Wikidata (P571, P576, P17, P154) |
| "Fame" ranking | Number of Wikipedia language editions with an article on the car |
| Milestones | A hand-picked list of Wikipedia articles (in `scripts/fetch_raw.py`) |
| Eras | Era names and dates follow Wikipedia's *History of the automobile* |

Text is © Wikipedia contributors (CC BY-SA 4.0). Images come from Wikimedia Commons
under their own licences; each detail panel links to the image page.

## Refreshing the data

```bash
python3 scripts/fetch_raw.py     # downloads into data/raw/ (cached in scripts/.cache/)
python3 scripts/build_data.py    # writes data/verbiest-data.js
```

`scripts/.cache/` (about 110 MB) holds every raw API response. You can delete it to
save space, but the next refresh will then download everything again.

Since 2026, Wikimedia limits anonymous API clients to about 10 requests per minute.
The first download takes roughly an hour and runs fine in the background. Re-runs are
instant because every response is cached. To use the faster tier (about 200
requests/minute), identify yourself with a contact e-mail or URL:

```bash
VERBIEST_CONTACT="you@example.org" python3 scripts/fetch_raw.py
```

## Project layout

```
index.html               page structure
css/style.css            all styling (light + dark themes, phone/tablet/desktop layouts)
js/util.js               small helpers (DOM, Wikimedia image URLs)
js/chart.js              timeline histogram, zoom strip, mini charts (hand-written SVG)
js/app.js                state, filters, results, detail panel, search, routing
data/verbiest-data.js    generated dataset
data/raw/                raw downloads from Wikipedia / Wikidata
scripts/                 data pipeline (Python 3, standard library only)
assets/                  app icons
```

## Known limitations of this first version

- Coverage follows Wikipedia: a car only appears if its English article is in a
  *Cars introduced in …* category. Very early and very obscure models are under-represented.
- Some articles cover a whole model line (e.g. *Toyota Corolla*), others a single
  generation. Each counts once, in its earliest introduction year.
- The country is the car's country of origin on Wikidata, or else its maker's country.
- "Makers founded" only includes makers that have at least one model in the dataset.

## Ideas for later

- Add other data sources (production numbers, specifications, prices, race results).
- Timelines per maker (mergers and brand families), and a "compare two cars" view.
- Offline mode (service worker) and a proper hosted version for the iPad.
- Favourites and personal notes (e.g. "cars I have owned").
