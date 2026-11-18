/* Verbiest — app logic: tabs, state, filters, results, detail sheet, search, routing. */
(function () {
  "use strict";
  const { h, s, num, norm, clamp, debounce, wikiImg, thumbUrl, commonsPage, wikiUrl, splitTitle, placeholder, icon } = V;
  const { Warp, TimelineChart, Overview, miniHistogram } = VChart;

  const D = window.VERBIEST_DATA;
  if (!D) {
    document.getElementById("introText").textContent =
      "The data file (data/verbiest-data.js) is missing. Run scripts/fetch_raw.py and scripts/build_data.py first.";
    return;
  }

  /* ------------------------------------------------------------------ setup */
  const $ = (id) => document.getElementById(id);
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
    const code = FLAG_CODES[countries[ci].n];
    return code ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
  }
  const countryName = (ci) => (ci >= 0 ? countries[ci].n : "Unknown country");
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
    if (state.kind && !(c.k & KIND[state.kind])) return false;
    if (ignoreDim !== "country" && state.off.country.size && state.off.country.has(carGroup(c, "country"))) return false;
    if (ignoreDim !== "body" && state.off.body.size && state.off.body.has(c.b)) return false;
    return true;
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
  const eraYears = (e) => `${e.from < 1700 ? 1672 : e.from}–${e.to >= D.lastYear ? "Today" : e.to}`;

  function setReadout(year) {
    const makersMode = state.metric === "makers";
    let cap = makersMode ? "Makers founded" : "New models";
    if (!makersMode && state.maker != null) cap = `New ${makers[state.maker].n} models`;
    else if (!makersMode && state.kind) cap = `New models · ${D.kinds.find((k) => k.k === state.kind).n}`;
    let val = 0, sub = "";
    if (year != null) {
      val = agg.totals[year - START_YEAR] || 0;
      const e = eraOf(year);
      sub = e ? `${year} · ${e.name}` : String(year);
    } else {
      const [y0, y1] = visibleYears();
      let a = null, b = null;
      for (let y = y0; y <= y1; y++) { const v = agg.totals[y - START_YEAR]; if (v) { val += v; if (a == null) a = y; b = y; } }
      sub = a == null ? "Nothing in this period" : a === b ? String(a) : `${a}–${b}`;
      if (state.era && a != null) sub += ` · ${state.era.name}`;
    }
    const unit = makersMode ? (val === 1 ? "maker" : "makers") : (val === 1 ? "model" : "models");
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
    const all = [{ k: null, n: "All Cars" }, ...D.kinds];
    $("typePills").replaceChildren(...all.map((k) => h("button", {
      class: "chip", type: "button", role: "radio", "aria-checked": String(state.kind === k.k),
      title: k.hint || null,
      onclick: () => {
        state.kind = k.k; renderPills(); refresh();
        const on = $("typePills").querySelector('[aria-checked="true"]');
        if (on) on.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      },
    }, k.n)));
  }

  // era scope bar
  function renderEraChips() {
    const allBtn = h("button", { class: "era-chip", type: "button", "data-era": "all", onclick: () => { selectYear(null); hideTip(); goAll(); } },
      h("b", null, "All Years"), h("span", null, `1672–Today`));
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
    $("playBtn").querySelector("span").textContent = "Play";
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
    $("playBtn").querySelector("span").textContent = "Pause";
    step();
    player.timer = setInterval(step, 1400);
  }
  $("playBtn").onclick = () => (player.timer ? stopPlay() : startPlay());
  $("chart").addEventListener("pointerdown", stopPlay);
  $("overview").addEventListener("pointerdown", stopPlay);

  $("zoomIn").onclick = () => chart.zoomAt(0.6, null, true);
  $("zoomOut").onclick = () => chart.zoomAt(1 / 0.6, null, true);
  $("sortSel").onchange = (ev) => { state.sort = ev.target.value; state.shown = PAGE; renderResults(); };
  $("hint").textContent = coarse
    ? "Swipe the chart to travel through time and pinch to zoom. Tap a bar for its cars, or touch and hold, then slide, to scrub through the years."
    : "Drag the chart or the frame below it to travel through time · ⌘/Ctrl + scroll or double-click to zoom · click a bar to pick a year · ← → step through years.";

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
        title: off.has(k) ? `Show ${g.n}` : `Hide ${g.n} (Shift-click to show only ${g.n})`,
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
    const what = state.metric === "makers" ? (total === 1 ? "maker founded" : "makers founded") : (total === 1 ? "new model" : "new models");
    const rows = [];
    for (let g = 0; g < G; g++) {
      const v = agg.matrix[i * G + g];
      if (v > 0) rows.push(h("div", { class: "tt-row", style: { "--c": COLORS[dim][g] } }, h("i"), h("b", null, num(v)), h("span", null, D.dims[dim].groups[g].n)));
    }
    const list = agg.byYear.get(year) || [];
    const top = list.slice(0, 3).map((k) => (state.metric === "makers" ? makers[k].n : cars[k].n));
    const era = eraOf(year);
    const ms = D.milestones.filter((m) => m.year === year);
    fillTip(
      h("div", { class: "tt-head" }, h("span", { class: "tt-year" }, String(year)), h("span", { class: "tt-total" }, num(total), " ", h("small", null, what))),
      era ? h("div", { class: "tt-era" }, era.name) : null,
      ...rows,
      top.length ? h("div", { class: "tt-notable" }, "Notable: ", ...top.flatMap((t, k) => [k ? ", " : "", h("b", null, t)]), list.length > 3 ? ` and ${num(list.length - 3)} more` : "") : null,
      ms.length ? h("div", { class: "tt-notable" }, "★ ", ms.map((m) => m.label).join(" · ")) : null,
      h("div", { class: "tt-tip" }, state.sel === year ? (coarse ? "Selected · the list is below" : "Selected · click again to clear") : (coarse ? "Tap to see them all" : "Click to see them all"))
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
          h("div", { class: "tt-tip" }, coarse ? "Tap to read more" : "Click to read more")))
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
    const noun = makersMode ? "Makers Founded" : state.maker != null ? `${makers[state.maker].n} Models` : "Cars Introduced";
    let ya = y1, yb = y0;
    for (const id of ids) { const y = makersMode ? makers[id].f : cars[id].y; if (y < ya) ya = y; if (y > yb) yb = y; }
    $("resultsTitle").textContent = y0 === y1 ? `${noun} in ${y0}` : ids.length ? `${noun}, ${ya}–${yb}` : `${noun}, ${Math.max(y0, D.firstYear)}–${y1}`;
    const sortTxt = { fame: "most famous first", year: "oldest first", name: "by name" }[state.sort];
    $("resultsSub").textContent = ids.length
      ? `${num(ids.length)} ${makersMode ? (ids.length === 1 ? "maker" : "makers") : (ids.length === 1 ? "model" : "models")}, ${sortTxt}` +
        (state.sel == null ? " · follows the chart" : "")
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
        era.link ? h("a", { href: era.link, target: "_blank", rel: "noopener" }, "Learn More on Wikipedia", icon("chevronRight", "chev")) : null,
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
      grid.replaceChildren(h("div", { class: "empty-state" }, h("b", null, "No Results"),
        state.sel != null
          ? `No ${makersMode ? "makers founded" : "cars introduced"} in ${state.sel} match the current filters.`
          : "Nothing matches the current filters in this period."));
      $("moreBtn").hidden = true;
      return;
    }
    const slice = ids.slice(0, state.shown);
    grid.replaceChildren(...slice.map((id, k) => (makersMode ? makerRow(makers[id], k) : carTile(cars[id], k))));
    const more = $("moreBtn");
    more.hidden = ids.length <= state.shown;
    more.textContent = `Show More (${num(ids.length - state.shown)})`;
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
    more.textContent = `Show More (${num(ids.length - state.shown)})`;
  }
  $("moreBtn").onclick = loadMore;

  function renderActiveFilters() {
    const chips = [];
    const token = (label, clear) => h("span", { class: "token" }, label,
      h("button", { type: "button", "aria-label": `Remove filter: ${label}`, onclick: clear }, icon("xmarkCircle")));
    if (state.maker != null) chips.push(token(makers[state.maker].n, () => { state.maker = null; refresh(); }));
    if (state.kind && state.metric === "models") chips.push(token(D.kinds.find((k) => k.k === state.kind).n, () => { state.kind = null; renderPills(); refresh(); }));
    for (const dim of ["country", "body"]) {
      if (!state.off[dim].size) continue;
      if (dim === "body" && state.metric === "makers") continue;
      const hidden = [...state.off[dim]].map((k) => D.dims[dim].groups[k].n);
      chips.push(token(`Hiding ${hidden.length > 2 ? hidden.length + " " + (dim === "country" ? "countries" : "body styles") : hidden.join(", ")}`, () => { state.off[dim].clear(); refresh(); }));
    }
    if (state.sel != null) chips.push(token(`Year ${state.sel}`, () => { selectYear(null); hideTip(); }));
    $("activeFilters").replaceChildren(...chips);
  }

  function yearsLabel(c) {
    if (c.e && c.e !== c.y) return `${c.y}–${c.e}`;
    return String(c.y);
  }

  function carTile(c, k, extraClass) {
    const [name, paren] = splitTitle(c.n);
    const maker = c.m >= 0 ? makers[c.m].n : null;
    const dim = state.metric === "models" ? state.colorBy : "country";
    const col = COLORS[dim][carGroup(c, dim)];
    const thumb = h("div", { class: "thumb" });
    if (c.i) thumb.append(wikiImg(c.i, 250, "")); else thumb.append(placeholder());
    thumb.append(h("span", { class: "yr" }, yearsLabel(c)));
    return h("button", {
      class: "tile" + (extraClass ? " " + extraClass : ""), type: "button", style: { "--i": Math.min(k, 24) },
      onclick: () => openDetail("car", c._i),
      "aria-label": `${c.n}, ${yearsLabel(c)}`,
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
      const txt = d != null ? `${f}–${d}` : `${f}–today`;
      const left = pos(f);
      life.append(h("span", { class: "lbl", style: left > 70 ? { right: (100 - left + 1) + "%" } : { left: `calc(${left}% + 2px)` } }, txt));
    }
    return life;
  }

  function makerRow(m, k) {
    return h("button", { class: "mrow", type: "button", style: { "--i": Math.min(k, 30) }, onclick: () => openDetail("maker", m._i) },
      makerTile(m),
      h("div", { class: "mname" }, h("b", null, m.n),
        h("span", null, h("i", { class: "dot", style: { "--c": COLORS.country[makerGroup(m)] } }), countryName(m.c), m._count ? ` · ${m._count} model${m._count > 1 ? "s" : ""}` : "")),
      lifeBar(m),
      icon("chevronRight", "chev"));
  }

  /* ------------------------------------------------------------------ table view */
  function renderTable() {
    const [y0, y1] = visibleYears();
    const dim = agg.dim, G = agg.G;
    const groups = D.dims[dim].groups;
    const head = h("tr", null, h("th", null, "Year"), h("th", null, "Total"), ...groups.map((g) => h("th", null, g.n)));
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
    $("tableView").querySelector("summary").textContent = open ? "Hide Data Table" : "Show Data Table";
    if (open) renderTable();
  });

  /* ------------------------------------------------------------------ Wikipedia text */
  const introCache = new Map();
  function fetchIntro(title) {
    if (introCache.has(title)) return introCache.get(title);
    const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
      action: "query", prop: "extracts", exintro: "1", explaintext: "1", redirects: "1",
      titles: title, format: "json", formatversion: "2", origin: "*",
    });
    const p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((j) => ((j.query && j.query.pages && j.query.pages[0]) || {}).extract || "");
    introCache.set(title, p);
    p.catch(() => introCache.delete(title));
    return p;
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
      } }, "more");
      box.append(more);
    });
  }

  function textBlock(paras, note) {
    const box = h("div", { class: "d-text" }, paras.map((t) => h("p", null, t)), note ? h("p", { class: "footnote" }, note) : null);
    clampText(box, 6);
    return box;
  }

  function introBlock(title, fallback) {
    const box = h("div", { class: "d-text loading" }, h("p", null, "Loading the Wikipedia introduction for this article…"), h("p", null, "…"), h("p", null, "…"));
    const fill = (text, note) => {
      box.classList.remove("loading");
      const paras = (text || "").split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1);
      if (!paras.length) paras.push(fallback || "No introduction available.");
      box.replaceChildren(...paras.map((t) => h("p", null, t)), note ? h("p", { class: "footnote" }, note) : null);
      clampText(box, 6);
    };
    fetchIntro(title).then((t) => fill(t), () => fill(fallback, "Could not reach Wikipedia, so only the short description is shown."));
    return box;
  }

  /* ------------------------------------------------------------------ detail pages */
  function heroImage(code, alt) {
    const hero = h("div", { class: "d-hero" });
    if (!code) { hero.append(placeholder()); return hero; }
    hero.append(h("div", { class: "bg", style: { backgroundImage: `url("${thumbUrl(code, 120)}")` } }));
    const img = wikiImg(code, 500, alt);
    img.loading = "eager";
    hero.append(img);
    hero.append(h("a", { class: "credit", href: commonsPage(code), target: "_blank", rel: "noopener" }, "Wikimedia"));
    return hero;
  }

  function extLink(title, label) {
    return h("a", { class: "pill-btn filled", href: wikiUrl(title), target: "_blank", rel: "noopener" }, label || "Wikipedia", icon("arrowUpRight"));
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
          dot.append(s("title", null, `${o.n} (${yearsLabel(o)})`));
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

  function buildCar(i) {
    const c = cars[i];
    const m = c.m >= 0 ? makers[c.m] : null;
    const [name, paren] = splitTitle(c.n);
    const bodyGroup = D.dims.body.groups[c.b];
    const flag = flagOf(c.c);
    const infos = [
      info("Introduced", String(c.y), c.e && c.e !== c.y ? `until ${c.e}` : "model year"),
      m ? info("Maker", makerTile(m, "sm"), m.n, { onclick: () => openDetail("maker", c.m), label: `Maker: ${m.n}` }) : null,
      info("Country", flag || (c.c >= 0 ? countryName(c.c) : "—"), flag ? countryName(c.c) : null, { cls: flag ? "flag" : "text" }),
      bodyGroup && !bodyGroup.other ? info("Body", bodyGroup.n.split(/,| [&/] /)[0], bodyGroup.n.includes("&") || bodyGroup.n.includes("/") ? bodyGroup.n : "style", { cls: "text" }) : null,
      c.e && c.e > c.y ? info("Production", String(c.e - c.y + 1), "years") : null,
      c.p ? info("Wikipedia", String(c.p), c.p === 1 ? "language" : "languages") : null,
    ];
    const tags = (c.t || []).map((t) => h("span", { class: "d-tag" }, D.tags[t]));
    const sameYear = cars.filter((o) => o.y === c.y && o._i !== i).sort((a, b) => b.p - a.p).slice(0, 16).map((o) => o._i);

    return h("div", { class: "sheet-page", "data-title": name },
      heroImage(c.i, c.n),
      h("div", { class: "d-head" },
        h("h2", { class: "d-title", id: "sheetTitle" }, name, paren ? h("small", null, ` (${paren})`) : null),
        h("p", { class: "d-sub" }, c.s ? c.s.charAt(0).toUpperCase() + c.s.slice(1) : [m && m.n, yearsLabel(c)].filter(Boolean).join(" · ")),
        h("div", { class: "d-actions" },
          extLink(c.n),
          h("button", { class: "pill-btn gray", type: "button", onclick: () => revealYear(c.y) }, icon("chart"), `See ${c.y}`))),
      h("div", { class: "info-strip" }, infos),
      h("div", { class: "d-body" },
        tags.length ? h("div", { class: "d-tags" }, tags) : null,
        introBlock(c.n, c.s),
        h("section", { class: "d-sec" },
          secHead(m ? `In ${m.n}’s History` : "Place in History"),
          h("p", { class: "d-note" }, m ? `Production years, with ${m.n}’s other models as dots.` : "Production years on the full timeline."),
          ribbon(c)),
        m && makerCars[c.m].length > 1 ? h("section", { class: "d-sec" },
          secHead(`More from ${m.n}`, "See All", () => openDetail("maker", c.m)),
          shelf(makerCars[c.m].slice(0, 150), i)) : null,
        sameYear.length ? h("section", { class: "d-sec" },
          secHead(`Also New in ${c.y}`, "See All", () => revealYear(c.y)),
          shelf(sameYear)) : null,
        linksList([["Read on Wikipedia", wikiUrl(c.n)], c.i ? ["Photo on Wikimedia Commons", commonsPage(c.i)] : null]),
        h("p", { class: "d-source" }, "Text from Wikipedia, “", h("a", { href: wikiUrl(c.n), target: "_blank", rel: "noopener" }, c.n), "” (CC BY-SA 4.0). Facts from Wikipedia categories and Wikidata."))
    );
  }

  function modelRow(id) {
    const c = cars[id];
    const [name, paren] = splitTitle(c.n);
    const th = h("span", { class: "row-thumb" });
    if (c.i) th.append(wikiImg(c.i, 120, "")); else th.append(placeholder());
    return h("button", { class: "lrow", type: "button", onclick: () => openDetail("car", id) },
      th,
      h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, name + (paren ? ` (${paren})` : "")), h("span", { class: "lrow-sub" }, yearsLabel(c) + (c.s ? ` · ${c.s}` : ""))),
      icon("chevronRight", "chev"));
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
        h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, `Show All ${num(ids.length)} Models`)));
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
            h("p", { class: "d-sub" }, m.s ? m.s.charAt(0).toUpperCase() + m.s.slice(1) : countryName(m.c)),
            h("div", { class: "d-actions" },
              m.a ? extLink(m.a) : null,
              ids.length ? h("button", { class: "pill-btn gray", type: "button", onclick: () => focusMaker(mi) }, icon("chart"), "Timeline") : null)))),
      h("div", { class: "info-strip" },
        info("Founded", m.f ? String(m.f) : "—", m.f ? `${D.lastYear - m.f} years ago` : null),
        info(m.d ? "Closed" : "Status", m.d ? String(m.d) : m.f ? "Active" : "—", m.d && m.f ? `after ${m.d - m.f} years` : m.f ? "today" : null, { cls: m.d ? "" : "text" }),
        info("Country", flag || countryName(m.c), flag ? countryName(m.c) : null, { cls: flag ? "flag" : "text" }),
        info("Models", num(ids.length), "on Wikipedia"),
        m.p ? info("Wikipedia", String(m.p), m.p === 1 ? "language" : "languages") : null),
      h("div", { class: "d-body" },
        ids.length ? h("section", { class: "d-sec" },
          secHead("New Models per Year"),
          h("p", { class: "d-note" }, coarse ? "Tap a bar to see that year on the timeline." : "Click a bar to see that year on the timeline."),
          chartBox) : null,
        m.a ? h("section", { class: "d-sec" }, secHead("About"), introBlock(m.a, m.s)) : null,
        ids.length ? h("section", { class: "d-sec" }, secHead("Models"), list) : null,
        m.a ? linksList([["Read on Wikipedia", wikiUrl(m.a)], m.i ? ["Image on Wikimedia Commons", commonsPage(m.i)] : null]) : null,
        m.a ? h("p", { class: "d-source" }, "Text from Wikipedia, “", h("a", { href: wikiUrl(m.a), target: "_blank", rel: "noopener" }, m.a), "” (CC BY-SA 4.0).") : null)
    );
    if (ids.length) requestAnimationFrame(() => miniHistogram(chartBox, counts, Math.min(y0, y1), Math.max(y0, y1), col, (y) => focusMaker(mi, y)));
    return page;
  }

  function buildMilestone(k) {
    const ms = D.milestones[k];
    const prev = D.milestones[k - 1], next = D.milestones[k + 1];
    const era = eraOf(ms.year);
    const paras = ms.x ? ms.x.split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 6) : null;
    return h("div", { class: "sheet-page", "data-title": ms.label },
      heroImage(ms.i, ms.label),
      h("div", { class: "d-head" },
        h("p", { class: "d-eyebrow" }, `Milestone · ${ms.year}`),
        h("h2", { class: "d-title", id: "sheetTitle" }, ms.label),
        h("p", { class: "d-sub" }, ms.s ? `${ms.title} — ${ms.s}` : ms.title),
        h("div", { class: "d-actions" },
          extLink(ms.title),
          h("button", { class: "pill-btn gray", type: "button", onclick: () => revealYear(ms.year) }, icon("chart"), `See ${ms.year}`))),
      h("div", { class: "info-strip" },
        info("Year", String(ms.year), `${D.lastYear - ms.year} years ago`),
        era ? info("Era", era.short || era.name, eraYears(era), { cls: "text" }) : null,
        info("Milestone", `${k + 1}`, `of ${D.milestones.length}`)),
      h("div", { class: "d-body" },
        paras ? textBlock(paras) : introBlock(ms.title, ms.s),
        h("div", { class: "pn" },
          prev ? h("button", { class: "pn-card", type: "button", onclick: () => openDetail("milestone", k - 1, { replace: true, dir: "pop" }) },
            h("small", null, "Previous"), h("b", null, prev.label), h("span", null, String(prev.year))) : h("span"),
          next ? h("button", { class: "pn-card next", type: "button", onclick: () => openDetail("milestone", k + 1, { replace: true, dir: "push" }) },
            h("small", null, "Next"), h("b", null, next.label), h("span", null, String(next.year))) : null),
        linksList([["Read on Wikipedia", wikiUrl(ms.title)], ms.i ? ["Image on Wikimedia Commons", commonsPage(ms.i)] : null]),
        h("p", { class: "d-source" }, "Text from Wikipedia, “", h("a", { href: wikiUrl(ms.title), target: "_blank", rel: "noopener" }, ms.title), "” (CC BY-SA 4.0)."))
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
    const page = type === "car" ? buildCar(id) : type === "maker" ? buildMaker(id) : buildMilestone(id);
    const depth = (history.state && history.state.depth) || 1;
    $("sheetBack").hidden = depth <= 1;
    if (!sheetOpen) {
      stack.replaceChildren();
      present(page, "none");
      openSheetChrome();
    } else present(page, dir || "push");
    curDepth = depth;
    if (type !== "milestone") remember(type, id);
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
  const TABS = ["timeline", "milestones", "makers", "search"];
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
    $("msEyebrow").textContent = `${D.milestones.length} moments · ${D.milestones[0].year}–${D.milestones[D.milestones.length - 1].year}`;
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
      m.f ? `${m.f}–${m.d || "today"}` : null,
      m._count ? `${m._count} model${m._count > 1 ? "s" : ""}` : null,
    ].filter(Boolean).join(" · ");
    return h("button", { class: "lrow", type: "button", onclick: () => openDetail("maker", m._i) },
      makerTile(m),
      h("span", { class: "lrow-main" }, h("span", { class: "lrow-title" }, m.n), h("span", { class: "lrow-sub" }, meta)),
      icon("chevronRight", "chev"));
  }

  function renderMakers() {
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
    const label = (k) => makerMode === "country" ? countryLabel(+k) : makerMode === "founded" ? (k === "?" ? "Founding year unknown" : `Founded in the ${k}s`) : k;

    $("makerCount").textContent = tokens.length ? `${num(list.length)} of ${num(makers.length)} makers` : `${num(makers.length)} makers · ${num(new Set(makers.map((m) => m.c).filter((c) => c >= 0)).size)} countries`;
    $("makerList").replaceChildren(...(keys.length
      ? keys.map((k) => h("section", { class: "lsec", id: slug(k) },
          h("h3", { class: "lsec-head" }, label(k), h("span", null, num(groups.get(k).length))),
          h("div", { class: "list" }, groups.get(k).map(makerListRow))))
      : [h("div", { class: "empty-state" }, h("b", null, "No Results"), `No makers match “${makerQuery.trim()}”.`)]));
    $("makerIndex").replaceChildren(...(makerMode === "az" ? keys : []).map((k) => h("span", { "data-k": k }, k)));
    $("makerList").classList.toggle("with-index", makerMode === "az" && !tokens.length);
    syncTabbar();
  }
  bindSeg("makerSortSeg", () => makerMode, (v) => { makerMode = v; renderMakers(); scrollTo(0, 0); });
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

  /* ------------------------------------------------------------------ Search tab */
  let renderSearch = () => {};
  (function search() {
    const input = $("searchInput"), out = $("searchResults");
    let items = [], active = -1;
    const SUGGEST = ["Ford Model T", "Citroën DS", "Volkswagen Beetle", "Ferrari", "1955", "Electric", "Rolls-Royce", "Mini"];

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
        const clear = h("button", { type: "button", onclick: () => { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} renderEmpty(); } }, "Clear");
        nodes.push(h("section", { class: "sr-sec" },
          h("div", { class: "sr-head" }, h("h3", null, "Recently Viewed"), clear),
          h("div", { class: "recent-shelf" }, recent.map((r, k) => (r.t === "car" ? carTile(cars[r.id], k) : recentMaker(makers[r.id]))))));
      }
      nodes.push(section("Suggestions", "plain", SUGGEST.map((q) => {
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
      for (const c of cars) { const sc = score(c._n, q, tokens, c.p * 3); if (sc >= 0) cs.push([sc, c]); }
      cs.sort((a, b) => b[0] - a[0]);
      items = [];
      const nodes = [];
      const yr = /^\d{4}$/.test(q) ? +q : null;
      if (yr && yr >= START_YEAR && yr <= D.lastYear) {
        const n = cars.filter((c) => c.y === yr).length;
        nodes.push(section("Year", "icons", [row(iconLead("calendar"), `Go to ${yr}`, n ? `${num(n)} car${n > 1 ? "s" : ""} introduced that year` : "Show this year on the timeline", () => revealYear(yr))]));
      }
      if (mk.length) nodes.push(section("Makers", "icons", mk.slice(0, 6).map(([, m]) => row(makerTile(m), m.n, [countryLabel(m.c), m.f ? `since ${m.f}` : null, `${m._count} models`].filter(Boolean).join(" · "), () => openDetail("maker", m._i), tokens))));
      if (cs.length) {
        const shown = cs.slice(0, 25);
        const sec = section("Cars", "", shown.map(([, c]) => row(carThumb(c), c.n, [yearsLabel(c), c.m >= 0 ? makers[c.m].n : null].filter(Boolean).join(" · "), () => openDetail("car", c._i), tokens)));
        if (cs.length > shown.length) sec.append(h("p", { class: "footnote sr-foot" }, `Showing the 25 most famous of ${num(cs.length)} matches.`));
        nodes.push(sec);
      }
      if (!nodes.length) nodes.push(h("div", { class: "empty-state" }, h("b", null, "No Results"), `Check the spelling or try a new search.`));
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
    $("introText").textContent =
      `${num(cars.length)} car models and ${num(makers.length)} makers from Wikipedia, year by year — from Ferdinand Verbiest’s steam trolley of 1672 to today’s electric cars. ` +
      (coarse ? "Tap a bar to see that year’s cars." : "Hover a bar to peek, click it to see that year’s cars.");
    const stat = (v, l) => h("div", { class: "stat" }, h("b", null, v), h("span", null, l));
    $("stats").replaceChildren(
      stat(num(cars.length), "Car models"),
      stat(num(makers.length), "Makers"),
      stat(num(nCountries), "Countries"),
      stat(`${D.lastYear - 1672}`, "Years"));
    $("generated").textContent = `Snapshot taken ${D.generated}.`;
  }

  /* ------------------------------------------------------------------ routing */
  function parseRoute() {
    const t = /^#\/(milestones|makers|search)$/.exec(location.hash);
    if (t) return { type: "tab", id: t[1] };
    const m = /^#\/(car|maker|milestone|year)\/(.+)$/.exec(location.hash);
    if (!m) return null;
    const val = decodeURIComponent(m[2]);
    if (m[1] === "car") return carByTitle.has(val) ? { type: "car", id: carByTitle.get(val) } : null;
    if (m[1] === "maker") return makerByName.has(val) ? { type: "maker", id: makerByName.get(val) } : null;
    if (m[1] === "milestone") return D.milestones[+val] ? { type: "milestone", id: +val } : null;
    if (m[1] === "year") return { type: "year", id: +val };
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
