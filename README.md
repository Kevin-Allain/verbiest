# Verbiest — a visual history of the automobile

A first prototype of an app for exploring car history, built from Wikipedia data.
It runs in any modern browser on a computer, iPad or phone.

**Live version: <https://kevin-allain.github.io/verbiest/>**. On an iPad or iPhone, open it in
Safari and use *Share → Add to Home Screen* to get an app icon.

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

The app is laid out like an Apple app (iOS / iPadOS style): system fonts, Apple's system
colours, a glass tab bar (at the bottom on a phone, at the top on an iPad or computer),
large titles that shrink into the navigation bar, sheets that slide up, and springy
animations. It follows the device's light or dark appearance; the moon/sun button
switches it by hand. It speaks **English and French**: the **EN / FR** button next to it
switches the language (the first time, it follows the device's language).

Five tabs:

- **Timeline**: the number of car models introduced each year, from 1860 to today,
  coloured by **country** or **body style**. The years before 1860 (Verbiest, Cugnot,
  Trevithick…) sit on a compressed scale at the left.
  - The big number above the chart (as in Apple's Health app) shows the total for the
    period on screen, or for the year you point at.
  - **Move through time**: drag the chart, drag the blue frame below it, pinch on touch
    screens, Ctrl/⌘ + scroll, double-click, use the − / + buttons, or pick an **era**
    (Pioneers, Veteran, Brass, Vintage, Pre-war, Post-war, Modern).
  - **Tap or click a bar** to list that year's cars below the chart. On a touch screen,
    touch and hold, then slide, to scrub through the years.
  - **Play** steps through the years one by one.
  - **Filters**: tap legend entries to hide or show countries or body styles
    (Shift-click shows only one). The chips filter by kind of car (sports, luxury,
    small, electric & hybrid, steam, racing, concept).
  - **Makers** (top-right switch) counts car makers by the year they were founded; the
    list then shows each maker's lifespan.
  - The dots above the bars are **milestones**; tap one to read about it.
- **Milestones**: the 27 key moments as large picture cards, grouped by era.
- **Makers**: all makers with their logos, A–Z (with a Contacts-style letter index),
  by country or by founding decade, with a search field. **Groups** shows *who owned
  whom* in any year: drag the year slider (or press Play) and brands move from one owner
  to the next (Jaguar: British Leyland → Ford → Tata). Each group is drawn as a small
  family tree; dashed lines mean the start year is estimated. Maker pages get an
  **Owners Over Time** timeline and a list of the companies they owned, and the other
  companies (Porsche SE, Groupe PSA…) get their own page.
- **Search** (or press `/`, or ⌘K): cars, makers and years, with your recently viewed
  cars and makers.
- **Garage**: your own cars. Open any car and tap **Favourite** or **I Owned One**
  (with the years you owned it and a note); makers can be favourites too. The Garage
  shows an ownership timeline, your favourites, and **Export / Import Backup**. The
  chart's **Favourites** and **My Cars** chips show them on the timeline. Everything is
  stored on the device only (browser storage), so it also works offline. On an iPhone
  or iPad, add the site to the Home Screen so Safari keeps the data.

Every car, maker and milestone opens in a **sheet**, laid out like an App Store page:
photo, key facts in a row (year, maker, country, body style…), the Wikipedia
introduction (loaded live, with "more") and **Read the Full Article**, a reading view of
the whole Wikipedia article (references and tables left out), the other generations of
the same model, the car's place in its maker's history, and "More from this maker" and
"Also new that year" shelves. In French, the French Wikipedia article is shown when one
exists; otherwise the English one, with a note saying the page only exists in English. Tapping a car inside a sheet
slides the next page in, with a back button; drag the sheet down (phone) or press Esc
to close it.

Deep links work too, e.g. `#/car/Citroën DS`, `#/maker/Ferrari`, `#/year/1955`,
`#/milestones`. On an iPad or iPhone, "Add to Home Screen" gives an app icon.

## Running it

The app is plain HTML/CSS/JavaScript with no build step and no dependencies.

- **On this computer**: double-click `index.html`. It also works from `file://`.
- **With a local server** (closer to how it will be hosted):

  ```bash
  python3 -m http.server 8765
  ```

  then open <http://localhost:8765>.
- **Online**: the site is hosted with GitHub Pages from the `main` branch of
  [Kevin-Allain/verbiest](https://github.com/Kevin-Allain/verbiest). Every push to `main`
  republishes it within a minute or two. After changing CSS/JS, bump the `?v=` numbers
  in `index.html` so browsers fetch the new files.

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
| French titles and descriptions | Wikidata sitelinks (French Wikipedia) and French descriptions (`scripts/fetch_fr.py`) |
| Article text | Loaded live from Wikipedia (English or French) when a page is opened |
| Gaps in country / body style | Words in the short description, e.g. "American car", "compact crossover SUV" |
| Maker / brand, country of origin | Wikidata (*brand* P1716, *manufacturer* P176, *country of origin* P495) |
| Maker founding / closing year, country, logo | Wikidata (P571, P576, P17, P154) |
| "Fame" ranking | Number of Wikipedia language editions with an article on the car |
| Milestones | A hand-picked list of Wikipedia articles (in `scripts/fetch_raw.py`) |
| Eras | Era names and dates follow Wikipedia's *History of the automobile* |
| Who owns whom | Wikidata *owned by* P127, *parent organization* P749, *subsidiary* P355, *owner of* P1830, with start/end years (P580/P582); majority owners only, governments left out; plus a short hand-checked list of well-known acquisitions in `scripts/ownership.py` |

Text is © Wikipedia contributors (CC BY-SA 4.0). Images come from Wikimedia Commons
under their own licences; each detail panel links to the image page.

## Refreshing the data

```bash
python3 scripts/fetch_raw.py     # downloads into data/raw/ (cached in scripts/.cache/)
python3 scripts/fetch_fr.py      # French descriptions and milestone titles (optional)
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
css/style.css            all styling (Apple-style; light + dark; phone/tablet/desktop layouts)
js/i18n.js               interface text in English and French, French names for the data labels
js/util.js               small helpers (DOM, Wikimedia image URLs)
js/chart.js              timeline histogram, zoom strip, mini charts (hand-written SVG)
js/app.js                tabs, state, filters, results, detail sheet, search, routing
data/verbiest-data.js    generated dataset
data/raw/                raw downloads from Wikipedia / Wikidata
scripts/                 data pipeline (Python 3, standard library only); ownership.py builds "who owns whom"
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
- Offline mode (service worker), so the app also works without a connection.
- Favourites and personal notes (e.g. "cars I have owned").
