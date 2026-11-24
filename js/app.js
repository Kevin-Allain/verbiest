/* Verbiest — app logic: tabs, state, filters, results, detail sheet, search, routing. */
(function () {
  "use strict";
  const { h, s, num, norm, clamp, debounce, wikiImg, thumbUrl, commonsPage, wikiUrl, splitTitle, placeholder, icon } = V;
  const { Warp, TimelineChart, Overview, miniHistogram } = VChart;
  const { t, lang: LANG } = I18N;

  const D = window.VERBIEST_DATA;
  if (!D) {
    document.getElementById("introText").textContent =
      "The data file (data/verbiest-data.js) is missing. Run scripts/fetch_raw.py and scripts/build_data.py first.";
    return;
  }

  /* ------------------------------------------------------------------ setup */
  const $ = (id) => document.getElementById(id);
  I18N.localizeData(D);
  I18N.applyStatic(document);
  const coarse = matchMedia("(pointer: coarse)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const phoneMQ = matchMedia("(max-width: 767px)");
  const PAGE = 48;
  const START_YEAR = Warp.y0; // chart matrix starts in the prelude (1660)
  Warp.configure(D.firstYear, D.lastYear);
  const NY = D.lastYear - START_YEAR + 1;

  const cars = D.cars;
  const makers = D.makers;
  const countries = D.countries;
  const KIND = Object.fromEntries(D.kinds.map((k, i) => [k.k, 1 << i]));

  // per-maker lists & helpers
  const makerCars = makers.map(() => []);
  cars.forEach((c, i) => {
    c._i = i;
    c._n = norm(c.n);
    if (c.fr && c.fr !== c.n) c._nf = norm(c.fr);
    if (c.m >= 0) makerCars[c.m].push(i);
  });
  makerCars.forEach((list) => list.sort((a, b) => cars[a].y - cars[b].y || cars[a].n.localeCompare(cars[b].n)));
  makers.forEach((m, i) => { m._i = i; m._n = norm(m.n); m._count = makerCars[i].length; });
  const carByTitle = new Map(cars.map((c, i) => [c.n, i]));
  const makerByName = new Map(makers.map((m, i) => [m.n, i]));

  const state = {
    metric: "models",      // "models" | "makers"
    colorBy: "country",    // "country" | "body"
    kind: null,
    off: { country: new Set(), body: new Set() },
    maker: null,
    sel: null,
    era: null,
    sort: "fame",
    shown: PAGE,
  };

  // history helpers that never throw (some browsers restrict history on file:// pages)
  function histPush(st, url) { try { history.pushState(st, "", url); } catch (e) { try { location.hash = url; } catch (e2) {} } }
  function histReplace(st, url) { try { history.replaceState(st, "", url); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ my garage: storage
     Favourite cars and makers, and the cars you have owned, kept on this device only
     (localStorage). The same model can have been owned several times: each ownership
     has a purchase date and price and, if the car was sold, a sale date and price.
     Cars are keyed by Wikipedia title, so they survive data refreshes. A backup can be
     exported and imported from the Garage tab. */
  const GARAGE_KEY = "verbiest-garage";
  const CURRENT_YEAR = new Date().getFullYear();
  const garage = { fav: new Map(), favMakers: new Map(), owned: new Map() }; // owned: id -> ownership
  const toYear = (v) => { const n = parseInt(v, 10); return n >= 1600 && n <= CURRENT_YEAR + 1 ? n : null; };
  const toMonth = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 12 ? n : null; };
  const toAmount = (v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[\s\u00a0\u202f']/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const CURRENCIES = ["EUR", "FRF", "AF", "BEF", "CHF", "GBP", "USD"];
  const toCur = (v) => (CURRENCIES.includes(v) ? v : null);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** A clean ownership record: {id, n, buyY, buyM, buyPrice, buyCur, sold, sellY, sellM, sellPrice, sellCur, note, t}. */
  function cleanOwnership(o, fallbackT) {
    return {
      id: typeof o.id === "string" && o.id ? o.id.slice(0, 60) : newId(),
      n: o.n,
      buyY: toYear(o.buyY), buyM: toMonth(o.buyM), buyPrice: toAmount(o.buyPrice), buyCur: toCur(o.buyCur),
      sold: !!o.sold, sellY: toYear(o.sellY), sellM: toMonth(o.sellM), sellPrice: toAmount(o.sellPrice), sellCur: toCur(o.sellCur),
      note: typeof o.note === "string" ? o.note.slice(0, 2000) : "",
      t: Number.isFinite(+o.t) && +o.t > 0 ? +o.t : fallbackT,
    };
  }

  /** Merge a stored/imported garage into memory. Returns how many new items were added. */
  function mergeGarage(raw) {
    let added = 0;
    if (!raw || typeof raw !== "object") return 0;
    const stamp = (x) => (Number.isFinite(+x) && +x > 0 ? +x : Date.now());
    for (const [key, map] of [["fav", garage.fav], ["favMakers", garage.favMakers]]) {
      for (const f of Array.isArray(raw[key]) ? raw[key] : []) {
        if (!f || typeof f.n !== "string" || map.has(f.n)) continue;
        map.set(f.n, { t: stamp(f.t) });
        added++;
      }
    }
    for (const o of Array.isArray(raw.owned) ? raw.owned : []) {
      if (!o || typeof o.n !== "string") continue;
      // first version: one ownership per car, with years only
      const src = !("buyY" in o) && ("from" in o || "to" in o)
        ? { id: "v1-" + o.n, n: o.n, buyY: o.from, sold: !!o.to, sellY: o.to, note: o.note, t: o.t }
        : o;
      const rec = cleanOwnership(src, Date.now());
      if (!garage.owned.has(rec.id)) added++;
      garage.owned.set(rec.id, rec);
    }
    syncOwnedTitles();
    return added;
  }
  function serializeGarage() {
    const ser = (map) => [...map].map(([n, v]) => Object.assign({ n }, v));
    return { app: "Verbiest", v: 2, saved: new Date().toISOString(), fav: ser(garage.fav), favMakers: ser(garage.favMakers), owned: [...garage.owned.values()] };
  }

  let ownedTitles = new Set();
  function syncOwnedTitles() { ownedTitles = new Set([...garage.owned.values()].map((o) => o.n)); }
  try { mergeGarage(JSON.parse(localStorage.getItem(GARAGE_KEY) || "null")); } catch (e) { /* storage unavailable */ }

  let persistAsked = false;
  function saveGarage() {
    syncOwnedTitles();
    try { localStorage.setItem(GARAGE_KEY, JSON.stringify(serializeGarage())); }
    catch (e) { toast(t("g.saveFail")); }
    // ask the browser to keep this site's storage (no prompt in Safari / Chrome)
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
    garageChanged();
  }
  const isFav = (c) => garage.fav.has(c.n);
  const isOwned = (c) => ownedTitles.has(c.n);
  const isFavMaker = (m) => garage.favMakers.has(m.n);
  const byPurchase = (x, y) => (x.buyY || 9999) - (y.buyY || 9999) || (x.buyM || 0) - (y.buyM || 0) || x.t - y.t;
  const ownershipsOf = (c) => [...garage.owned.values()].filter((o) => o.n === c.n).sort(byPurchase);

  /* money: amounts as written, plus the euro value for currencies with a fixed legal rate */
  const LOCALE = LANG === "fr" ? "fr-FR" : "en-GB";
  const EURO_RATE = { FRF: 6.55957, AF: 655.957, BEF: 40.3399 };   // per euro (1999 conversion rates; 100 old francs = 1 franc)
  const CUR_SIGN = { EUR: "€", FRF: "F", AF: "AF", BEF: "FB", CHF: "CHF", GBP: "£", USD: "$" };
  const money0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
  function money(amount, cur) {
    const sign = CUR_SIGN[cur] || cur;
    return cur === "GBP" || cur === "USD" ? sign + money0.format(amount) : `${money0.format(amount)} ${sign}`;
  }
  const inEuros = (amount, cur) => (EURO_RATE[cur] ? amount / EURO_RATE[cur] : null);
  function moneyText(amount, cur) {
    if (amount == null) return null;
    const e = inEuros(amount, cur);
    return e != null ? `${money(amount, cur)} (≈ ${money(Math.round(e), "EUR")})` : money(amount, cur);
  }
  /** Currency offered for a purchase in a given year (French interface: francs before 2002, old francs before 1960). */
  const defaultCur = (y) => (LANG === "fr" && y && y < 2002 ? (y < 1960 ? "AF" : "FRF") : "EUR");
  const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long" });
  const monthName = (m) => monthFmt.format(new Date(2000, m - 1, 1));
  const dateText = (y, m) => (y ? (m ? `${monthName(m)} ${y}` : String(y)) : null);
  /** Length of an ownership, in years (or months when shorter than a year). */
  function ownedFor(o) {
    if (!o.buyY) return null;
    const endY = o.sold ? o.sellY : CURRENT_YEAR, endM = o.sold ? o.sellM : new Date().getMonth() + 1;
    if (!endY) return null;
    const months = (endY - o.buyY) * 12 + ((endM || 6) - (o.buyM || 6));
    if (months < 12) return t("dur.months", Math.max(1, months));
    return t("dur.years", Math.round(months / 12));
  }

  /* ------------------------------------------------------------------ flags */
  // Flag emoji for modern countries (Apple platforms draw them beautifully; Windows has none).
  const FLAG_CODES = {
    "United States": "US", "China": "CN", "Japan": "JP", "United Kingdom": "GB", "Germany": "DE", "France": "FR",
    "Italy": "IT", "South Korea": "KR", "Sweden": "SE", "Australia": "AU", "India": "IN", "Czechia": "CZ",
    "Russia": "RU", "Spain": "ES", "Malaysia": "MY", "Morocco": "MA", "Romania": "RO", "Brazil": "BR",
    "Hong Kong": "HK", "Iran": "IR", "Switzerland": "CH", "Taiwan": "TW", "Vietnam": "VN", "Poland": "PL",
    "Austria": "AT", "Denmark": "DK", "Canada": "CA", "Netherlands": "NL", "Slovakia": "SK", "Latvia": "LV",
    "Mexico": "MX", "Portugal": "PT", "Ukraine": "UA", "Belgium": "BE", "Croatia": "HR", "Hungary": "HU",
    "Indonesia": "ID", "United Arab Emirates": "AE", "Argentina": "AR", "Israel": "IL", "Norway": "NO",
    "South Africa": "ZA", "Thailand": "TH", "Turkey": "TR", "Finland": "FI", "Serbia": "RS",
  };
  const flagsOK = !/Windows/.test(navigator.userAgent);
  function flagOf(ci) {
    if (!flagsOK || ci == null || ci < 0) return "";
    const code = FLAG_CODES[countries[ci].en || countries[ci].n];
    return code ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
  }
  const countryName = (ci) => (ci >= 0 ? countries[ci].n : t("unknownCountry"));
  const countryLabel = (ci) => { const f = flagOf(ci); return f ? `${f} ${countryName(ci)}` : countryName(ci); };

  /* ------------------------------------------------------------------ colours */
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let COLORS = {};
  function readColors() {
    for (const dim of ["country", "body"]) {
      COLORS[dim] = D.dims[dim].groups.map((g, k) => (g.other ? css("--s-other") : css("--s" + (k + 1))));
    }
  }
  readColors();

  const carGroup = (c, dim) => (dim === "country" ? (c.c >= 0 ? countries[c.c].g : otherIdx("country")) : c.b);
  const makerGroup = (m) => (m.c >= 0 ? countries[m.c].g : otherIdx("country"));
  function otherIdx(dim) { return D.dims[dim].groups.length - 1; }

  /* ------------------------------------------------------------------ filters */
  function carPasses(c, ignoreDim) {
    if (state.maker != null && c.m !== state.maker) return false;
    if (state.kind) {
      if (state.kind === "@fav") { if (!garage.fav.has(c.n)) return false; }
      else if (state.kind === "@owned") { if (!ownedTitles.has(c.n)) return false; }
      else if (!(c.k & KIND[state.kind])) return false;
    }
    if (ignoreDim !== "country" && state.off.country.size && state.off.country.has(carGroup(c, "country"))) return false;
    if (ignoreDim !== "body" && state.off.body.size && state.off.body.has(c.b)) return false;
    return true;
  }
  function kindName(k) {
    if (k === "@fav") return t("kind.fav");
    if (k === "@owned") return t("kind.ownedLong");
    const d = D.kinds.find((x) => x.k === k);
    return d ? d.n : k;
  }
  function makerPasses(m) {
    if (m.f == null) return false;
    if (state.maker != null && m._i !== state.maker) return false;
    return true;
  }

  /* ------------------------------------------------------------------ aggregation */
  let agg = null; // { G, matrix, totals, byYear: Map(year -> [idx sorted by fame]), legendCounts }

  function aggregate() {
    const dim = state.metric === "makers" ? "country" : state.colorBy;
    const G = D.dims[dim].groups.length;
    const matrix = new Float32Array(NY * G);
    const byYear = new Map();
    const legendCounts = new Array(G).fill(0);
    const push = (y, idx) => { let a = byYear.get(y); if (!a) byYear.set(y, (a = [])); a.push(idx); };
    if (state.metric === "models") {
      for (const c of cars) {
        if (carPasses(c, dim)) {
          const g = carGroup(c, dim);
          legendCounts[g]++;
          if (state.off[dim].has(g)) continue;
          const yi = c.y - START_YEAR;
          if (yi >= 0 && yi < NY) matrix[yi * G + g]++;
          push(c.y, c._i);
        }
      }
      for (const a of byYear.values()) a.sort((x, y) => cars[y].p - cars[x].p || cars[x].n.localeCompare(cars[y].n));
    } else {
      for (const m of makers) {
        if (makerPasses(m)) {
          const g = makerGroup(m);
          legendCounts[g]++;
          if (state.off.country.has(g)) continue;
          const yi = m.f - START_YEAR;
          if (yi >= 0 && yi < NY) matrix[yi * G + g]++;
          push(m.f, m._i);
        }
      }
      for (const a of byYear.values()) a.sort((x, y) => makers[y].p - makers[x].p);
    }
    const totals = new Float32Array(NY);
    for (let i = 0; i < NY; i++) { let t = 0; for (let g = 0; g < G; g++) t += matrix[i * G + g]; totals[i] = t; }
    agg = { dim, G, matrix, totals, byYear, legendCounts };
  }

  /* ------------------------------------------------------------------ chart */
  const tooltip = $("tooltip");
  const chart = new TimelineChart($("chart"), {
    firstYear: START_YEAR,
    lastYear: D.lastYear,
    milestones: D.milestones,
    eras: D.eras,
    onHover: (year) => {
      setReadout(year != null ? year : state.sel);
      if (year == null) { if (state.sel == null || !coarse) hideTip(); return; }
      showYearTip(year);
    },
    onSelect: (year, how) => {
      selectYear(year);
      if (how === "key" && year != null) chart.ensureVisible(year);
      if (year != null) showYearTip(year);
      else hideTip();
    },
    onViewChange: (v, animated) => {
      overview.setView(v);
      if (!animated && state.era) { state.era = null; syncEraChips(); }
      syncEraChips();
      setReadoutSoon();
      updateResultsSoon();
    },
    onViewFrame: (v) => { overview.setView(v); setReadoutSoon(); },
    onPin: (ms) => openDetail("milestone", D.milestones.indexOf(ms)),
    onPinHover: (ms, ev) => { if (ms) showPinTip(ms, ev); else hideTip(); },
    onEra: (era) => goEra(era),
  });

  const overview = new Overview($("overview"), {
    firstYear: START_YEAR,
    margins: () => { const M = chart.dims().M; return { l: M.l, r: M.r }; },
    onBrush: (a, b, animate) => {
      if (state.era) { state.era = null; syncEraChips(); }
      chart.setView(a, b, animate);
    },
  });

  function refresh(opts = {}) {
    aggregate();
    chart.setSeries(agg.matrix, agg.G, COLORS[agg.dim], { grow: opts.grow });
    overview.setTotals(agg.totals);
    renderLegend();
    state.shown = PAGE;
    renderResults();
    setReadout(state.sel);
    if ($("tableView").open) renderTable();
    if (state.sel != null && !tooltip.hidden) showYearTip(state.sel);
  }

  /* ------------------------------------------------------------------ readout (Health / Stocks style) */
  function eraOf(year) { return D.eras.find((e) => year >= e.from && year <= e.to); }
  const eraYears = (e) => `${e.from < 1700 ? 1672 : e.from}–${e.to >= D.lastYear ? t("today") : e.to}`;

  function setReadout(year) {
    const makersMode = state.metric === "makers";
    let cap = makersMode ? t("ro.makers") : t("ro.models");
    if (!makersMode && state.maker != null) cap = t("ro.makerModels", makers[state.maker].n);
    else if (!makersMode && state.kind) cap = kindName(state.kind);
    let val = 0, sub = "";
    if (year != null) {
      val = agg.totals[year - START_YEAR] || 0;
      const e = eraOf(year);
      sub = e ? `${year} · ${e.name}` : String(year);
    } else {
      const [y0, y1] = visibleYears();
      let a = null, b = null;
      for (let y = y0; y <= y1; y++) { const v = agg.totals[y - START_YEAR]; if (v) { val += v; if (a == null) a = y; b = y; } }
      sub = a == null ? t("ro.none") : a === b ? String(a) : `${a}–${b}`;
      if (state.era && a != null) sub += ` · ${state.era.name}`;
    }
    const unit = makersMode ? t("unit.maker", val) : t("unit.model", val);
    const put = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
    put("roCap", cap); put("roNum", num(val)); put("roUnit", unit); put("roSub", sub);
  }
  let readoutRaf = 0;
  function setReadoutSoon() {
    if (readoutRaf) return;
    readoutRaf = requestAnimationFrame(() => { readoutRaf = 0; setReadout(chart.hover != null ? chart.hover : state.sel); });
  }

  /* ------------------------------------------------------------------ segmented controls */
  const segObserver = new ResizeObserver((entries) => entries.forEach((e) => syncSeg(e.target, true)));
  function syncSeg(seg, instant) {
    const b = seg.querySelector('button[aria-checked="true"]');
    const th = seg.querySelector(".seg-thumb");
    if (!b || !th || !b.offsetWidth) return;
    if (instant) th.classList.add("instant");
    th.style.width = b.offsetWidth + "px";
    th.style.transform = `translateX(${b.offsetLeft - 2}px)`;
    th.style.left = "2px";
    if (instant) requestAnimationFrame(() => th.classList.remove("instant"));
  }
  function bindSeg(id, get, set) {
    const seg = $(id);
    segObserver.observe(seg);
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-v]");
      if (!b || b.disabled || get() === b.dataset.v) return;
      for (const x of seg.querySelectorAll("button[data-v]")) x.setAttribute("aria-checked", String(x === b));
      syncSeg(seg);
      set(b.dataset.v);
    });
    return seg;
  }
  function setSegValue(id, v) {
    const seg = $(id);
    for (const x of seg.querySelectorAll("button[data-v]")) x.setAttribute("aria-checked", String(x.dataset.v === v));
    syncSeg(seg);
  }

  function setMetric(v) {
    state.metric = v;
    setSegValue("metricSeg", v);
    const makersMode = v === "makers";
    for (const b of $("colorSeg").querySelectorAll("button")) b.disabled = makersMode && b.dataset.v !== "country";
    if (makersMode && state.colorBy !== "country") setSegValue("colorSeg", "country");
    else if (!makersMode) setSegValue("colorSeg", state.colorBy);
    $("typePills").style.visibility = makersMode ? "hidden" : "";
  }
  bindSeg("metricSeg", () => state.metric, (v) => { setMetric(v); refresh({ grow: true }); });
  bindSeg("colorSeg", () => state.colorBy, (v) => { state.colorBy = v; refresh({ grow: true }); });

  // kind chips
  function renderPills() {
    const mine = [];
    if (garage.fav.size) mine.push({ k: "@fav", n: t("kind.fav"), icon: "heartFill" });
    if (garage.owned.size) mine.push({ k: "@owned", n: t("kind.owned"), icon: "keyFill" });
    const all = [{ k: null, n: t("kind.all") }, ...mine, ...D.kinds];
    $("typePills").replaceChildren(...all.map((k) => h("button", {
      class: "chip", type: "button", role: "radio", "aria-checked": String(state.kind === k.k),
      title: k.hint || null,
      "data-mine": k.k === "@fav" ? "fav" : k.k === "@owned" ? "own" : null,
      onclick: () => {
        state.kind = k.k; renderPills(); refresh();
        const on = $("typePills").querySelector('[aria-checked="true"]');
        if (on) on.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      },
    }, k.icon ? icon(k.icon) : null, k.n)));
  }

  // era scope bar
  function renderEraChips() {
    const allBtn = h("button", { class: "era-chip", type: "button", "data-era": "all", onclick: () => { selectYear(null); hideTip(); goAll(); } },
      h("b", null, t("eras.all")), h("span", null, `1672–${t("today")}`));
    const chips = D.eras.map((e, k) => h("button", {
      class: "era-chip", type: "button", "data-era": String(k),
      onclick: () => (state.era === e ? goAll() : goEra(e)),
    }, h("b", null, e.short || e.name), h("span", null, eraYears(e))));
    $("eraChips").replaceChildren(allBtn, ...chips);
    syncEraChips();
  }
  function syncEraChips() {
    const [a, b] = chart.viewAnim ? chart.viewAnim.to : chart.view;
    const full = !state.era && a <= 0.001 && b >= 0.999;
    for (const el of $("eraChips").children) {
      const k = el.dataset.era;
      const on = k === "all" ? full : state.era === D.eras[+k];
      if (el.classList.contains("active") !== on) el.classList.toggle("active", on);
    }
  }
  function goEra(e) {
    state.era = e;
    selectYear(null);
    hideTip();
    if (e.from < D.firstYear) chart.setView(0, Warp.t(e.to + 1) + 0.01, true);
    else chart.showYears(e.from, e.to, true);
    syncEraChips();
    const chip = $("eraChips").querySelector(`[data-era="${D.eras.indexOf(e)}"]`);
    if (chip) chip.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
  function goAll() {
    state.era = null;
    chart.setView(0, 1, true);
    syncEraChips();
  }

  /* "Play": step through the years of the current window, one per beat. */
  const player = { timer: 0 };
  function stopPlay() {
    if (!player.timer) return;
    clearInterval(player.timer);
    player.timer = 0;
    $("playBtn").setAttribute("aria-pressed", "false");
    $("playBtn").querySelector("span").textContent = t("play");
  }
  function startPlay() {
    const [y0, y1] = visibleYears();
    const first = Math.max(y0, D.firstYear);
    let y = state.sel != null && state.sel >= first && state.sel < y1 ? state.sel : first - 1;
    const step = () => {
      do { y++; } while (y <= y1 && !agg.totals[y - START_YEAR]);
      if (y > y1) { stopPlay(); return; }
      selectYear(y);
      chart.ensureVisible(y);
      showYearTip(y);
    };
    $("playBtn").setAttribute("aria-pressed", "true");
    $("playBtn").querySelector("span").textContent = t("pause");
    step();
    player.timer = setInterval(step, 1400);
  }
  $("playBtn").onclick = () => (player.timer ? stopPlay() : startPlay());
  $("chart").addEventListener("pointerdown", stopPlay);
  $("overview").addEventListener("pointerdown", stopPlay);

  $("zoomIn").onclick = () => chart.zoomAt(0.6, null, true);
  $("zoomOut").onclick = () => chart.zoomAt(1 / 0.6, null, true);
  $("sortSel").onchange = (ev) => { state.sort = ev.target.value; state.shown = PAGE; renderResults(); };
  $("hint").textContent = coarse ? t("hint.touch") : t("hint.mouse");

  /* ------------------------------------------------------------------ legend */
  function renderLegend() {
    const dim = agg.dim;
    const groups = D.dims[dim].groups;
    const off = state.off[dim];
    const items = groups.map((g, k) => {
      const n = agg.legendCounts[k];
      if (!n && !off.has(k)) return null;
      return h("button", {
        class: "lg" + (off.has(k) ? " off" : ""), type: "button", style: { "--c": COLORS[dim][k] },
        "aria-pressed": String(!off.has(k)),
        title: off.has(k) ? t("legend.show", g.n) : t("legend.hide", g.n),
        onclick: (ev) => {
          if (ev.shiftKey || ev.altKey) {
            const onlyThis = groups.every((_, j) => j === k || off.has(j)) && !off.has(k);
            off.clear();
            if (!onlyThis) groups.forEach((_, j) => j !== k && off.add(j));
          } else if (off.has(k)) off.delete(k);
          else off.add(k);
          if (off.size >= groups.length) off.clear();
          refresh();
        },
      }, h("i"), g.n, h("span", { class: "n" }, num(n)));
    });
    $("legend").replaceChildren(...items.filter(Boolean));
  }

  /* ------------------------------------------------------------------ popover */
  function placeTip(x, y, below) {
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    const left = clamp(x - r.width / 2, 8, innerWidth - r.width - 8);
    let top = below ? y + 14 : y - r.height - 14;
    if (top < 8) top = y + 14;
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function hideTip() { tooltip.hidden = true; }
  function fillTip(...nodes) { tooltip.replaceChildren(...nodes.flat().filter(Boolean)); }

  function showYearTip(year) {
    if (tab !== "timeline" || sheetOpen) return;
    const i = year - START_YEAR;
    if (i < 0 || i >= NY) return hideTip();
    const G = agg.G, dim = agg.dim;
    const total = agg.totals[i];
    const what = state.metric === "makers" ? t("tt.makersFounded", total) : t("tt.newModels", total);
    const rows = [];
    for (let g = 0; g < G; g++) {
      const v = agg.matrix[i * G + g];
      if (v > 0) rows.push(h("div", { class: "tt-row", style: { "--c": COLORS[dim][g] } }, h("i"), h("b", null, num(v)), h("span", null, D.dims[dim].groups[g].n)));
    }
    const list = agg.byYear.get(year) || [];
    const top = list.slice(0, 3).map((k) => (state.metric === "makers" ? makers[k].n : carName(cars[k])));
    const era = eraOf(year);
    const ms = D.milestones.filter((m) => m.year === year);
    fillTip(
      h("div", { class: "tt-head" }, h("span", { class: "tt-year" }, String(year)), h("span", { class: "tt-total" }, num(total), " ", h("small", null, what))),
      era ? h("div", { class: "tt-era" }, era.name) : null,
      ...rows,
      top.length ? h("div", { class: "tt-notable" }, t("tt.notable"), ...top.flatMap((x, k) => [k ? ", " : "", h("b", null, x)]), list.length > 3 ? t("tt.andMore", num(list.length - 3)) : "") : null,
      ms.length ? h("div", { class: "tt-notable" }, "★ ", ms.map((m) => m.label).join(" · ")) : null,
      h("div", { class: "tt-tip" }, state.sel === year ? (coarse ? t("tt.selTouch") : t("tt.selMouse")) : (coarse ? t("tt.seeTouch") : t("tt.seeMouse")))
    );
    const a = chart.anchorFor(year);
    placeTip(a.x, a.y);
  }

  function showPinTip(ms, ev) {
    const r = ev.target.closest(".c-pin").getBoundingClientRect();
    fillTip(
      h("div", { class: "tt-ms" },
        ms.i ? h("img", { src: thumbUrl(ms.i, 120), alt: "", referrerpolicy: "no-referrer" }) : null,
        h("div", null,
          h("div", { class: "tt-head" }, h("span", { class: "tt-year" }, String(ms.year))),
          h("div", { style: { fontWeight: 600 } }, ms.label),
          h("div", { class: "tt-tip" }, coarse ? t("tt.readTouch") : t("tt.readMouse"))))
    );
    placeTip(r.left + r.width / 2, r.top, false);
  }

  addEventListener("scroll", () => { if (!tooltip.hidden) hideTip(); }, { passive: true });
  document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest("#chart")) hideTip(); });

  /* ------------------------------------------------------------------ selection */
  function selectYear(year) {
    state.sel = year;
    chart.setSelection(year);
    overview.setSelection(year);
    state.shown = PAGE;
    renderResults();
    setReadout(chart.hover != null ? chart.hover : year);
    if (!sheetOpen && tab === "timeline") {
      const want = tabRoute("timeline");
      if (location.hash !== want && !(year == null && (location.hash === "" || location.hash === "#/"))) histReplace(history.state, want);
    }
  }

  /* ------------------------------------------------------------------ results */
  const updateResultsSoon = debounce(() => { if (state.sel == null) { state.shown = PAGE; renderResults(); } }, 140);

  function visibleYears() {
    const [a, b] = chart.viewAnim ? chart.viewAnim.to : chart.view;
    return [Math.max(START_YEAR, Math.ceil(Warp.y(a) - 0.5)), Math.min(D.lastYear, Math.floor(Warp.y(b) - 0.5))];
  }

  function currentList() {
    let y0, y1;
    if (state.sel != null) y0 = y1 = state.sel;
    else [y0, y1] = visibleYears();
    const ids = [];
    for (let y = y0; y <= y1; y++) { const a = agg.byYear.get(y); if (a) ids.push(...a); }
    const pool = state.metric === "makers" ? makers : cars;
    if (state.sort === "fame") ids.sort((a, b) => pool[b].p - pool[a].p);
    else if (state.sort === "year") ids.sort((a, b) => (state.metric === "makers" ? pool[a].f - pool[b].f : pool[a].y - pool[b].y) || pool[b].p - pool[a].p);
    else ids.sort((a, b) => pool[a].n.localeCompare(pool[b].n));
    return { ids, y0, y1 };
  }

  let moreObserver = null;
  function renderResults() {
    const { ids, y0, y1 } = currentList();
    const makersMode = state.metric === "makers";
    const noun = makersMode ? t("res.makersFounded") : state.maker != null ? t("res.makerModels", makers[state.maker].n) : t("res.cars");
    let ya = y1, yb = y0;
    for (const id of ids) { const y = makersMode ? makers[id].f : cars[id].y; if (y < ya) ya = y; if (y > yb) yb = y; }
    $("resultsTitle").textContent = y0 === y1 ? t("res.in", noun, y0) : ids.length ? t("res.range", noun, ya, yb) : t("res.range", noun, Math.max(y0, D.firstYear), y1);
    const sortTxt = t("res.sort." + state.sort);
    $("resultsSub").textContent = ids.length
      ? `${t("res.count", num(ids.length), makersMode)}, ${sortTxt}` +
        (state.sel == null ? t("res.follows") : "")
      : "";

    // era note
    const note = $("eraNote");
    const era = state.sel == null ? state.era : null;
    if (era) {
      note.hidden = false;
      note.replaceChildren(...[
        h("h3", null, era.name),
        h("p", { class: "years" }, eraYears(era)),
        h("p", null, era.text),
        era.link ? h("a", { href: era.link, target: "_blank", rel: "noopener" }, t("res.learnMore"), icon("chevronRight", "chev")) : null,
      ].filter(Boolean));
    } else if (state.sel != null && D.milestones.some((m) => m.year === state.sel)) {
      const ms = D.milestones.filter((m) => m.year === state.sel);
      note.hidden = false;
      note.replaceChildren(...ms.map((m) => h("p", { class: "ms-line" }, "★ ",
        h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); openDetail("milestone", D.milestones.indexOf(m)); } }, m.label),
        m.s ? ` — ${m.s}` : "")));
    } else note.hidden = true;

    renderActiveFilters();

    const grid = $("grid");
    grid.classList.toggle("makers", makersMode);
    if (!ids.length) {
      grid.replaceChildren(h("div", { class: "empty-state" }, h("b", null, t("noResults")),
        state.sel != null ? t("res.noneYear", makersMode, state.sel) : t("res.nonePeriod")));
      $("moreBtn").hidden = true;
      return;
    }
    const slice = ids.slice(0, state.shown);
    grid.replaceChildren(...slice.map((id, k) => (makersMode ? makerRow(makers[id], k) : carTile(cars[id], k))));
    const more = $("moreBtn");
    more.hidden = ids.length <= state.shown;
    more.textContent = t("moreN", num(ids.length - state.shown));
    if (!moreObserver && "IntersectionObserver" in window) {
      moreObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && !$("moreBtn").hidden && tab === "timeline") loadMore();
      }, { rootMargin: "400px" });
      moreObserver.observe(more);
    }
  }
  function loadMore() {
    const { ids } = currentList();
    const grid = $("grid");
    const makersMode = state.metric === "makers";
    const from = state.shown;
    state.shown += PAGE;
    ids.slice(from, state.shown).forEach((id, k) => grid.appendChild(makersMode ? makerRow(makers[id], k) : carTile(cars[id], k)));
    const more = $("moreBtn");
    more.hidden = ids.length <= state.shown;
    more.textContent = t("moreN", num(ids.length - state.shown));
  }
  $("moreBtn").onclick = loadMore;

  function renderActiveFilters() {
    const chips = [];
    const token = (label, clear) => h("span", { class: "token" }, label,
      h("button", { type: "button", "aria-label": t("tok.remove", label), onclick: clear }, icon("xmarkCircle")));
    if (state.maker != null) chips.push(token(makers[state.maker].n, () => { state.maker = null; refresh(); }));
    if (state.kind && state.metric === "models") chips.push(token(kindName(state.kind), () => { state.kind = null; renderPills(); refresh(); }));
    for (const dim of ["country", "body"]) {
      if (!state.off[dim].size) continue;
      if (dim === "body" && state.metric === "makers") continue;
      const hidden = [...state.off[dim]].map((k) => D.dims[dim].groups[k].n);
      chips.push(token(t("tok.hiding", hidden.length > 2 ? (dim === "country" ? t("tok.nCountries", hidden.length) : t("tok.nBodies", hidden.length)) : hidden.join(", ")), () => { state.off[dim].clear(); refresh(); }));
    }
    if (state.sel != null) chips.push(token(t("tok.year", state.sel), () => { selectYear(null); hideTip(); }));
    $("activeFilters").replaceChildren(...chips);
  }

  function yearsLabel(c) {
    if (c.e && c.e !== c.y) return `${c.y}–${c.e}`;
    return String(c.y);
  }

  function carTile(c, k, extraClass) {
    const [name, paren] = splitTitle(carName(c));
    const maker = c.m >= 0 ? makers[c.m].n : null;
    const dim = state.metric === "models" ? state.colorBy : "country";
    const col = COLORS[dim][carGroup(c, dim)];
    const thumb = h("div", { class: "thumb" });
    if (c.i) thumb.append(wikiImg(c.i, 250, "")); else thumb.append(placeholder());
    thumb.append(h("span", { class: "yr" }, yearsLabel(c)));
    const b = tileBadges(c);
    if (b) thumb.append(b);
    return h("button", {
      class: "tile" + (extraClass ? " " + extraClass : ""), type: "button", style: { "--i": Math.min(k, 24) },
      "data-car": String(c._i),
      onclick: () => openDetail("car", c._i),
      "aria-label": `${carName(c)}, ${yearsLabel(c)}`,
    },
      thumb,
      h("div", { class: "nm" }, name, paren ? h("small", null, ` (${paren})`) : null),
      h("div", { class: "mt" }, h("i", { class: "dot", style: { "--c": col } }), h("span", null, [maker, countryName(c.c)].filter(Boolean).join(" · "))));
  }

  const initials = (n) => (n.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();

  /** A maker logo in an "app icon" tile (or initials, like a contact card without a photo). */
  function makerTile(m, size) {
    const cls = "icon-tile" + (size ? " " + size : "");
    if (m.i) {
      const tile = h("div", { class: cls + (m.logo ? "" : " photo") });
      const img = h("img", { alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", src: thumbUrl(m.i, size === "xl" ? 250 : 120) });
      img.addEventListener("error", () => { tile.className = cls + " letter"; tile.textContent = initials(m.n); });
      tile.append(img);
      return tile;
    }
    return h("div", { class: cls + " letter" }, initials(m.n));
  }

  function lifeBar(m) {
    const a = D.firstYear - 10, b = D.lastYear;
    const pos = (y) => ((clamp(y, a, b) - a) / (b - a)) * 100;
    const f = m.f, d = m.d;
    const col = COLORS.country[makerGroup(m)];
    const life = h("div", { class: "life" }, h("div", { class: "track" }));
    if (f != null) {
      const end = d != null ? d : b;
      life.append(h("div", { class: "bar" + (d == null ? " open" : ""), style: { left: pos(f) + "%", width: Math.max(0.6, pos(end) - pos(f)) + "%", "--c": col } }));
      const txt = d != null ? `${f}–${d}` : `${f}–${t("todayLc")}`;
      const left = pos(f);
      life.append(h("span", { class: "lbl", style: left > 70 ? { right: (100 - left + 1) + "%" } : { left: `calc(${left}% + 2px)` } }, txt));
    }
    return life;
  }

  function makerRow(m, k) {
    return h("button", { class: "mrow" + (isFavMaker(m) ? " is-fav" : ""), type: "button", style: { "--i": Math.min(k, 30) }, "data-maker": String(m._i), onclick: () => openDetail("maker", m._i) },
      makerTile(m),
      h("div", { class: "mname" }, h("b", null, m.n, icon("heartFill", "fav-mark")),
        h("span", null, h("i", { class: "dot", style: { "--c": COLORS.country[makerGroup(m)] } }), countryName(m.c), m._count ? ` · ${t("nModels", m._count)}` : "")),
      lifeBar(m),
      icon("chevronRight", "chev"));
  }

  /* ------------------------------------------------------------------ table view */
  function renderTable() {
    const [y0, y1] = visibleYears();
    const dim = agg.dim, G = agg.G;
    const groups = D.dims[dim].groups;
    const head = h("tr", null, h("th", null, t("table.year")), h("th", null, t("table.total")), ...groups.map((g) => h("th", null, g.n)));
    const rows = [];
    for (let y = y0; y <= y1; y++) {
      const i = y - START_YEAR;
      if (!agg.totals[i]) continue;
      rows.push(h("tr", null, h("td", null, String(y)), h("td", null, num(agg.totals[i])), ...groups.map((_, g) => h("td", null, agg.matrix[i * G + g] ? num(agg.matrix[i * G + g]) : "·"))));
    }
    $("tableWrap").replaceChildren(h("table", null, h("thead", null, head), h("tbody", null, rows)));
  }
  $("tableView").addEventListener("toggle", () => {
    const open = $("tableView").open;
    $("tableView").querySelector("summary").textContent = open ? t("table.hide") : t("table.show");
    if (open) renderTable();
  });

  /* ------------------------------------------------------------------ Wikipedia text (whole article, in the app's language) */
  const carName = (c) => (LANG === "fr" && c.fr ? c.fr : c.n);
  // French Wikipedia titles known from the data; others are looked up when needed
  const frTitleOf = new Map();
  for (const c of cars) if (c.fr) frTitleOf.set(c.n, c.fr);
  for (const m of makers) if (m.a && m.fr) frTitleOf.set(m.a, m.fr);
  for (const ms of D.milestones) if (ms.title && ms.fr) frTitleOf.set(ms.title, ms.fr);
  const wikiUrlIn = (lang, title) => `https://${lang}.wikipedia.org/wiki/` + encodeURIComponent(title.replace(/ /g, "_"));
  /** Link to the article in the app's language when we know it exists there. */
  const wikiLink = (enTitle) => (LANG === "fr" && frTitleOf.get(enTitle) ? wikiUrlIn("fr", frTitleOf.get(enTitle)) : wikiUrl(enTitle));

  const wikiCache = new Map();
  function wikiGet(lang, params) {
    const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams(Object.assign({}, params, { format: "json", formatversion: "2", origin: "*" }));
    if (wikiCache.has(url)) return wikiCache.get(url);
    const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))));
    wikiCache.set(url, p);
    p.catch(() => wikiCache.delete(url));
    return p;
  }
  const firstPage = (j) => (j && j.query && j.query.pages && j.query.pages[0]) || {};
  function fetchExtract(lang, title) {
    return wikiGet(lang, { action: "query", prop: "extracts|pageprops", ppprop: "disambiguation", explaintext: "1", exsectionformat: "wiki", redirects: "1", titles: title })
      .then((j) => {
        const pg = firstPage(j);
        const usable = !pg.missing && !(pg.pageprops && "disambiguation" in pg.pageprops);
        return { title: pg.title || title, text: usable ? pg.extract || "" : "" };
      });
  }
  function frTitleFor(enTitle) {
    if (frTitleOf.has(enTitle)) return Promise.resolve(frTitleOf.get(enTitle));
    return wikiGet("en", { action: "query", prop: "langlinks", lllang: "fr", redirects: "1", titles: enTitle })
      .then((j) => {
        const ll = (firstPage(j).langlinks || [])[0];
        const fr = ll ? ll.title || ll["*"] || null : null;
        frTitleOf.set(enTitle, fr);
        return fr;
      }, () => null);
  }
  /** The article in the app's language: {lang, title, text, fallback}. In French, falls back to English. */
  async function getArticle(enTitle) {
    if (LANG === "fr") {
      const fr = await frTitleFor(enTitle);
      // no interlanguage link: many car names are the same in French ("Fiat Panda", "Trabant"), so try that title too
      for (const cand of fr ? [fr] : [enTitle]) {
        try {
          const a = await fetchExtract("fr", cand);
          if (a.text.trim()) {
            if (!fr) frTitleOf.set(enTitle, a.title);
            return { lang: "fr", title: a.title, text: a.text, fallback: false };
          }
        } catch (e) { /* fall back to English */ }
      }
      const a = await fetchExtract("en", enTitle);
      return { lang: "en", title: a.title, text: a.text, fallback: true };
    }
    const a = await fetchExtract("en", enTitle);
    return { lang: "en", title: a.title, text: a.text, fallback: false };
  }

  // sections left out of the reading view (normalised: lower case, no accents)
  const SKIP_SECTIONS = new Set(["references", "notes", "see also", "external links", "further reading", "bibliography", "sources", "source",
    "gallery", "citations", "footnotes", "notes and references", "explanatory notes", "works cited", "notes et references", "voir aussi",
    "liens externes", "lien externe", "bibliographie", "articles connexes", "annexes", "galerie", "pour approfondir", "references externes"]);

  /** Plain-text article ("== Heading ==" markers) -> lead paragraphs + sections. */
  function parseArticle(text) {
    const lead = [], sections = [];
    let cur = null, skipping = 0, words = 0;
    for (const raw of (text || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^(={2,6})\s*(.*?)\s*\1$/.exec(line);
      if (m) {
        const level = m[1].length;
        if (skipping && level > skipping) continue;
        skipping = 0;
        if (SKIP_SECTIONS.has(norm(m[2]).replace(/[^a-z ]/g, "").trim())) { skipping = level; cur = null; continue; }
        cur = { level, title: m[2], paras: [] };
        sections.push(cur);
        continue;
      }
      if (skipping || line.length < 2) continue;
      (cur ? cur.paras : lead).push(line);
      words += line.split(/\s+/).length;
    }
    const kept = sections.filter((sec, k) => sec.paras.length || sections.slice(k + 1).some((n2) => n2.level > sec.level && n2.paras.length));
    return { lead, sections: kept, chapters: kept.filter((sec) => sec.level === 2).length || kept.length, minutes: Math.max(1, Math.round(words / 220)) };
  }

  /** Long text, clamped to a few lines with a "more" button (App Store style). */
  function clampText(box, lines) {
    requestAnimationFrame(() => {
      if (!box.isConnected) return;
      const lh = parseFloat(getComputedStyle(box).lineHeight) || 25;
      const max = Math.round(lh * lines);
      if (box.scrollHeight <= max + lh * 1.5) return;
      box.style.maxHeight = max + "px";
      const more = h("button", { class: "more-btn", type: "button", onclick: () => {
        more.remove();
        box.style.maxHeight = box.scrollHeight + "px";
        setTimeout(() => { box.style.maxHeight = "none"; }, 520);
      } }, t("textMore"));
      box.append(more);
    });
  }

  const langNotice = () => h("p", { class: "lang-note" }, icon("info"), h("span", null, t("art.englishOnly")));
  const toParas = (txt) => (txt || "").split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 1);

  /** The article's opening on a detail page, with "Read the Full Article". */
  function articleBlock(enTitle, fallbackText) {
    const box = h("div", { class: "art-block" });
    const text = h("div", { class: "d-text loading" }, h("p", null, t("art.loading")), h("p", null, "…"), h("p", null, "…"));
    box.append(text);
    const fallbackParas = toParas(fallbackText);
    if (!enTitle) {
      text.classList.remove("loading");
      text.replaceChildren(...(fallbackParas.length ? fallbackParas : [t("art.none")]).map((x) => h("p", null, x)));
      return box;
    }
    getArticle(enTitle).then((a) => {
      const art = parseArticle(a.text);
      text.classList.remove("loading");
      const paras = art.lead.length ? art.lead : fallbackParas.length ? fallbackParas : [t("art.none")];
      text.replaceChildren(...paras.map((x) => h("p", null, x)));
      if (a.fallback) box.prepend(langNotice());
      clampText(text, 6);
      if (art.sections.length) {
        box.append(h("div", { class: "list d-list art-list" },
          h("button", { class: "lrow tinted", type: "button", onclick: () => openDetail("article", enTitle) },
            h("span", { class: "row-icon" }, icon("book")),
            h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, t("art.full")), h("span", { class: "lrow-sub" }, t("art.meta", art.chapters, art.minutes))),
            icon("chevronRight", "chev"))));
      }
    }, () => {
      text.classList.remove("loading");
      text.replaceChildren(...(fallbackParas.length ? fallbackParas : [t("art.none")]).map((x) => h("p", null, x)), h("p", { class: "footnote" }, t("art.offline")));
    });
    return box;
  }

  /** The whole article, as a reading view pushed inside the sheet. */
  function buildArticle(enTitle) {
    const shown = LANG === "fr" && frTitleOf.get(enTitle) ? frTitleOf.get(enTitle) : enTitle;
    const eyebrow = h("p", { class: "d-eyebrow" }, t("wiki"));
    const title = h("h2", { class: "d-title", id: "sheetTitle" }, shown);
    const sub = h("p", { class: "d-sub" }, "");
    const body = h("div", { class: "d-body reader-body" },
      h("div", { class: "d-text loading" }, h("p", null, t("art.loading")), h("p", null, "…"), h("p", null, "…"), h("p", null, "…")));
    const page = h("div", { class: "sheet-page no-hero reader", "data-title": shown }, h("div", { class: "d-head" }, eyebrow, title, sub), body);
    getArticle(enTitle).then((a) => {
      const art = parseArticle(a.text);
      eyebrow.textContent = t("art.source", a.lang);
      title.textContent = a.title;
      page.dataset.title = a.title;
      if (page.isConnected && !page.classList.contains("leaving")) $("sheetNavTitle").textContent = a.title;
      sub.textContent = t("art.meta", art.chapters, art.minutes);
      const nodes = [];
      if (a.fallback) nodes.push(langNotice());
      const txt = h("div", { class: "reader-text" }, art.lead.map((x) => h("p", null, x)));
      for (const sec of art.sections) {
        txt.append(h(sec.level <= 2 ? "h3" : "h4", null, sec.title));
        for (const x of sec.paras) txt.append(h("p", null, x));
      }
      nodes.push(txt, linksList([[t("art.open"), wikiUrlIn(a.lang, a.title)]]), h("p", { class: "d-source" }, t("art.licence")));
      body.replaceChildren(...nodes);
    }, () => body.replaceChildren(h("p", { class: "footnote" }, t("art.offline")), linksList([[t("art.open"), wikiLink(enTitle)]])));
    return page;
  }

  /* ------------------------------------------------------------------ detail pages */
  function heroImage(code, alt) {
    const hero = h("div", { class: "d-hero" });
    if (!code) { hero.append(placeholder()); return hero; }
    hero.append(h("div", { class: "bg", style: { backgroundImage: `url("${thumbUrl(code, 120)}")` } }));
    const img = wikiImg(code, 500, alt);
    img.loading = "eager";
    hero.append(img);
    hero.append(h("a", { class: "credit", href: commonsPage(code), target: "_blank", rel: "noopener" }, t("wikimedia")));
    return hero;
  }

  function extLink(title, label) {
    return h("a", { class: "pill-btn filled", href: wikiLink(title), target: "_blank", rel: "noopener" }, label || t("wiki"), icon("arrowUpRight"));
  }

  function info(cap, val, sub, opts = {}) {
    const tag = opts.onclick ? "button" : "div";
    return h(tag, { class: "info", type: opts.onclick ? "button" : null, onclick: opts.onclick || null, "aria-label": opts.label || null },
      h("span", { class: "info-cap" }, cap),
      h("span", { class: "info-val" + (opts.cls ? " " + opts.cls : "") }, val),
      sub ? h("span", { class: "info-sub" }, sub) : null);
  }

  function secHead(title, action, onAction) {
    return h("div", { class: "d-sec-head" }, h("h3", null, title),
      action ? h("button", { class: "see-all", type: "button", onclick: onAction }, action) : null);
  }

  function shelf(ids, currentId) {
    const wrap = h("div", { class: "shelf" }, ids.map((id, k) => carTile(cars[id], k, id === currentId ? "current" : null)));
    if (currentId != null) requestAnimationFrame(() => {
      const cur = wrap.querySelector(".current");
      if (cur) wrap.scrollLeft = cur.offsetLeft - wrap.clientWidth / 2 + cur.clientWidth / 2;
    });
    return wrap;
  }

  function linksList(rows) {
    return h("div", { class: "list d-list" }, rows.filter(Boolean).map(([label, href]) =>
      h("a", { class: "lrow tinted", href, target: "_blank", rel: "noopener" },
        h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, label)), icon("arrowUpRight", "ext"))));
  }

  /** Lifespan ribbon: the car's production years on the whole timeline + sibling models. */
  function ribbon(c) {
    const box = h("div", { class: "ribbon" });
    requestAnimationFrame(() => {
      const W = box.clientWidth || 380, H = 58;
      const a = Math.min(D.firstYear, c.y) - 2, b = D.lastYear + 1;
      const x = (y) => 5 + ((y - a) / (b - a)) * (W - 10);
      const svg = s("svg", { viewBox: `0 0 ${W} ${H}` });
      const base = 32;
      svg.append(s("line", { class: "rb-track", x1: x(a), x2: x(b), y1: base, y2: base }));
      for (let y = Math.ceil(a / 20) * 20; y <= b; y += 20) {
        svg.append(s("line", { class: "rb-track", x1: x(y), x2: x(y), y1: base - 3, y2: base + 3 }));
        if (W > 420 || y % 40 === 0) svg.append(s("text", { class: "rb-tick", x: x(y), y: H - 2, "text-anchor": "middle" }, String(y)));
      }
      if (c.m >= 0) {
        for (const id of makerCars[c.m]) {
          if (id === c._i) continue;
          const o = cars[id];
          const dot = s("circle", { class: "rb-other", cx: x(o.y + 0.5), cy: base, r: 3.4 });
          dot.append(s("title", null, `${carName(o)} (${yearsLabel(o)})`));
          dot.addEventListener("click", () => openDetail("car", id));
          svg.append(dot);
        }
      }
      const end = c.e || c.y;
      svg.append(s("rect", { class: "rb-life", x: x(c.y), y: base - 4.5, width: Math.max(9, x(end + 1) - x(c.y)), height: 9, rx: 4.5 }));
      const lx = clamp(x((c.y + end + 1) / 2), 30, W - 30);
      svg.append(s("text", { class: "rb-lbl", x: lx, y: base - 11, "text-anchor": "middle" }, yearsLabel(c)));
      box.append(svg);
    });
    return box;
  }

  // model families: "Jeep Grand Cherokee" and its generations "Jeep Grand Cherokee (ZJ)", "(WJ)"…
  const families = new Map();
  for (const c of cars) pushFamily(splitTitle(c.n)[0], c._i);
  function pushFamily(k, i) { let a = families.get(k); if (!a) families.set(k, (a = [])); a.push(i); }
  for (const a of families.values()) a.sort((x, y) => cars[x].y - cars[y].y || (splitTitle(cars[x].n)[1] ? 1 : 0) - (splitTitle(cars[y].n)[1] ? 1 : 0));

  const capFirst = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);

  function buildCar(i) {
    const c = cars[i];
    const m = c.m >= 0 ? makers[c.m] : null;
    const [name, paren] = splitTitle(carName(c));
    const bodyGroup = D.dims.body.groups[c.b];
    const flag = flagOf(c.c);
    const infos = [
      info(t("info.introduced"), String(c.y), c.e && c.e !== c.y ? t("info.until", c.e) : t("info.modelYear")),
      m ? info(t("info.maker"), makerTile(m, "sm"), m.n, { onclick: () => openDetail("maker", c.m), label: t("info.makerLabel", m.n) }) : null,
      info(t("info.country"), flag || (c.c >= 0 ? countryName(c.c) : "—"), flag ? countryName(c.c) : null, { cls: flag ? "flag" : "text" }),
      bodyGroup && !bodyGroup.other ? info(t("info.body"), bodyGroup.short || bodyGroup.n, bodyGroup.short && bodyGroup.short !== bodyGroup.n ? bodyGroup.n : t("info.style"), { cls: "text" }) : null,
      c.e && c.e > c.y ? info(t("info.production"), String(c.e - c.y + 1), t("info.years")) : null,
      c.p ? info(t("info.wikipedia"), String(c.p), t("info.language", c.p)) : null,
    ];
    const tags = (c.t || []).map((x) => h("span", { class: "d-tag" }, D.tags[x]));
    const sameYear = cars.filter((o) => o.y === c.y && o._i !== i).sort((a, b) => b.p - a.p).slice(0, 16).map((o) => o._i);
    const family = families.get(splitTitle(c.n)[0]) || [];

    return h("div", { class: "sheet-page", "data-title": name },
      heroImage(c.i, carName(c)),
      h("div", { class: "d-head" },
        h("h2", { class: "d-title", id: "sheetTitle" }, name, paren ? h("small", null, ` (${paren})`) : null),
        h("p", { class: "d-sub" }, c.s ? capFirst(c.s) : [m && m.n, yearsLabel(c)].filter(Boolean).join(" · ")),
        h("div", { class: "d-actions" },
          extLink(c.n),
          h("button", { class: "pill-btn gray", type: "button", onclick: () => revealYear(c.y) }, icon("chart"), t("see", c.y)))),
      h("div", { class: "info-strip" }, infos),
      h("div", { class: "d-body" },
        garageControls(c),
        tags.length ? h("div", { class: "d-tags" }, tags) : null,
        articleBlock(c.n, c.s),
        family.length > 1 ? h("section", { class: "d-sec" }, secHead(t("sec.generations")), shelf(family, i)) : null,
        h("section", { class: "d-sec" },
          secHead(m ? t("sec.inHistory", m.n) : t("sec.placeInHistory")),
          h("p", { class: "d-note" }, m ? t("note.ribbonMaker", m.n) : t("note.ribbon")),
          ribbon(c)),
        m && makerCars[c.m].length > 1 ? h("section", { class: "d-sec" },
          secHead(t("sec.moreFrom", m.n), t("seeAll"), () => openDetail("maker", c.m)),
          shelf(makerCars[c.m].slice(0, 150), i)) : null,
        sameYear.length ? h("section", { class: "d-sec" },
          secHead(t("sec.alsoNew", c.y), t("seeAll"), () => revealYear(c.y)),
          shelf(sameYear)) : null,
        saleLinks(c),
        linksList([[t("link.read"), wikiLink(c.n)], c.i ? [t("link.photo"), commonsPage(c.i)] : null]),
        h("p", { class: "d-source" }, t("src.car")))
    );
  }

  /** "Find one for sale": the sites' own search pages (nothing is copied into the app). */
  function saleLinks(c) {
    const name = splitTitle(c.fr || c.n)[0];          // French ads use the French name ("Volkswagen Coccinelle")
    const row = (href, title, sub, ic) => h("a", { class: "lrow tinted", href, target: "_blank", rel: "noopener" },
      h("span", { class: "row-icon" }, icon(ic)),
      h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, title), h("span", { class: "lrow-sub" }, sub)),
      icon("arrowUpRight", "ext"));
    return h("section", { class: "d-sec" },
      secHead(t("sale.head")),
      h("p", { class: "d-note" }, t("sale.note")),
      h("div", { class: "list d-list sale-list" },
        row("https://www.leboncoin.fr/recherche?category=2&text=" + encodeURIComponent(name), t("sale.lbc"), t("sale.lbcSub"), "tag"),
        row("https://www.google.com/search?q=" + encodeURIComponent(t("sale.query", name)), t("sale.web"), t("sale.webSub"), "search")));
  }

  function modelRow(id) {
    const c = cars[id];
    const [name, paren] = splitTitle(carName(c));
    const th = h("span", { class: "row-thumb" });
    if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder());
    return markCarRow(h("button", { class: "lrow", type: "button", onclick: () => openDetail("car", id) },
      th,
      h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, name + (paren ? ` (${paren})` : "")), h("span", { class: "lrow-sub" }, yearsLabel(c) + (c.s ? ` · ${c.s}` : ""))),
      icon("chevronRight", "chev")), c);
  }

  function buildMaker(mi) {
    const m = makers[mi];
    const ids = makerCars[mi];
    const years = ids.map((id) => cars[id].y);
    const col = COLORS.country[makerGroup(m)];
    const y0 = Math.min(...years, m.f || 9999), y1 = Math.max(...years, m.d || 0);
    const counts = {};
    for (const y of years) counts[y] = (counts[y] || 0) + 1;
    const chartBox = h("div", { class: "mini-chart" });
    const showN = 25;
    const list = h("div", { class: "list models-list" }, ids.slice(0, showN).map(modelRow));
    if (ids.length > showN) {
      const moreRow = h("button", { class: "lrow tinted", type: "button", onclick: () => { moreRow.remove(); ids.slice(showN).forEach((id) => list.append(modelRow(id))); } },
        h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, t("showAllModels", num(ids.length)))));
      list.append(moreRow);
    }
    const hero = !m.logo && m.i;
    const flag = flagOf(m.c);
    const page = h("div", { class: "sheet-page" + (hero ? "" : " no-hero"), "data-title": m.n },
      hero ? heroImage(m.i, m.n) : null,
      h("div", { class: "d-head" },
        h("div", { class: "app-head" },
          hero ? null : makerTile(m, "xl"),
          h("div", { class: "app-head-txt" },
            h("h2", { class: "d-title", id: "sheetTitle" }, m.n),
            h("p", { class: "d-sub" }, m.s ? capFirst(m.s) : countryName(m.c)),
            h("div", { class: "d-actions" },
              m.a ? extLink(m.a) : null,
              ids.length ? h("button", { class: "pill-btn gray", type: "button", onclick: () => focusMaker(mi) }, icon("chart"), t("timelineBtn")) : null)))),
      h("div", { class: "info-strip" },
        info(t("info.founded"), m.f ? String(m.f) : "—", m.f ? t("info.yearsAgo", D.lastYear - m.f) : null),
        info(m.d ? t("info.closed") : t("info.status"), m.d ? String(m.d) : m.f ? t("info.active") : "—", m.d && m.f ? t("info.after", m.d - m.f) : m.f ? t("todayLc") : null, { cls: m.d ? "" : "text" }),
        info(t("info.country"), flag || countryName(m.c), flag ? countryName(m.c) : null, { cls: flag ? "flag" : "text" }),
        info(t("info.models"), num(ids.length), t("info.onWikipedia")),
        m.p ? info(t("info.wikipedia"), String(m.p), t("info.language", m.p)) : null),
      h("div", { class: "d-body" },
        makerFavButton(m),
        ids.length ? h("section", { class: "d-sec" },
          secHead(t("sec.perYear")),
          h("p", { class: "d-note" }, coarse ? t("note.barTouch") : t("note.barMouse")),
          chartBox) : null,
        ownershipSection(ownOfMaker.get(mi)),
        m.a ? h("section", { class: "d-sec" }, secHead(t("sec.about")), articleBlock(m.a, m.s)) : null,
        ids.length ? h("section", { class: "d-sec" }, secHead(t("sec.models")), list) : null,
        m.a ? linksList([[t("link.read"), wikiLink(m.a)], m.i ? [t("link.image"), commonsPage(m.i)] : null]) : null,
        m.a ? h("p", { class: "d-source" }, t("src.text")) : null)
    );
    if (ids.length) requestAnimationFrame(() => miniHistogram(chartBox, counts, Math.min(y0, y1), Math.max(y0, y1), col, (y) => focusMaker(mi, y)));
    return page;
  }

  function buildMilestone(k) {
    const ms = D.milestones[k];
    const prev = D.milestones[k - 1], next = D.milestones[k + 1];
    const era = eraOf(ms.year);
    const shownTitle = LANG === "fr" && ms.fr ? ms.fr : ms.title;
    return h("div", { class: "sheet-page", "data-title": ms.label },
      heroImage(ms.i, ms.label),
      h("div", { class: "d-head" },
        h("p", { class: "d-eyebrow" }, t("ms.eyebrowYear", ms.year)),
        h("h2", { class: "d-title", id: "sheetTitle" }, ms.label),
        h("p", { class: "d-sub" }, ms.s ? `${shownTitle} — ${ms.s}` : shownTitle),
        h("div", { class: "d-actions" },
          extLink(ms.title),
          h("button", { class: "pill-btn gray", type: "button", onclick: () => revealYear(ms.year) }, icon("chart"), t("see", ms.year)))),
      h("div", { class: "info-strip" },
        info(t("info.year"), String(ms.year), t("info.yearsAgo", D.lastYear - ms.year)),
        era ? info(t("info.era"), era.short || era.name, eraYears(era), { cls: "text" }) : null,
        info(t("info.milestone"), `${k + 1}`, t("info.of", D.milestones.length))),
      h("div", { class: "d-body" },
        articleBlock(ms.title, LANG === "en" && ms.x ? ms.x : ms.s),
        h("div", { class: "pn" },
          prev ? h("button", { class: "pn-card", type: "button", onclick: () => openDetail("milestone", k - 1, { replace: true, dir: "pop" }) },
            h("small", null, t("prev")), h("b", null, prev.label), h("span", null, String(prev.year))) : h("span"),
          next ? h("button", { class: "pn-card next", type: "button", onclick: () => openDetail("milestone", k + 1, { replace: true, dir: "push" }) },
            h("small", null, t("next")), h("b", null, next.label), h("span", null, String(next.year))) : null),
        linksList([[t("link.read"), wikiLink(ms.title)], ms.i ? [t("link.image"), commonsPage(ms.i)] : null]),
        h("p", { class: "d-source" }, t("src.text")))
    );
  }

  /* ------------------------------------------------------------------ sheet (card presentation + push navigation) */
  const sheet = $("sheet"), scrim = $("scrim"), stack = $("sheetStack"), sheetNav = $("sheetNav");
  let sheetOpen = false;
  let lastFocus = null;
  let curDepth = 0;

  function syncSheetNav(page) {
    const title = page.querySelector(".d-title");
    const limit = title ? title.offsetTop + title.offsetHeight - 56 : 30;
    sheetNav.classList.toggle("solid", page.scrollTop > limit);
  }

  function present(page, dir) {
    const old = [...stack.children].filter((p) => !p.classList.contains("leaving")).pop();
    stack.append(page);
    page.addEventListener("scroll", () => syncSheetNav(page), { passive: true });
    attachPull(page);
    $("sheetNavTitle").textContent = page.dataset.title || "";
    sheet.classList.toggle("no-hero", page.classList.contains("no-hero"));
    syncSheetNav(page);
    if (!old) return;
    const done = () => old.remove();
    if (dir === "none" || reduceMotion.matches || !old.animate) { done(); return; }
    old.classList.add("leaving");
    const W = stack.clientWidth;
    const easing = "cubic-bezier(.32,.72,0,1)", duration = 480;
    if (dir === "push") {
      page.classList.add("entering");
      page.animate([{ transform: `translateX(${W}px)` }, { transform: "translateX(0)" }], { duration, easing }).onfinish = () => page.classList.remove("entering");
      old.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-W * 0.3}px)` }], { duration, easing, fill: "forwards" }).onfinish = done;
    } else if (dir === "pop") {
      old.style.zIndex = "2";
      old.classList.add("entering");
      page.animate([{ transform: `translateX(${-W * 0.3}px)` }, { transform: "translateX(0)" }], { duration, easing });
      old.animate([{ transform: "translateX(0)" }, { transform: `translateX(${W}px)` }], { duration, easing, fill: "forwards" }).onfinish = done;
    } else {
      page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" }).onfinish = done;
    }
  }

  function routeFor(type, id) {
    if (type === "car") return "#/car/" + encodeURIComponent(cars[id].n);
    if (type === "maker") return "#/maker/" + encodeURIComponent(makers[id].n);
    if (type === "company") return "#/company/" + id;
    if (type === "article") return "#/article/" + encodeURIComponent(id);
    return "#/milestone/" + id;
  }

  function openDetail(type, id, opts = {}) {
    if (id == null || id < 0) return;
    const depth = (history.state && history.state.depth) || 0;
    const url = routeFor(type, id);
    if (opts.replace && sheetOpen) histReplace({ depth }, url);
    else histPush({ depth: depth + 1 }, url);
    showDetail(type, id, opts.dir || (opts.replace ? "replace" : "push"));
  }

  function showDetail(type, id, dir) {
    hideTip();
    stopPlay();
    const page = type === "car" ? buildCar(id) : type === "maker" ? buildMaker(id) : type === "company" ? buildCompany(id)
      : type === "article" ? buildArticle(id) : buildMilestone(id);
    const depth = (history.state && history.state.depth) || 1;
    $("sheetBack").hidden = depth <= 1;
    if (!sheetOpen) {
      stack.replaceChildren();
      present(page, "none");
      openSheetChrome();
    } else present(page, dir || "push");
    curDepth = depth;
    if (type === "car" || type === "maker") remember(type, id);
  }

  function openSheetChrome() {
    sheetOpen = true;
    lastFocus = document.activeElement;
    scrim.hidden = false;
    sheet.inert = false;
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("sheet-open");
    sheet.style.setProperty("--drag", "0px");
    recede(true);
    requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("open"); }));
    setTimeout(() => sheet.focus({ preventScroll: true }), 80);
  }

  function hideSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    curDepth = 0;
    sheet.classList.remove("open", "dragging");
    scrim.classList.remove("show");
    scrim.style.opacity = "";
    sheet.setAttribute("aria-hidden", "true");
    sheet.inert = true;
    document.body.classList.remove("sheet-open");
    recede(false);
    setTimeout(() => { if (!sheetOpen) { scrim.hidden = true; stack.replaceChildren(); sheet.style.setProperty("--drag", "0px"); } }, 560);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  /* Close the sheet by unwinding its history entries; `then` runs once that is done. */
  let afterClose = null;
  function closeSheet(then) {
    const depth = (history.state && history.state.depth) || 0;
    if (depth > 0 && sheetOpen) { afterClose = then || null; history.go(-depth); }
    else { histReplace(null, tabRoute()); hideSheet(); if (then) then(); }
  }

  $("sheetClose").onclick = () => closeSheet();
  $("sheetBack").onclick = () => history.back();
  scrim.onclick = () => closeSheet();
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && sheetOpen) { ev.preventDefault(); closeSheet(); }
  });

  /* On phones the page behind the sheet recedes, like an iOS card sheet. */
  function recede(on) {
    const app = $("app"), root = document.documentElement;
    if (on) {
      if (!phoneMQ.matches || reduceMotion.matches) return;
      const y = scrollY;
      app.style.transformOrigin = `50% ${y + innerHeight / 2}px`;
      app.style.clipPath = `inset(${y}px 0 ${Math.max(0, app.offsetHeight - y - innerHeight)}px 0 round 20px)`;
      root.classList.add("receded");
    } else if (root.classList.contains("receded")) {
      root.classList.remove("receded");
      setTimeout(() => { if (!sheetOpen) { app.style.clipPath = ""; app.style.transformOrigin = ""; } }, 520);
    }
  }

  /* Drag the sheet down to dismiss it: from the grabber, or by pulling down when its content is at the top. */
  const drag = { active: false, y0: 0, last: 0, t: 0, v: 0, dy: 0 };
  function dragStart(y) {
    drag.active = true; drag.y0 = y; drag.last = y; drag.t = performance.now(); drag.v = 0; drag.dy = 0;
    sheet.classList.add("dragging");
  }
  function dragMove(y) {
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.v = 0.7 * ((y - drag.last) / dt) + 0.3 * drag.v;
    drag.last = y; drag.t = now;
    const raw = y - drag.y0;
    drag.dy = raw > 0 ? raw : raw / 8; // a little rubber band upwards
    sheet.style.setProperty("--drag", drag.dy.toFixed(1) + "px");
    scrim.style.opacity = String(clamp(1 - drag.dy / (sheet.offsetHeight * 0.9), 0, 1));
  }
  function dragEnd() {
    if (!drag.active) return;
    drag.active = false;
    sheet.classList.remove("dragging");
    scrim.style.opacity = "";
    if (drag.dy > 140 || (drag.v > 0.55 && drag.dy > 24)) closeSheet();
    else sheet.style.setProperty("--drag", "0px");
  }
  (function grabber() {
    const grab = $("sheetGrab");
    grab.addEventListener("pointerdown", (ev) => { dragStart(ev.clientY); try { grab.setPointerCapture(ev.pointerId); } catch (e) {} });
    grab.addEventListener("pointermove", (ev) => { if (drag.active) dragMove(ev.clientY); });
    grab.addEventListener("pointerup", dragEnd);
    grab.addEventListener("pointercancel", dragEnd);
  })();
  function attachPull(page) {
    let st = null;
    page.addEventListener("touchstart", (e) => {
      st = page.scrollTop <= 0 && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { passive: true });
    page.addEventListener("touchmove", (e) => {
      if (!st) return;
      const t = e.touches[0];
      if (!drag.active) {
        const dx = t.clientX - st.x, dy = t.clientY - st.y;
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) { st = null; return; }
        if (dy < 8 || page.scrollTop > 0) return;
        dragStart(st.y);
      }
      e.preventDefault();
      dragMove(t.clientY);
    }, { passive: false });
    const end = () => { st = null; dragEnd(); };
    page.addEventListener("touchend", end);
    page.addEventListener("touchcancel", end);
  }

  /* ------------------------------------------------------------------ jumping to the timeline */
  function resetToModels() {
    if (state.metric !== "models") { setMetric("models"); return true; }
    return false;
  }

  function revealYear(y) {
    if (sheetOpen) { closeSheet(() => revealYear(y)); return; }
    if (tab !== "timeline") setTab("timeline");
    if (resetToModels()) refresh();
    const [a, b] = chart.view;
    const t = Warp.t(y + 0.5);
    if (t < a || t > b || b - a > 0.6) {
      const span = Math.min(b - a, Warp.t(2000) - Warp.t(1960));
      chart.setView(t - span / 2, t + span / 2, true);
    }
    selectYear(y);
    setTimeout(() => {
      $("chartCard").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
      setTimeout(() => showYearTip(y), 520);
    }, 380);
  }

  function focusMaker(mi, year) {
    if (sheetOpen) { closeSheet(() => focusMaker(mi, year)); return; }
    state.maker = mi;
    state.kind = null;
    state.off.country.clear();
    state.off.body.clear();
    resetToModels();
    renderPills();
    if (tab !== "timeline") setTab("timeline");
    refresh({ grow: true });
    const ys = makerCars[mi].map((id) => cars[id].y);
    if (ys.length) chart.showYears(Math.min(...ys), Math.max(...ys), true);
    selectYear(year != null ? year : null);
    setTimeout(() => $("chartCard").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" }), 380);
  }

  /* ------------------------------------------------------------------ tabs */
  const TABS = ["timeline", "milestones", "makers", "garage", "search"];
  const scrollMem = {};
  let tab = "timeline";

  function tabRoute(t = tab) {
    if (t === "timeline") return state.sel != null ? `#/year/${state.sel}` : "#/";
    return `#/${t}`;
  }

  function syncTabbar(instant) {
    for (const b of document.querySelectorAll("#tabbar [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    const lens = $("tabLens");
    const cur = $("tabs").querySelector(`[data-tab="${tab}"]`);
    if (instant) lens.classList.add("instant");
    if (cur && cur.offsetWidth) {
      lens.style.opacity = "1";
      lens.style.width = cur.offsetWidth + "px";
      lens.style.transform = `translateX(${cur.offsetLeft}px)`;
    } else lens.style.opacity = "0";
    if (instant) requestAnimationFrame(() => lens.classList.remove("instant"));
    $("makerIndex").hidden = tab !== "makers" || makerMode !== "az" || !!makerQuery.trim() || sheetOpen;
  }
  new ResizeObserver(() => syncTabbar(true)).observe($("tabs"));

  function setTab(t, opts = {}) {
    if (!TABS.includes(t)) t = "timeline";
    if (t === tab && !opts.force) {
      if (!opts.fromRoute) {
        if (t === "search") $("searchInput").focus();
        else scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }); // tap the current tab: back to the top
      }
      return;
    }
    scrollMem[tab] = scrollY;
    hideTip();
    stopPlay();
    const prev = tab;
    tab = t;
    for (const x of TABS) $("view-" + x).hidden = x !== t;
    document.documentElement.dataset.tab = t;
    if (t === "milestones") buildMilestones();
    if (t === "makers") buildMakers();
    if (t === "search") renderSearch();
    if (t === "garage") renderGarage();
    if (t === "search" && opts.focus) $("searchInput").focus(); // synchronously, so iOS shows the keyboard
    syncTabbar();
    if (t === "timeline") { chart.draw(); overview.draw(); for (const id of ["metricSeg", "colorSeg"]) syncSeg($(id), true); }
    if (t === "makers") syncSeg($("makerSortSeg"), true);
    scrollTo(0, scrollMem[t] || 0);
    if (!reduceMotion.matches && prev !== t) {
      $("view-" + t).animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(.32,.72,0,1)" });
    }
    if (!opts.fromRoute && !sheetOpen) histReplace(history.state, tabRoute(t));
    $("navTitle").textContent = $("view-" + t).dataset.title;
    watchTitle();
    updateNavbar();
  }
  for (const b of document.querySelectorAll("#tabbar [data-tab]")) {
    b.addEventListener("click", () => setTab(b.dataset.tab, { focus: true }));
  }
  $("navBrand").addEventListener("click", (ev) => { ev.preventDefault(); setTab("timeline"); });

  /* large title → compact title in the navigation bar */
  let titleIO = null;
  function watchTitle() {
    if (titleIO) titleIO.disconnect();
    const lt = $("view-" + tab).querySelector(".large-title");
    if (lt) $("navbar").classList.toggle("titled", lt.getBoundingClientRect().bottom < $("navbar").offsetHeight);
    if (!lt || !("IntersectionObserver" in window)) return;
    titleIO = new IntersectionObserver(([e]) => {
      $("navbar").classList.toggle("titled", !e.isIntersecting && e.boundingClientRect.top < 100);
    }, { rootMargin: `-${$("navbar").offsetHeight}px 0px 0px 0px`, threshold: 0 });
    titleIO.observe(lt);
  }
  function updateNavbar() { $("navbar").classList.toggle("glassy", scrollY > 4); }
  addEventListener("scroll", updateNavbar, { passive: true });

  /* ------------------------------------------------------------------ Milestones tab */
  let msBuilt = false;
  function buildMilestones() {
    if (msBuilt) return;
    msBuilt = true;
    $("msEyebrow").textContent = t("ms.eyebrow", D.milestones.length, D.milestones[0].year, D.milestones[D.milestones.length - 1].year);
    const nodes = [];
    for (const e of D.eras) {
      const list = D.milestones.map((m, k) => [m, k]).filter(([m]) => m.year >= e.from && m.year <= e.to);
      if (!list.length) continue;
      nodes.push(h("section", { class: "ms-era" },
        h("div", { class: "ms-era-head" },
          h("p", { class: "eyebrow" }, eraYears(e)),
          h("h2", { class: "title2" }, e.name),
          h("p", { class: "ms-era-text" }, e.text)),
        h("div", { class: "today-grid" }, list.map(([m, k], j) => todayCard(m, k, j)))));
    }
    $("msList").replaceChildren(...nodes);
  }
  function todayCard(m, k, j) {
    const card = h("button", { class: "today", type: "button", style: { "--i": j }, onclick: () => openDetail("milestone", k), "aria-label": `${m.year}: ${m.label}` });
    if (m.i) card.append(wikiImg(m.i, 500, "")); else card.append(placeholder());
    card.append(
      h("span", { class: "today-shade" }),
      h("span", { class: "today-txt" },
        h("span", { class: "today-year" }, String(m.year)),
        h("span", { class: "today-title" }, m.label),
        h("span", { class: "today-sub" }, m.title !== m.label ? m.title + (m.s ? ` — ${m.s}` : "") : (m.s || ""))));
    return card;
  }

  /* ------------------------------------------------------------------ Makers tab */
  let makerMode = "az", makerQuery = "", makersBuilt = false;
  const slug = (k) => "mk-" + norm(k).replace(/[^a-z0-9]+/g, "-");
  function buildMakers() { if (!makersBuilt) { makersBuilt = true; renderMakers(); } }

  function makerListRow(m) {
    const meta = [
      makerMode !== "country" ? countryLabel(m.c) : null,
      m.f ? `${m.f}–${m.d || t("todayLc")}` : null,
      m._count ? t("nModels", m._count) : null,
    ].filter(Boolean).join(" · ");
    return h("button", { class: "lrow" + (isFavMaker(m) ? " is-fav" : ""), type: "button", "data-maker": String(m._i), onclick: () => openDetail("maker", m._i) },
      makerTile(m),
      h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, m.n, icon("heartFill", "fav-mark")), h("span", { class: "lrow-sub" }, meta)),
      icon("chevronRight", "chev"));
  }

  function renderMakers() {
    const groupsMode = makerMode === "groups";
    $("ownView").hidden = !groupsMode;
    $("makerList").hidden = groupsMode;
    $("makerFilter").closest(".searchfield").hidden = groupsMode;
    if (groupsMode) {
      $("makerList").classList.remove("with-index");
      $("makerIndex").replaceChildren();
      renderOwnership(false);
      syncTabbar();
      return;
    }
    stopOwnPlay();
    const tokens = norm(makerQuery.trim()).split(/\s+/).filter(Boolean);
    const list = makers.filter((m) => !tokens.length || tokens.every((t) => m._n.includes(t)));
    let keyOf, sortRows, sortKeys;
    if (makerMode === "az") {
      keyOf = (m) => { const ch = (m._n.replace(/^[^a-z0-9]+/, "")[0] || "#"); return /[a-z]/.test(ch) ? ch.toUpperCase() : "#"; };
      sortRows = (a, b) => a.n.localeCompare(b.n);
      sortKeys = (a, b) => (a === "#") - (b === "#") || a.localeCompare(b);
    } else if (makerMode === "country") {
      keyOf = (m) => String(m.c);
      sortRows = (a, b) => b.p - a.p || a.n.localeCompare(b.n);
      sortKeys = null;
    } else {
      keyOf = (m) => (m.f ? String(Math.floor(m.f / 10) * 10) : "?");
      sortRows = (a, b) => (a.f || 9999) - (b.f || 9999) || a.n.localeCompare(b.n);
      sortKeys = (a, b) => (a === "?") - (b === "?") || +a - +b;
    }
    list.sort(sortRows);
    const groups = new Map();
    for (const m of list) { const k = keyOf(m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const keys = [...groups.keys()];
    if (makerMode === "country") keys.sort((a, b) => (a === "-1") - (b === "-1") || groups.get(b).length - groups.get(a).length);
    else keys.sort(sortKeys);
    const label = (k) => makerMode === "country" ? countryLabel(+k) : makerMode === "founded" ? (k === "?" ? t("makers.unknownFounding") : t("makers.foundedIn", k)) : k;

    $("makerCount").textContent = tokens.length ? t("makers.countOf", num(list.length), num(makers.length)) : t("makers.count", num(makers.length), num(new Set(makers.map((m) => m.c).filter((c) => c >= 0)).size));
    $("makerList").replaceChildren(...(keys.length
      ? keys.map((k) => h("section", { class: "lsec", id: slug(k) },
          h("h3", { class: "lsec-head" }, label(k), h("span", null, num(groups.get(k).length))),
          h("div", { class: "list" }, groups.get(k).map(makerListRow))))
      : [h("div", { class: "empty-state" }, h("b", null, t("noResults")), t("makers.none", makerQuery.trim()))]));
    $("makerIndex").replaceChildren(...(makerMode === "az" ? keys : []).map((k) => h("span", { "data-k": k }, k)));
    $("makerList").classList.toggle("with-index", makerMode === "az" && !tokens.length);
    syncTabbar();
  }
  bindSeg("makerSortSeg", () => makerMode, (v) => { makerMode = v; renderMakers(); scrollTo(0, 0); });
  function setMakerMode(v) { makerMode = v; setSegValue("makerSortSeg", v); renderMakers(); }
  $("makerFilter").addEventListener("input", debounce(() => {
    makerQuery = $("makerFilter").value;
    $("makerClear").hidden = !makerQuery;
    renderMakers();
  }, 80));
  $("makerClear").onclick = () => { $("makerFilter").value = ""; makerQuery = ""; $("makerClear").hidden = true; renderMakers(); $("makerFilter").focus(); };

  (function indexBar() {
    const bar = $("makerIndex");
    let on = false;
    const jump = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const k = el && el.dataset && el.dataset.k;
      if (!k) return;
      const sec = $(slug(k));
      if (sec) scrollTo(0, sec.getBoundingClientRect().top + scrollY - $("navbar").offsetHeight + 1);
    };
    bar.addEventListener("pointerdown", (ev) => { on = true; bar.classList.add("active"); try { bar.setPointerCapture(ev.pointerId); } catch (e) {} jump(ev); ev.preventDefault(); });
    bar.addEventListener("pointermove", (ev) => { if (on) jump(ev); });
    const off = () => { on = false; bar.classList.remove("active"); };
    bar.addEventListener("pointerup", off);
    bar.addEventListener("pointercancel", off);
  })();

  /* ------------------------------------------------------------------ who owns whom, year by year */
  const OWN = D.owners || { nodes: [], links: [] };
  const ownNodes = OWN.nodes.map(([m, n, logo, f, d, wiki], i) => ({ i, m, n, logo, f, d, wiki: m >= 0 ? makers[m].a : wiki }));
  const pushMap = (map, k, v) => { let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(v); };
  const ownByChild = new Map(), ownByParent = new Map();
  for (const [c, p, a, b, fl] of OWN.links) { const l = { c, p, a, b, fl }; pushMap(ownByChild, c, l); pushMap(ownByParent, p, l); }
  const ownOfMaker = new Map();
  ownNodes.forEach((n) => { if (n.m >= 0) ownOfMaker.set(n.m, n.i); });
  const firstWord = (t) => norm(t).split(/[\s-]/)[0];
  const isBranch = (c, p) => { const w = firstWord(ownNodes[p].n); return w.length >= 3 && norm(ownNodes[c].n).startsWith(w + " "); };
  const linkActive = (l, y) => l.a <= y && (l.b == null || y < l.b);
  const spanText = (l) => (l.b ? (l.fl & 1 ? t("own.about", `${l.a}–${l.b}`) : `${l.a}–${l.b}`) : (l.fl & 1 ? t("own.about", t("own.since", l.a)) : t("own.since", l.a)));

  /** The ownership forest in year y: each company's main owner that year, and the groups (trees). */
  function ownForest(y, withBranches) {
    const par = new Map();
    for (const [c, ls] of ownByChild) {
      let best = null, bs = -1;
      for (const l of ls) if (linkActive(l, y)) { const sc = (l.fl & 1 ? 0 : 100000) + l.a; if (sc > bs) { bs = sc; best = l; } }
      if (best) par.set(c, best);
    }
    for (const c of [...par.keys()]) { // break cycles (two companies owning each other in the data)
      const seen = new Set([c]);
      let x = par.get(c).p;
      while (par.has(x)) { if (seen.has(x)) { par.delete(c); break; } seen.add(x); x = par.get(x).p; }
    }
    let kids = new Map();
    for (const [c, l] of par) pushMap(kids, l.p, c);
    if (!withBranches) for (const [c, l] of [...par]) if (!kids.has(c) && isBranch(c, l.p)) par.delete(c);
    kids = new Map();
    for (const [c, l] of par) pushMap(kids, l.p, c);
    const size = (n) => (kids.get(n) || []).reduce((t, k) => t + 1 + size(k), 0);
    const groups = [...kids.keys()].filter((p) => !par.has(p)).map((r) => ({ root: r, size: size(r) }))
      .sort((a, b) => b.size - a.size || ownNodes[a.root].n.localeCompare(ownNodes[b.root].n));
    return { par, kids, groups };
  }

  function openCompany(i) {
    const n = ownNodes[i];
    if (n.m >= 0) openDetail("maker", n.m); else openDetail("company", i);
  }

  function ownAvatar(n, cls) {
    const el = h("span", { class: "on-av" + (cls ? " " + cls : "") });
    if (n.logo) {
      const img = h("img", { alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", src: thumbUrl(n.logo, 120) });
      img.addEventListener("error", () => { el.classList.add("letter"); el.textContent = initials(n.n); });
      el.append(img);
    } else { el.classList.add("letter"); el.textContent = initials(n.n); }
    return el;
  }

  function companyTile(n, size) {
    const el = ownAvatar(n, "tile" + (size ? " " + size : ""));
    return el;
  }

  const own = { year: D.lastYear, scope: "major", branches: false, timer: 0, raf: 0, focus: null };
  const OWN_FIRST = 1890;

  function ownKid(k, F) {
    const l = F.par.get(k);
    const n = ownNodes[k];
    const subs = [];
    const walk = (x) => { for (const c of (F.kids.get(x) || []).slice().sort((a, b) => ownNodes[a].n.localeCompare(ownNodes[b].n))) { subs.push(c); walk(c); } };
    walk(k);
    return h("div", { class: "own-kid" + (l.fl & 1 ? " approx" : "") + (subs.length > 8 ? " wide" : "") },
      h("button", { class: "on-node", type: "button", "data-node": String(k), title: `${n.n} — ${spanText(l)}`, onclick: () => openCompany(k) },
        ownAvatar(n), h("span", { class: "on-name" }, n.n), h("span", { class: "on-since" }, l.fl & 1 ? t("own.about", l.a) : t("own.since", l.a))),
      subs.length ? h("div", { class: "own-subs" }, subs.map((x) => h("button", { class: "on-sub", type: "button", "data-node": String(x), title: t("own.subOf", ownNodes[x].n, ownNodes[F.par.get(x).p].n), onclick: () => openCompany(x) }, ownAvatar(ownNodes[x], "sm")))) : null);
  }

  function ownCard(g, F) {
    // a holding that owns a single group (Porsche SE → Volkswagen Group): head the card with the group itself
    let head = g.root;
    const chain = [];
    while ((F.kids.get(head) || []).length === 1 && (F.kids.get(F.kids.get(head)[0]) || []).length >= 2) {
      chain.push(head);
      head = F.kids.get(head)[0];
    }
    const r = ownNodes[head];
    const size = g.size - chain.length;
    const kids = (F.kids.get(head) || []).slice().sort((a, b) => {
      const sa = (F.kids.get(a) || []).length, sb = (F.kids.get(b) || []).length;
      return sb - sa || ownNodes[a].n.localeCompare(ownNodes[b].n);
    });
    const owner = chain.length ? chain[chain.length - 1] : null;
    return h("section", { class: "card own-card", "data-root": String(g.root) },
      h("div", { class: "own-head-row" },
        h("button", { class: "own-head", type: "button", onclick: () => openCompany(head) },
          h("span", { "data-node": String(head), class: "own-head-av" }, ownAvatar(r, "lg")),
          h("span", { class: "own-head-txt" }, h("b", null, r.n), h("span", null, `${size} ${t("info.company", size)}`)),
          icon("chevronRight", "chev")),
        owner != null ? h("button", { class: "own-chain", type: "button", onclick: () => openCompany(owner), title: chain.map((c) => ownNodes[c].n).join(" → ") },
          h("span", { "data-node": String(owner), class: "own-chain-av" }, ownAvatar(ownNodes[owner], "sm")),
          h("span", null, t("own.ownedBy", ownNodes[owner].n, spanText(F.par.get(head))))) : null),
      h("div", { class: "own-kids" }, kids.map((k) => ownKid(k, F))));
  }

  /** Org-chart lines: a trunk from the owner down the left, a bus above each row, a drop to each brand. */
  /** Position of an element inside an ancestor, from layout offsets (ignores transforms and column flow). */
  function boxIn(el, anc) {
    let x = 0, y = 0, e = el;
    while (e && e !== anc) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function drawOwnLines(card) {
    const old = card.querySelector(".own-lines");
    if (old) old.remove();
    const head = card.querySelector(".own-head-av .on-av");
    const avs = [...card.querySelectorAll(".own-kid > .on-node > .on-av")];
    if (!head || !avs.length || !card.offsetWidth) return null;
    const hb = boxIn(head, card);
    const x0 = Math.round(hb.x + hb.w / 2) + 0.5;
    const rows = new Map();
    for (const av of avs) {
      const b = boxIn(av, card);
      pushMap(rows, b.y, { x: Math.round(b.x + b.w / 2) + 0.5, y: b.y, approx: av.closest(".own-kid").classList.contains("approx") });
    }
    let solid = "", dashed = "", lastBus = 0;
    for (const [top, items] of rows) {
      const bus = top - 10;
      lastBus = Math.max(lastBus, bus);
      const xr = Math.max(...items.map((it) => it.x));
      solid += `M${x0},${bus}H${xr}`;
      for (const it of items) (it.approx ? (dashed += `M${it.x},${bus}V${it.y - 2}`) : (solid += `M${it.x},${bus}V${it.y - 2}`));
    }
    solid = `M${x0},${hb.y + hb.h + 2}V${lastBus}` + solid;
    const svg = s("svg", { class: "own-lines", width: card.offsetWidth, height: card.offsetHeight, "aria-hidden": "true" },
      s("path", { d: solid }), dashed ? s("path", { d: dashed, class: "approx" }) : null);
    card.prepend(svg);
    return svg;
  }

  function renderOwnership(animate) {
    const wrap = $("ownCards");
    const F = ownForest(own.year, own.branches);
    const minSize = own.scope === "major" ? 3 : 1;
    const groups = F.groups.filter((g) => g.size >= minSize);
    const total = F.groups.reduce((t, g) => t + g.size, 0);
    $("ownYear").textContent = own.year >= D.lastYear ? `${own.year}` : String(own.year);
    $("ownSlider").value = String(own.year);
    $("ownSlider").style.setProperty("--p", ((own.year - OWN_FIRST) / (D.lastYear - OWN_FIRST) * 100).toFixed(2) + "%");
    const big = F.groups[0];
    $("ownSummary").textContent = F.groups.length
      ? t("own.summary", F.groups.length, total, big ? ownNodes[big.root].n : null)
      : t("own.noneYear");
    $("makerCount").textContent = t("own.count", num(OWN.nodes.length), num(OWN.links.length));

    const before = new Map();
    const doAnim = animate && !reduceMotion.matches && wrap.childElementCount;
    if (doAnim) for (const el of wrap.querySelectorAll("[data-node]")) before.set(el.dataset.node, el.getBoundingClientRect());
    wrap.replaceChildren(...(groups.length ? groups.map((g) => ownCard(g, F))
      : [h("div", { class: "card empty-state" }, h("b", null, t("own.noGroups")), own.scope === "major" ? t("own.noMajor") : t("own.noLinks"))]));
    const lines = [...wrap.querySelectorAll(".own-card")].map(drawOwnLines);
    requestAnimationFrame(() => { for (const c of wrap.querySelectorAll(".own-card")) drawOwnLines(c); });
    if (own.focus != null) {
      const el = wrap.querySelector(`[data-node="${own.focus}"]`);
      if (el) el.classList.add("focus");
    }
    if (!doAnim) return;
    const dur = own.timer ? 380 : 620, easing = "cubic-bezier(.32,.72,0,1)";
    for (const el of wrap.querySelectorAll("[data-node]")) {
      const r0 = before.get(el.dataset.node), r1 = el.getBoundingClientRect();
      if (r0 && r1.width) {
        const dx = r0.left - r1.left, dy = r0.top - r1.top, sc = r0.width / r1.width;
        if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(sc - 1) > 0.02) {
          el.style.transformOrigin = "0 0";
          el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: "none" }], { duration: dur, easing });
        }
      } else if (r1.width) {
        el.animate([{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "none" }], { duration: dur * 0.8, easing });
      }
    }
    for (const svg of lines) if (svg) svg.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: dur, easing: "linear" });
  }

  function setOwnYear(y, animate) {
    own.year = clamp(Math.round(y), OWN_FIRST, D.lastYear);
    $("ownYear").textContent = String(own.year);
    if (own.raf) return;
    own.raf = requestAnimationFrame(() => { own.raf = 0; renderOwnership(animate); });
  }
  function stopOwnPlay() {
    if (!own.timer) return;
    clearInterval(own.timer);
    own.timer = 0;
    $("ownPlay").setAttribute("aria-pressed", "false");
    $("ownPlay").querySelector("span").textContent = t("play");
  }
  $("ownPlay").onclick = () => {
    if (own.timer) { stopOwnPlay(); return; }
    if (own.year >= D.lastYear) own.year = 1900;
    $("ownPlay").setAttribute("aria-pressed", "true");
    $("ownPlay").querySelector("span").textContent = t("pause");
    own.timer = setInterval(() => {
      if (own.year >= D.lastYear) { stopOwnPlay(); return; }
      setOwnYear(own.year + 1, true);
    }, 520);
    setOwnYear(own.year, true);
  };
  $("ownSlider").min = String(OWN_FIRST);
  $("ownSlider").max = String(D.lastYear);
  $("ownSlider").addEventListener("input", () => { stopOwnPlay(); own.focus = null; setOwnYear(+$("ownSlider").value, true); });
  $("ownPrev").onclick = () => { stopOwnPlay(); setOwnYear(own.year - 1, true); };
  $("ownNext").onclick = () => { stopOwnPlay(); setOwnYear(own.year + 1, true); };
  $("ownBranches").onchange = () => { own.branches = $("ownBranches").checked; renderOwnership(true); };
  bindSeg("ownScopeSeg", () => own.scope, (v) => { own.scope = v; renderOwnership(true); });
  $("ownTicks").replaceChildren(...[1900, 1925, 1950, 1975, 2000, D.lastYear].map((y) =>
    h("button", { type: "button", style: { left: ((y - OWN_FIRST) / (D.lastYear - OWN_FIRST) * 100) + "%" }, onclick: () => { stopOwnPlay(); setOwnYear(y, true); } }, y === D.lastYear ? t("today") : String(y))));
  new ResizeObserver(debounce(() => { if (makerMode === "groups" && tab === "makers") for (const c of $("ownCards").querySelectorAll(".own-card")) drawOwnLines(c); }, 120)).observe($("ownCards"));

  /** Jump to the Groups view in a given year, with one company highlighted. */
  function showInGroups(i, year) {
    if (sheetOpen) { closeSheet(() => showInGroups(i, year)); return; }
    own.focus = i;
    own.year = clamp(year, OWN_FIRST, D.lastYear);
    if (tab !== "makers") setTab("makers");
    setMakerMode("groups");
    requestAnimationFrame(() => {
      const el = $("ownCards").querySelector(`[data-node="${i}"]`);
      if (el) el.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
    });
  }
  function bestYearFor(i) {
    const mine = ownByChild.get(i) || [], theirs = ownByParent.get(i) || [];
    const cur = mine.find((l) => !l.b) || theirs.find((l) => !l.b);
    if (cur) return D.lastYear;
    const last = [...mine, ...theirs].sort((a, b) => (b.b || 0) - (a.b || 0))[0];
    return last ? Math.max(last.a, (last.b || D.lastYear) - 1) : D.lastYear;
  }

  /** "Owners over time" and "Companies it owned", for maker and company pages. */
  function ownershipSection(i) {
    if (i == null) return null;
    const owners = (ownByChild.get(i) || []).slice().sort((a, b) => a.a - b.a);
    const owned = (ownByParent.get(i) || []).slice().sort((a, b) => a.a - b.a || ownNodes[a.c].n.localeCompare(ownNodes[b.c].n));
    if (!owners.length && !owned.length) return null;
    const out = [];
    if (owners.length) {
      out.push(h("section", { class: "d-sec" },
        secHead(t("own.ownersOverTime"), t("own.seeInGroups"), () => showInGroups(i, bestYearFor(i))),
        h("p", { class: "d-note" }, t("own.ownersNote")),
        spanChart(owners.map((l) => ({ label: ownNodes[l.p].n, from: l.a, to: l.b, approx: l.fl & 1, text: spanText(l), title: `${ownNodes[l.p].n}: ${spanText(l)}`, onclick: () => openCompany(l.p) })), "in-sheet")));
    }
    if (owned.length) {
      const rows = owned.map((l) => h("button", { class: "lrow", type: "button", onclick: () => openCompany(l.c) },
        ownAvatar(ownNodes[l.c], "tile"),
        h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, ownNodes[l.c].n), h("span", { class: "lrow-sub" }, spanText(l))),
        icon("chevronRight", "chev")));
      const show = 20;
      const list = h("div", { class: "list models-list owned-cos" }, rows.slice(0, show));
      if (rows.length > show) {
        const more = h("button", { class: "lrow tinted", type: "button", onclick: () => { more.remove(); rows.slice(show).forEach((r) => list.append(r)); } },
          h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, t("showAll", rows.length))));
        list.append(more);
      }
      out.push(h("section", { class: "d-sec" },
        secHead(t("own.itOwned"), owners.length ? null : t("own.seeInGroups"), owners.length ? null : () => showInGroups(i, bestYearFor(i))), list));
    }
    return out;
  }

  function buildCompany(i) {
    const n = ownNodes[i];
    const owners = ownByChild.get(i) || [], owned = ownByParent.get(i) || [];
    return h("div", { class: "sheet-page no-hero", "data-title": n.n },
      h("div", { class: "d-head" },
        h("div", { class: "app-head" },
          companyTile(n, "xl"),
          h("div", { class: "app-head-txt" },
            h("h2", { class: "d-title", id: "sheetTitle" }, n.n),
            h("p", { class: "d-sub" }, n.f ? t("companyYears", n.f, n.d || t("todayLc")) : t("company")),
            h("div", { class: "d-actions" },
              n.wiki ? extLink(n.wiki) : null,
              h("button", { class: "pill-btn gray", type: "button", onclick: () => showInGroups(i, bestYearFor(i)) }, icon("chart"), t("groupsBtn")))))),
      h("div", { class: "info-strip" },
        info(t("info.founded"), n.f ? String(n.f) : "—", n.f ? t("info.yearsAgo", D.lastYear - n.f) : null),
        info(n.d ? t("info.closed") : t("info.status"), n.d ? String(n.d) : t("info.active"), n.d ? null : t("todayLc"), { cls: n.d ? "" : "text" }),
        info(t("info.owned"), String(owned.length), t("info.company", owned.length)),
        info(t("info.owners"), String(owners.length), t("info.overTime"))),
      h("div", { class: "d-body" },
        ownershipSection(i),
        n.wiki ? h("section", { class: "d-sec" }, secHead(t("sec.about")), articleBlock(n.wiki, null)) : null,
        n.wiki ? linksList([[t("link.read"), wikiLink(n.wiki)]]) : null,
        h("p", { class: "d-source" }, t("src.company"))));
  }

  /* ------------------------------------------------------------------ recently viewed */
  const RECENT_KEY = "verbiest-recent";
  function loadRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return raw.map((r) => (r.t === "car" && carByTitle.has(r.n) ? { t: "car", id: carByTitle.get(r.n) } : r.t === "maker" && makerByName.has(r.n) ? { t: "maker", id: makerByName.get(r.n) } : null)).filter(Boolean);
    } catch (e) { return []; }
  }
  function remember(type, id) {
    try {
      const n = type === "car" ? cars[id].n : makers[id].n;
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((r) => !(r.t === type && r.n === n));
      raw.unshift({ t: type, n });
      localStorage.setItem(RECENT_KEY, JSON.stringify(raw.slice(0, 12)));
    } catch (e) { /* private mode */ }
  }

  /* ------------------------------------------------------------------ my garage: UI */
  function tileBadges(c) {
    const f = isFav(c), o = isOwned(c);
    if (!f && !o) return null;
    return h("span", { class: "badges" },
      o ? h("span", { class: "badge own", title: t("g.inGarageTitle") }, icon("keyFill")) : null,
      f ? h("span", { class: "badge fav", title: t("g.favourite") }, icon("heartFill")) : null);
  }
  /** Car rows in lists show a small heart / key after the name. */
  function markCarRow(el, c) {
    el.dataset.car = String(c._i);
    el.classList.toggle("is-fav", isFav(c));
    el.classList.toggle("is-owned", isOwned(c));
    const title = el.querySelector(".lrow-title");
    if (title && !title.querySelector(".fav-mark")) title.append(icon("heartFill", "fav-mark"), icon("keyFill", "own-mark"));
    return el;
  }
  function updateMarks() {
    for (const t of document.querySelectorAll(".tile[data-car]")) {
      const th = t.querySelector(".thumb");
      if (!th) continue;
      const old = th.querySelector(".badges");
      if (old) old.remove();
      const b = tileBadges(cars[+t.dataset.car]);
      if (b) th.append(b);
    }
    for (const r of document.querySelectorAll(".lrow[data-car]")) markCarRow(r, cars[+r.dataset.car]);
    for (const r of document.querySelectorAll("[data-maker]")) r.classList.toggle("is-fav", isFavMaker(makers[+r.dataset.maker]));
  }

  function garageChanged() {
    updateMarks();
    const stale = (state.kind === "@fav" && !garage.fav.size) || (state.kind === "@owned" && !garage.owned.size);
    if (stale) state.kind = null;
    renderPills();
    if (stale || (state.kind && state.kind[0] === "@")) refresh();
    if (tab === "garage") renderGarage();
  }

  /* Apple-style HUD toast */
  let toastTimer = 0;
  function toast(text, iconName) {
    const el = $("toast");
    el.replaceChildren(...[iconName ? icon(iconName) : null, h("span", null, text)].filter(Boolean));
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1900);
  }

  function toggleFav(c) {
    if (garage.fav.delete(c.n)) toast(t("g.favRemoved"), "heart");
    else { garage.fav.set(c.n, { t: Date.now() }); toast(t("g.favAdded"), "heartFill"); }
    saveGarage();
  }
  function addOwnership(c) {
    const o = cleanOwnership({ n: c.n }, Date.now());
    garage.owned.set(o.id, o);
    toast(t("g.ownAdded"), "keyFill");
    saveGarage();
    return o;
  }
  function toggleFavMaker(m) {
    if (garage.favMakers.delete(m.n)) toast(t("g.favRemoved"), "heart");
    else { garage.favMakers.set(m.n, { t: Date.now() }); toast(t("g.favAdded"), "heartFill"); }
    saveGarage();
  }

  function bigButton(kind, onclick) { return h("button", { class: "big-btn", type: "button", "data-kind": kind, onclick }); }

  /** Favourite / "I Owned One" buttons on a car page, plus a form for each time the car was owned. */
  function garageControls(c) {
    const favBtn = bigButton("fav", () => { toggleFav(c); sync(); });
    const ownBtn = bigButton("own", () => {
      if (!isOwned(c)) addOwnership(c);
      forms.render(true);
      sync();
      const first = forms.querySelector(".own-entry");
      if (first) first.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
    });
    const forms = ownForms(c, () => sync());
    function sync() {
      const f = isFav(c), n = ownershipsOf(c).length;
      favBtn.setAttribute("aria-pressed", String(f));
      favBtn.replaceChildren(icon(f ? "heartFill" : "heart"), h("span", null, t("g.favourite")));
      ownBtn.setAttribute("aria-pressed", String(n > 0));
      ownBtn.replaceChildren(icon(n ? "keyFill" : "key"), h("span", null, n > 1 ? t("g.inGarageN", n) : n ? t("g.inGarage") : t("g.ownedOne")));
    }
    sync();
    return h("div", { class: "garage-ctl" }, h("div", { class: "garage-btns" }, favBtn, ownBtn), forms);
  }

  function yearField(value, placeholder, onChange) {
    const inp = h("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "4", placeholder, autocomplete: "off", enterkeyhint: "done", "aria-label": placeholder });
    inp.value = value != null ? String(value) : "";
    const commit = () => {
      const v = inp.value.trim() ? toYear(inp.value) : null;
      if (inp.value.trim() && v == null) { inp.classList.add("invalid"); return; }
      inp.classList.remove("invalid");
      onChange(v);
    };
    inp.addEventListener("input", debounce(commit, 400));
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") inp.blur(); });
    return inp;
  }
  function monthField(value, onChange) {
    const sel = h("select", { class: "fsel", "aria-label": t("g.month") },
      h("option", { value: "" }, t("g.monthAny")),
      Array.from({ length: 12 }, (_, i) => h("option", { value: String(i + 1) }, monthName(i + 1))));
    sel.value = value ? String(value) : "";
    sel.addEventListener("change", () => onChange(toMonth(sel.value)));
    return sel;
  }
  function amountField(value, onChange) {
    const inp = h("input", { type: "text", inputmode: "decimal", placeholder: t("g.amountPh"), autocomplete: "off", enterkeyhint: "done", "aria-label": t("g.amountPh") });
    inp.value = value != null ? money0.format(value) : "";
    const commit = () => {
      const v = toAmount(inp.value);
      inp.classList.toggle("invalid", !!inp.value.trim() && v == null);
      if (!inp.value.trim() || v != null) onChange(v);
    };
    inp.addEventListener("input", debounce(commit, 400));
    inp.addEventListener("change", () => { commit(); const v = toAmount(inp.value); if (v != null) inp.value = money0.format(v); });
    inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") inp.blur(); });
    return inp;
  }
  function currencyField(value, onChange) {
    const sel = h("select", { class: "fsel cur", "aria-label": t("g.currency") },
      CURRENCIES.map((k) => h("option", { value: k }, t("cur." + k))));
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  /** The forms for every time this car was owned, and "I Owned Another One". */
  function ownForms(c, onChange) {
    const box = h("div", { class: "own-form" });
    box.render = (animate) => {
      const list = ownershipsOf(c);
      if (!list.length) { box.hidden = true; box.replaceChildren(); return; }
      box.replaceChildren(
        ...list.map((o, k) => ownEntry(c, o, k, list.length, () => { box.render(false); onChange(); })),
        h("button", { class: "pill-btn gray add-own", type: "button", onclick: () => { addOwnership(c); box.render(true); onChange(); } }, icon("plus"), t("g.addAnother")),
        h("p", { class: "footnote form-foot" }, t("g.formFoot")));
      box.hidden = false;
      if (animate && !reduceMotion.matches && box.animate) box.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.32,.72,0,1)" });
    };
    box.render(false);
    return box;
  }

  function ownEntry(c, o, k, count, rerender) {
    const save = debounce(() => saveGarage(), 300);
    const euroNote = (amount, cur) => {
      const e = amount != null ? inEuros(amount, cur) : null;
      return e != null ? t("g.euros", money(Math.round(e), "EUR")) : "";
    };
    // purchase
    const buyEuro = h("span", { class: "frow-note" });
    const buyCur = currencyField(o.buyCur || defaultCur(o.buyY), (v) => { o.buyCur = v; buyEuro.textContent = euroNote(o.buyPrice, v); save(); });
    const buyYear = yearField(o.buyY, t("g.yearPh"), (v) => {
      o.buyY = v;
      if (!o.buyCur) { buyCur.value = defaultCur(v); buyEuro.textContent = euroNote(o.buyPrice, buyCur.value); }
      save();
    });
    const buyPrice = amountField(o.buyPrice, (v) => { o.buyPrice = v; if (!o.buyCur && v != null) o.buyCur = buyCur.value; buyEuro.textContent = euroNote(v, buyCur.value); save(); });
    buyEuro.textContent = euroNote(o.buyPrice, buyCur.value);
    // sale
    const sellEuro = h("span", { class: "frow-note" });
    const sellCur = currencyField(o.sellCur || o.buyCur || defaultCur(o.sellY || o.buyY), (v) => { o.sellCur = v; sellEuro.textContent = euroNote(o.sellPrice, v); save(); });
    const sellPrice = amountField(o.sellPrice, (v) => { o.sellPrice = v; if (!o.sellCur && v != null) o.sellCur = sellCur.value; sellEuro.textContent = euroNote(v, sellCur.value); save(); });
    sellEuro.textContent = euroNote(o.sellPrice, sellCur.value);
    const sellRows = h("div", { class: "sell-rows" },
      h("div", { class: "frow" }, h("span", null, t("g.soldIn")), h("span", { class: "fdate" }, monthField(o.sellM, (v) => { o.sellM = v; save(); }),
        yearField(o.sellY, t("g.yearPh"), (v) => { o.sellY = v; if (!o.sellCur) sellCur.value = o.buyCur || defaultCur(v || o.buyY); save(); }))),
      h("div", { class: "frow price" }, h("span", null, t("g.salePrice")), h("span", { class: "fprice" }, sellPrice, sellCur)),
      h("div", { class: "frow-sub" }, sellEuro));
    sellRows.hidden = !o.sold;
    const soldSwitch = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": t("g.soldQ") });
    soldSwitch.checked = o.sold;
    soldSwitch.addEventListener("change", () => { o.sold = soldSwitch.checked; sellRows.hidden = !o.sold; save(); });
    const note = h("textarea", { rows: "2", maxlength: "2000", placeholder: t("g.notePh"), "aria-label": t("g.note") });
    note.value = o.note || "";
    note.addEventListener("input", () => { o.note = note.value; save(); });

    return h("div", { class: "own-entry" },
      count > 1 ? h("p", { class: "own-entry-head" }, dateText(o.buyY, o.buyM) ? t("g.boughtOn", dateText(o.buyY, o.buyM)) : t("g.ownership", k + 1)) : null,
      h("div", { class: "list form-list" },
        h("div", { class: "frow" }, h("span", null, t("g.boughtIn")), h("span", { class: "fdate" }, monthField(o.buyM, (v) => { o.buyM = v; save(); }), buyYear)),
        h("div", { class: "frow price" }, h("span", null, t("g.pricePaid")), h("span", { class: "fprice" }, buyPrice, buyCur)),
        h("div", { class: "frow-sub" }, buyEuro),
        h("label", { class: "frow" }, h("span", null, t("g.soldQ")), soldSwitch),
        sellRows,
        h("label", { class: "frow note" }, note),
        h("button", { class: "frow danger", type: "button", onclick: () => {
          if (!confirm(t("g.deleteConfirm", carName(c)))) return;
          garage.owned.delete(o.id);
          toast(t("g.ownRemoved"), "key");
          saveGarage();
          rerender();
        } }, t("g.delete"))));
  }

  function makerFavButton(m) {
    const btn = bigButton("fav", () => { toggleFavMaker(m); sync(); });
    function sync() {
      const f = isFavMaker(m);
      btn.setAttribute("aria-pressed", String(f));
      btn.replaceChildren(icon(f ? "heartFill" : "heart"), h("span", null, f ? t("g.favouriteMaker") : t("g.favourite")));
    }
    sync();
    return h("div", { class: "garage-ctl" }, h("div", { class: "garage-btns one" }, btn));
  }

  /* ---- the Garage tab */
  /** Gantt-style rows of year spans: [{label, from, to (null = still), text, approx, title, onclick}].
      Rows may also give exact positions in fractional years: x0 (start) and x1 (end), and open (still running). */
  function spanChart(rows, cls) {
    if (!rows.length) return null;
    const start = (r) => (r.x0 != null ? r.x0 : r.from);
    const end = (r) => (r.x1 != null ? r.x1 : (r.to || CURRENT_YEAR) + 1);
    let a = Infinity, b = -Infinity;
    for (const r of rows) { a = Math.min(a, start(r)); b = Math.max(b, end(r) - 1); }
    a = Math.floor((a - 1) / 5) * 5; b = Math.ceil((b + 1) / 5) * 5;
    const span = Math.max(1, b - a);
    const pos = (y) => ((y - a) / span) * 100;
    const step = span <= 20 ? 5 : span <= 50 ? 10 : span <= 120 ? 20 : 50;
    const ticks = [];
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) ticks.push(y);
    return h("div", { class: "card own-chart" + (cls ? " " + cls : "") },
      h("div", { class: "oc-grid" }, ticks.map((y) => h("span", { class: "oc-tick", style: { left: pos(y) + "%" } }, h("i"), h("b", null, String(y))))),
      rows.map((r) => {
        const x0 = pos(start(r)), x1 = pos(end(r));
        const open = r.open != null ? r.open : !r.to;
        return h("button", { class: "oc-row", type: "button", onclick: r.onclick, title: r.title || null },
          h("span", { class: "oc-name" }, r.label),
          h("span", { class: "oc-track" },
            h("span", { class: "oc-bar" + (open ? " open" : "") + (r.approx ? " approx" : ""), style: { left: x0 + "%", width: Math.max(1.6, x1 - x0) + "%" } }),
            ocLabel(r.text, x0, x1)));
      }));
  }

  /** Short "mars 1972 – juin 1979" / "depuis 2012" text for an ownership. */
  function ownedSpan(o) {
    const a = dateText(o.buyY, o.buyM);
    if (!o.sold) return t("g.since", a);
    const b = dateText(o.sellY, o.sellM);
    return b ? `${a} – ${b}` : `${a} – ?`;
  }

  /** Bars from purchase to sale (month precision when known). */
  function ownershipChart(list) {
    const now = CURRENT_YEAR + new Date().getMonth() / 12;
    return spanChart(list.map(({ c, o }) => {
      const x0 = o.buyY + ((o.buyM || 1) - 1) / 12;
      const endKnown = o.sold && o.sellY;
      const x1 = endKnown ? o.sellY + (o.sellM ? o.sellM / 12 : 1) : o.sold ? x0 + 1 : now;
      return {
        label: splitTitle(carName(c))[0], x0, x1: Math.max(x1, x0 + 0.08), open: !o.sold, approx: o.sold && !o.sellY,
        text: o.sold ? (o.sellY ? (o.sellY === o.buyY ? String(o.buyY) : `${o.buyY}–${o.sellY}`) : `${o.buyY}–?`) : t("g.since", o.buyY),
        title: `${carName(c)} · ${ownedSpan(o)}`, onclick: () => openDetail("car", c._i),
      };
    }));
  }

  /** Purchases and sales, year by year, like a diary; cars still owned are listed under "Today". */
  function ownershipJournal(list) {
    const events = [];
    for (const it of list) {
      events.push({ y: it.o.buyY, m: it.o.buyM || 0, sell: false, ...it });
      if (it.o.sold && it.o.sellY) events.push({ y: it.o.sellY, m: it.o.sellM || 0, sell: true, ...it });
    }
    // same month: the sale comes first (a car traded in for the next one)
    events.sort((x, y) => x.y - y.y || x.m - y.m || (y.sell - x.sell) || x.o.t - y.o.t);
    const years = new Map();
    for (const ev of events) { if (!years.has(ev.y)) years.set(ev.y, []); years.get(ev.y).push(ev); }
    const row = (ev) => {
      const { c, o } = ev;
      const th = h("span", { class: "row-thumb" });
      if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder());
      const when = ev.m ? capFirst(monthName(ev.m)) : null;
      const price = ev.sell ? moneyText(o.sellPrice, o.sellCur || o.buyCur || "EUR") : moneyText(o.buyPrice, o.buyCur || defaultCur(o.buyY));
      const dur = ev.sell ? ownedFor(o) : null;
      return h("button", { class: "j-row" + (ev.sell ? " sell" : ""), type: "button", onclick: () => openDetail("car", c._i) },
        h("span", { class: "j-dot" }, icon(ev.sell ? "tag" : "keyFill")),
        th,
        h("span", { class: "lrow-main" },
          h("span", { class: "j-kind" }, [ev.sell ? t("g.jSold") : t("g.jBought"), when].filter(Boolean).join(" · ")),
          h("span", { class: "lrow-title" }, carName(c)),
          h("span", { class: "lrow-sub" }, [price, dur ? t("g.after", dur) : null, ev.sell ? null : o.note || null].filter(Boolean).join(" · "))),
        icon("chevronRight", "chev"));
    };
    const still = list.filter(({ o }) => !o.sold);
    return h("div", { class: "journal" },
      [...years].map(([y, evs]) => h("section", { class: "j-year" }, h("h3", { class: "j-year-head" }, String(y)), h("div", { class: "j-events" }, evs.map(row)))),
      still.length ? h("section", { class: "j-year now" }, h("h3", { class: "j-year-head" }, t("today")),
        h("div", { class: "j-events" }, still.map(({ c, o }) => {
          const th = h("span", { class: "row-thumb" });
          if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder());
          return h("button", { class: "j-row still", type: "button", onclick: () => openDetail("car", c._i) },
            h("span", { class: "j-dot" }, icon("car")), th,
            h("span", { class: "lrow-main" }, h("span", { class: "j-kind" }, t("g.jStill")), h("span", { class: "lrow-title" }, carName(c)),
              h("span", { class: "lrow-sub" }, [t("g.since", dateText(o.buyY, o.buyM)), ownedFor(o)].filter(Boolean).join(" · "))),
            icon("chevronRight", "chev"));
        }))) : null);
  }

  /** Year label next to an ownership bar: after it, before it, or inside it — wherever it fits. */
  function ocLabel(text, x0, x1) {
    const need = String(text).length * 3.3; // ≈ % of a phone-sized track
    const after = 100 - x1, before = x0;
    const put = (side) => side === "after" ? h("span", { class: "oc-lbl", style: { left: `calc(${x1}% + 6px)` } }, text)
      : side === "before" ? h("span", { class: "oc-lbl", style: { right: `calc(${100 - x0}% + 6px)` } }, text)
      : h("span", { class: "oc-lbl inside", style: { left: `calc(${x0}% + 8px)` } }, text);
    if (after >= need) return put("after");
    if (before >= need) return put("before");
    if (x1 - x0 >= need) return put("inside");
    return put(after >= before ? "after" : "before");
  }

  function undatedRow(c) {
    const th = h("span", { class: "row-thumb" });
    if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder());
    return h("button", { class: "lrow", type: "button", onclick: () => openDetail("car", c._i) },
      th, h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, carName(c)), h("span", { class: "lrow-sub" }, t("g.yearsNotSet"))),
      icon("chevronRight", "chev"));
  }

  function showOnTimeline(kind) {
    state.kind = kind;
    state.maker = null;
    resetToModels();
    renderPills();
    setTab("timeline");
    refresh({ grow: true });
    const ys = cars.filter((c) => carPasses(c)).map((c) => c.y);
    if (ys.length) chart.showYears(Math.min(...ys) - 2, Math.max(...ys) + 2, true);
    setTimeout(() => $("chartCard").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" }), 350);
  }

  function renderGarage() {
    const owned = [...garage.owned.values()].filter((o) => carByTitle.has(o.n)).map((o) => ({ o, c: cars[carByTitle.get(o.n)] }));
    const favCars = [...garage.fav].filter(([n]) => carByTitle.has(n)).sort(([, x], [, y]) => y.t - x.t).map(([n]) => cars[carByTitle.get(n)]);
    const favMakers = [...garage.favMakers].filter(([n]) => makerByName.has(n)).sort(([, x], [, y]) => y.t - x.t).map(([n]) => makers[makerByName.get(n)]);
    const nodes = [];
    const head = (title, count, action, onAction) => h("div", { class: "section-head" },
      h("div", null, h("h2", { class: "title2" }, title), h("p", { class: "footnote" }, count)),
      action ? h("button", { class: "see-all", type: "button", onclick: onAction }, action) : null);

    if (!owned.length && !favCars.length && !favMakers.length) {
      nodes.push(h("div", { class: "card garage-empty" },
        h("span", { class: "ge-icon" }, icon("car")),
        h("h2", null, t("g.empty")),
        (() => { const p0 = h("p"); p0.innerHTML = t("g.emptyText"); return p0; })(),
        h("div", { class: "d-actions" },
          h("button", { class: "pill-btn filled", type: "button", onclick: () => setTab("search", { focus: true }) }, icon("search"), t("g.findCar")),
          h("button", { class: "pill-btn gray", type: "button", onclick: () => setTab("timeline") }, icon("chart"), t("g.browse")))));
    }
    if (owned.length) {
      const dated = owned.filter(({ o }) => o.buyY).sort((x, y) => byPurchase(x.o, y.o));
      const undated = owned.filter(({ o }) => !o.buyY);
      const first = dated.length ? dated[0].o.buyY : null;
      nodes.push(h("section", { class: "g-sec" },
        head(t("g.storyHead"), t("g.storySummary", owned.length, first), t("g.showOnTimeline"), () => showOnTimeline("@owned")),
        dated.length ? ownershipChart(dated) : h("p", { class: "footnote g-hint" }, t("g.hint")),
        dated.length ? ownershipJournal(dated) : null,
        undated.length ? h("div", { class: "g-undated" },
          h("div", { class: "sr-head" }, h("h3", null, t("g.toComplete"))),
          h("div", { class: "list owned-list" }, undated.map(({ c }) => undatedRow(c))),
          h("p", { class: "footnote sr-foot" }, t("g.toCompleteNote"))) : null));
    }
    if (favCars.length) {
      nodes.push(h("section", { class: "g-sec" },
        head(t("g.favCars"), t("nCars", favCars.length), t("g.showOnTimeline"), () => showOnTimeline("@fav")),
        h("div", { class: "grid" }, favCars.map((c, k) => carTile(c, k)))));
    }
    if (favMakers.length) {
      nodes.push(h("section", { class: "g-sec" },
        head(t("g.favMakers"), t("nMakers", favMakers.length)),
        h("div", { class: "list" }, favMakers.map((m) => {
          const meta = [countryLabel(m.c), m.f ? `${m.f}–${m.d || t("todayLc")}` : null, m._count ? t("nModels", m._count) : null].filter(Boolean).join(" · ");
          return h("button", { class: "lrow is-fav", type: "button", "data-maker": String(m._i), onclick: () => openDetail("maker", m._i) },
            makerTile(m), h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, m.n), h("span", { class: "lrow-sub" }, meta)), icon("chevronRight", "chev"));
        }))));
    }
    nodes.push(h("section", { class: "g-sec" },
      h("div", { class: "sr-head" }, h("h3", null, t("g.backup"))),
      h("div", { class: "list backup-list" },
        h("button", { class: "lrow tinted", type: "button", onclick: exportGarage }, h("span", { class: "row-icon" }, icon("share")), h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, t("g.export")))),
        h("button", { class: "lrow tinted", type: "button", onclick: () => importPicker.click() }, h("span", { class: "row-icon" }, icon("tray")), h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, t("g.import"))))),
      h("p", { class: "footnote sr-foot" }, t("g.backupNote"))));
    $("garageBody").replaceChildren(...nodes);
  }

  async function exportGarage() {
    const data = JSON.stringify(serializeGarage(), null, 2);
    const name = `verbiest-garage-${new Date().toISOString().slice(0, 10)}.json`;
    let file = null;
    try { file = new File([data], name, { type: "application/json" }); } catch (e) { /* very old browsers */ }
    if (coarse && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: t("g.backupTitle") }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(file || new Blob([data], { type: "application/json" }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t("g.backupSaved"), "share");
  }
  const importPicker = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  document.body.append(importPicker);
  importPicker.addEventListener("change", async () => {
    const f = importPicker.files && importPicker.files[0];
    importPicker.value = "";
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      if (!raw || !(raw.v === 1 || raw.v === 2) || !(raw.fav || raw.owned || raw.favMakers)) throw new Error("not a backup");
      const n = mergeGarage(raw);
      saveGarage();
      toast(n ? t("g.imported", n) : t("g.upToDate"), "tray");
    } catch (e) { toast(t("g.badFile")); }
  });

  /* ------------------------------------------------------------------ Search tab */
  let renderSearch = () => {};
  (function search() {
    const input = $("searchInput"), out = $("searchResults");
    let items = [], active = -1;
    const SUGGEST = t("s.suggest");

    function score(nameNorm, q, tokens, pop) {
      if (!tokens.every((t) => nameNorm.includes(t))) return -1;
      let sc = pop;
      if (nameNorm === q) sc += 2000;
      else if (nameNorm.startsWith(q)) sc += 600;
      else if (nameNorm.includes(" " + tokens[0])) sc += 150;
      return sc;
    }

    function highlight(name, tokens) {
      if (!tokens) return [name];
      const n = norm(name);
      const marks = new Array(name.length).fill(false);
      for (const t of tokens) { const i = n.indexOf(t); if (i >= 0) for (let k = i; k < i + t.length; k++) marks[k] = true; }
      const res = [];
      let buf = "", on = false;
      for (let i = 0; i < name.length; i++) {
        if (marks[i] !== on) { if (buf) res.push(on ? h("mark", null, buf) : buf); buf = ""; on = marks[i]; }
        buf += name[i];
      }
      if (buf) res.push(on ? h("mark", null, buf) : buf);
      return res;
    }

    function row(lead, name, meta, action, tokens) {
      const idx = items.length;
      const el = h("button", { class: "lrow", type: "button", role: "option", "aria-selected": "false",
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => { input.blur(); action(); } },
        lead,
        h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, highlight(name, tokens)), meta ? h("span", { class: "lrow-sub" }, meta) : null),
        icon("chevronRight", "chev"));
      el.addEventListener("mouseenter", () => { active = idx; mark(false); });
      items.push({ el, action });
      return el;
    }
    const carThumb = (c) => { const th = h("span", { class: "row-thumb" }); if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder()); return th; };
    const iconLead = (name) => h("span", { class: "row-icon" }, icon(name));

    function section(title, listCls, rows, extra) {
      return h("section", { class: "sr-sec" },
        h("div", { class: "sr-head" }, h("h3", null, title), extra || null),
        h("div", { class: "list " + (listCls || "") }, rows));
    }

    function renderEmpty() {
      items = []; active = -1;
      const nodes = [];
      const recent = loadRecent();
      if (recent.length) {
        const clear = h("button", { type: "button", onclick: () => { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} renderEmpty(); } }, t("clear"));
        nodes.push(h("section", { class: "sr-sec" },
          h("div", { class: "sr-head" }, h("h3", null, t("s.recent")), clear),
          h("div", { class: "recent-shelf" }, recent.map((r, k) => (r.t === "car" ? carTile(cars[r.id], k) : recentMaker(makers[r.id]))))));
      }
      nodes.push(section(t("s.suggestions"), "plain", SUGGEST.map((q) => {
        const el = h("button", { class: "lrow tinted", type: "button", onclick: () => { input.value = q; run(); input.focus(); } },
          h("span", { class: "row-icon", style: { background: "none", color: "var(--tint)" } }, icon("search")),
          h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, q)));
        return el;
      })));
      out.replaceChildren(...nodes);
      input.setAttribute("aria-expanded", "false");
    }
    function recentMaker(m) {
      const thumb = h("div", { class: "thumb" });
      if (m.i) thumb.append(wikiImg(m.i, 250, "")); else thumb.append(h("div", { class: "ph" }, h("span", { class: "icon-tile xl letter" }, initials(m.n))));
      return h("button", { class: "tile maker-tile", type: "button", onclick: () => openDetail("maker", m._i) },
        thumb, h("div", { class: "nm" }, m.n), h("div", { class: "mt" }, h("span", null, countryName(m.c))));
    }

    function run() {
      const raw = input.value.trim();
      $("searchClear").hidden = !input.value;
      const q = norm(raw);
      if (!q) { renderEmpty(); return; }
      const tokens = q.split(/\s+/);
      const mk = [];
      for (const m of makers) { const sc = score(m._n, q, tokens, m.p * 4 + m._count); if (sc >= 0) mk.push([sc, m]); }
      mk.sort((a, b) => b[0] - a[0]);
      const cs = [];
      for (const c of cars) {
        const sc = Math.max(score(c._n, q, tokens, c.p * 3), c._nf ? score(c._nf, q, tokens, c.p * 3) : -1);
        if (sc >= 0) cs.push([sc, c]);
      }
      cs.sort((a, b) => b[0] - a[0]);
      items = [];
      const nodes = [];
      const yr = /^\d{4}$/.test(q) ? +q : null;
      if (yr && yr >= START_YEAR && yr <= D.lastYear) {
        const n = cars.filter((c) => c.y === yr).length;
        nodes.push(section(t("s.year"), "icons", [row(iconLead("calendar"), t("s.goTo", yr), n ? t("s.carsThatYear", num(n)) : t("s.showYear"), () => revealYear(yr))]));
      }
      if (mk.length) nodes.push(section(t("s.makers"), "icons", mk.slice(0, 6).map(([, m]) => row(makerTile(m), m.n, [countryLabel(m.c), m.f ? t("s.sinceY", m.f) : null, t("nModels", m._count)].filter(Boolean).join(" · "), () => openDetail("maker", m._i), tokens))));
      if (cs.length) {
        const shown = cs.slice(0, 25);
        const sec = section(t("s.cars"), "", shown.map(([, c]) => markCarRow(row(carThumb(c), carName(c), [yearsLabel(c), c.m >= 0 ? makers[c.m].n : null].filter(Boolean).join(" · "), () => openDetail("car", c._i), tokens), c)));
        if (cs.length > shown.length) sec.append(h("p", { class: "footnote sr-foot" }, t("s.showing", num(cs.length))));
        nodes.push(sec);
      }
      if (!nodes.length) nodes.push(h("div", { class: "empty-state" }, h("b", null, t("noResults")), t("s.noResults")));
      out.replaceChildren(...nodes);
      active = items.length ? 0 : -1;
      mark(false);
      input.setAttribute("aria-expanded", String(items.length > 0));
    }

    function mark(scroll = true) {
      items.forEach((it, k) => it.el.setAttribute("aria-selected", String(k === active && document.activeElement === input)));
      if (scroll && items[active]) items[active].el.scrollIntoView({ block: "nearest" });
    }

    renderSearch = () => { if (input.value.trim()) run(); else renderEmpty(); };
    input.addEventListener("input", debounce(run, 90));
    input.addEventListener("focus", () => mark(false));
    input.addEventListener("blur", () => setTimeout(() => mark(false), 0));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); mark(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { active = Math.max(0, active - 1); mark(); ev.preventDefault(); }
      else if (ev.key === "Enter" && items[active]) { ev.preventDefault(); input.blur(); items[active].action(); }
      else if (ev.key === "Escape") { if (input.value) { input.value = ""; run(); } else input.blur(); }
    });
    $("searchClear").onclick = () => { input.value = ""; run(); input.focus(); };
    document.addEventListener("keydown", (ev) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (((ev.key === "/" && !typing) || (ev.key === "k" && (ev.metaKey || ev.ctrlKey))) && !sheetOpen) {
        ev.preventDefault();
        setTab("search", { focus: true });
        input.focus();
        input.select();
      }
    });
  })();

  /* ------------------------------------------------------------------ appearance */
  function currentTheme() { return document.documentElement.getAttribute("data-theme"); }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    readColors();
    chart.setColors(COLORS[agg.dim]);
    renderLegend();
    renderResults();
    overview.draw();
    const bg = t === "dark" ? "#000000" : "#f2f2f7";
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", bg);
  }
  $("themeBtn").onclick = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem("verbiest-theme", next); } catch (e) {}
    applyTheme(next);
  };
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");
  const onSystemTheme = (e) => {
    let saved = null;
    try { saved = localStorage.getItem("verbiest-theme"); } catch (err) {}
    if (!saved) applyTheme(e.matches ? "dark" : "light");
  };
  if (darkMQ.addEventListener) darkMQ.addEventListener("change", onSystemTheme);

  /* ------------------------------------------------------------------ intro */
  function renderIntro() {
    const nCountries = new Set(cars.map((c) => c.c).filter((c) => c >= 0)).size;
    $("introText").textContent = t("intro", num(cars.length), num(makers.length)) + (coarse ? t("intro.touch") : t("intro.mouse"));
    const stat = (v, l) => h("div", { class: "stat" }, h("b", null, v), h("span", null, l));
    $("stats").replaceChildren(
      stat(num(cars.length), t("stat.cars")),
      stat(num(makers.length), t("stat.makers")),
      stat(num(nCountries), t("stat.countries")),
      stat(`${D.lastYear - 1672}`, t("stat.years")));
    $("generated").textContent = t("footer.snapshot", I18N.dateFmt(D.generated));
  }

  /* ------------------------------------------------------------------ routing */
  function parseRoute() {
    const t = /^#\/(milestones|makers|garage|search)$/.exec(location.hash);
    if (t) return { type: "tab", id: t[1] };
    const m = /^#\/(car|maker|milestone|year|company|article)\/(.+)$/.exec(location.hash);
    if (!m) return null;
    const val = decodeURIComponent(m[2]);
    if (m[1] === "car") return carByTitle.has(val) ? { type: "car", id: carByTitle.get(val) } : null;
    if (m[1] === "maker") return makerByName.has(val) ? { type: "maker", id: makerByName.get(val) } : null;
    if (m[1] === "milestone") return D.milestones[+val] ? { type: "milestone", id: +val } : null;
    if (m[1] === "year") return { type: "year", id: +val };
    if (m[1] === "company") return OWN.nodes[+val] ? { type: "company", id: +val } : null;
    if (m[1] === "article") return { type: "article", id: val };
    return null;
  }
  addEventListener("popstate", () => {
    if (afterClose) { const f = afterClose; afterClose = null; hideSheet(); f(); return; }
    const r = parseRoute();
    if (r && r.type === "tab") { hideSheet(); setTab(r.id, { fromRoute: true }); return; }
    if (r && r.type !== "year") {
      const d = (history.state && history.state.depth) || 1;
      showDetail(r.type, r.id, d < curDepth ? "pop" : d > curDepth ? "push" : "replace");
      return;
    }
    hideSheet();
  });

  /* ------------------------------------------------------------------ language menu */
  (function languageMenu() {
    const btn = $("langBtn"), menu = $("langMenu");
    $("langCode").textContent = LANG.toUpperCase();
    menu.replaceChildren(...I18N.langs.map(([code, label]) => h("button", {
      class: "menu-item", type: "button", role: "menuitemradio", "aria-checked": String(code === LANG), lang: code,
      onclick: () => { close(); if (code !== LANG) I18N.setLang(code); },
    }, h("span", null, label), code === LANG ? icon("checkmark") : null)));
    function open() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => menu.classList.add("show"));
      const cur = menu.querySelector('[aria-checked="true"]');
      if (cur) cur.focus({ preventScroll: true });
    }
    function close() {
      menu.classList.remove("show");
      btn.setAttribute("aria-expanded", "false");
      setTimeout(() => { if (!menu.classList.contains("show")) menu.hidden = true; }, 220);
    }
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); if (menu.hidden) open(); else close(); });
    document.addEventListener("pointerdown", (ev) => { if (!menu.hidden && !ev.target.closest(".lang-wrap")) close(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });
  })();

  window.VERBIEST_APP = { chart, overview, state, setTab }; // handy for debugging in the console

  /* ------------------------------------------------------------------ boot */
  renderIntro();
  renderPills();
  refresh({ grow: true });
  chart.setView(0, 1, false);
  renderEraChips();
  for (const id of ["metricSeg", "colorSeg", "makerSortSeg"]) syncSeg($(id), true);
  syncTabbar(true);
  watchTitle();
  updateNavbar();

  const r0 = parseRoute();
  if (r0 && r0.type === "tab") {
    setTab(r0.id, { fromRoute: true });
  } else if (r0 && r0.type === "year") {
    if (r0.id >= START_YEAR && r0.id <= D.lastYear) setTimeout(() => revealYear(r0.id), 300);
  } else if (r0) {
    const url = location.hash;
    histReplace(null, "#/");
    histPush({ depth: 1 }, url);
    showDetail(r0.type, r0.id);
  }
})();
