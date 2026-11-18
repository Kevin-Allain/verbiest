/* Verbiest — app logic: state, filters, results, details, search, routing. */
(function () {
  "use strict";
  const { h, s, num, norm, clamp, debounce, wikiImg, thumbUrl, commonsPage, wikiUrl, splitTitle, placeholder } = V;
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
  const countryName = (ci) => (ci >= 0 ? countries[ci].n : "Unknown country");

  /* ------------------------------------------------------------------ filters */
  function carPasses(c, ignoreDim) {
    if (state.maker != null && c.m !== state.maker) return false;
    if (state.kind && !(c.k & KIND[state.kind])) return false;
    if (ignoreDim !== "country" && state.off.country.size && state.off.country.has(carGroup(c, "country"))) return false;
    if (ignoreDim !== "body" && state.off.body.size && state.off.body.has(c.b)) return false;
    return true;
  }
  function makerPasses(m, ignoreDim) {
    if (m.f == null) return false;
    if (state.maker != null && m._i !== state.maker) return false;
    if (ignoreDim !== "country" && state.off.country.has(makerGroup(m))) return false;
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
        if (makerPasses(m, "country")) {
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
    onHover: (year, ev) => {
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
      if (!animated && state.era) { state.era = null; renderEraChips(); }
      updateResultsSoon();
    },
    onViewFrame: (v) => overview.setView(v),
    onPin: (ms) => openDetail("milestone", D.milestones.indexOf(ms)),
    onPinHover: (ms, ev) => { if (ms) showPinTip(ms, ev); else hideTip(); },
    onEra: (era) => goEra(era),
  });

  const overview = new Overview($("overview"), {
    firstYear: START_YEAR,
    marginLeft: () => chart.dims().M.l,
    onBrush: (a, b, animate) => {
      if (state.era) { state.era = null; renderEraChips(); }
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
    if ($("tableView").open) renderTable();
    if (state.sel != null && !tooltip.hidden) showYearTip(state.sel);
  }

  /* ------------------------------------------------------------------ controls */
  function bindSeg(id, key, onChange) {
    const seg = $(id);
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-v]");
      if (!b || b.disabled) return;
      if (state[key] === b.dataset.v) return;
      state[key] = b.dataset.v;
      for (const x of seg.querySelectorAll("button[data-v]")) x.setAttribute("aria-checked", String(x === b));
      onChange();
    });
  }
  bindSeg("metricSeg", "metric", () => {
    const makersMode = state.metric === "makers";
    for (const b of $("colorSeg").querySelectorAll("button")) {
      b.disabled = makersMode && b.dataset.v !== "country";
      b.style.opacity = b.disabled ? .4 : "";
    }
    $("typePills").style.display = makersMode ? "none" : "";
    refresh({ grow: true });
  });
  bindSeg("colorSeg", "colorBy", () => refresh({ grow: true }));

  // kind pills
  function renderPills() {
    const wrap = $("typePills");
    const all = [{ k: null, n: "All cars" }, ...D.kinds];
    wrap.replaceChildren(...all.map((k) => h("button", {
      class: "pill", type: "button", role: "radio", "aria-checked": String(state.kind === k.k),
      title: k.hint || null,
      onclick: () => { state.kind = k.k; renderPills(); refresh(); },
    }, k.n)));
  }

  // era chips
  function renderEraChips() {
    const wrap = $("eraChips");
    const chips = D.eras.map((e) => h("button", {
      class: "era-chip" + (state.era === e ? " active" : ""), type: "button",
      onclick: () => (state.era === e ? goAll() : goEra(e)),
    }, h("b", null, e.name), h("span", null, `${e.from < 1700 ? "1672" : e.from}–${e.to >= D.lastYear ? "today" : e.to}`)));
    wrap.replaceChildren(...chips);
  }
  function goEra(e) {
    state.era = e;
    selectYear(null);
    hideTip();
    renderEraChips();
    if (e.from < D.firstYear) chart.setView(0, Warp.t(e.to + 1) + 0.01, true);
    else chart.showYears(e.from, e.to, true);
  }
  function goAll() {
    state.era = null;
    renderEraChips();
    chart.setView(0, 1, true);
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
  $("zoomReset").onclick = () => { selectYear(null); goAll(); };
  $("sortSel").onchange = (ev) => { state.sort = ev.target.value; state.shown = PAGE; renderResults(); };
  $("hint").textContent = coarse
    ? "Swipe sideways on the chart to move through time, pinch to zoom, tap a bar to see that year’s cars. Tap a dot above the bars for a milestone."
    : "Drag the chart or the window below it to move through time · Ctrl/⌘ + scroll or double-click to zoom · click a bar to pick a year · ← → keys step through years.";

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

  /* ------------------------------------------------------------------ tooltip */
  function placeTip(x, y, below) {
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    let left = clamp(x - r.width / 2, 8, innerWidth - r.width - 8);
    let top = below ? y + 14 : y - r.height - 14;
    if (top < 8) top = y + 14;
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function hideTip() { tooltip.hidden = true; }
  function fillTip(...nodes) { tooltip.replaceChildren(...nodes.flat().filter(Boolean)); }

  function eraOf(year) { return D.eras.find((e) => year >= e.from && year <= e.to); }

  function showYearTip(year) {
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
      top.length ? h("div", { class: "tt-notable" }, "Notable: ", ...top.flatMap((t, k) => [k ? ", " : "", h("b", null, t)]), list.length > 3 ? ` +${num(list.length - 3)}` : "") : null,
      ms.length ? h("div", { class: "tt-notable" }, "★ ", ms.map((m) => m.label).join(" · ")) : null,
      h("div", { class: "tt-tip" }, state.sel === year ? (coarse ? "Selected · list below" : "Selected · click again to clear") : (coarse ? "Tap to see them all" : "Click to see them all"))
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
  document.addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest("#chart")) hideTip();
  });

  /* ------------------------------------------------------------------ selection */
  function selectYear(year) {
    state.sel = year;
    chart.setSelection(year);
    overview.setSelection(year);
    state.shown = PAGE;
    renderResults();
    const want = year != null ? `#/year/${year}` : "#/";
    if (!sheetOpen && location.hash !== want && !(year == null && (location.hash === "" || location.hash === "#/"))) {
      histReplace(history.state, want);
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
    const noun = makersMode ? "Makers founded" : state.maker != null ? `${makers[state.maker].n} models introduced` : "Cars introduced";
    let ya = y1, yb = y0;
    for (const id of ids) { const y = makersMode ? makers[id].f : cars[id].y; if (y < ya) ya = y; if (y > yb) yb = y; }
    $("resultsTitle").textContent = y0 === y1 ? `${noun} in ${y0}` : ids.length ? `${noun}, ${ya}–${yb}` : `${noun}, ${Math.max(y0, D.firstYear)}–${y1}`;
    const sortTxt = { fame: "most famous first", year: "oldest first", name: "alphabetical" }[state.sort];
    $("resultsSub").textContent = ids.length
      ? `${num(ids.length)} ${makersMode ? (ids.length === 1 ? "maker" : "makers") : (ids.length === 1 ? "model" : "models")} · ${sortTxt}` +
        (state.sel == null ? " · follows the zoom window above" : "")
      : "";

    // era note
    const note = $("eraNote");
    const era = state.sel == null ? state.era : null;
    if (era) {
      note.hidden = false;
      note.replaceChildren(...[
        h("h3", null, `${era.name} · ${era.from < 1700 ? 1672 : era.from}–${era.to >= D.lastYear ? "today" : era.to}`),
        h("p", null, era.text),
        era.link ? h("a", { href: era.link, target: "_blank", rel: "noopener" }, "Read more on Wikipedia ↗") : null,
      ].filter(Boolean));
    } else if (state.sel != null && D.milestones.some((m) => m.year === state.sel)) {
      const ms = D.milestones.filter((m) => m.year === state.sel);
      note.hidden = false;
      note.replaceChildren(...ms.map((m) => h("p", null, "★ ", h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); openDetail("milestone", D.milestones.indexOf(m)); } }, m.label), ` — ${m.s || ""}`)));
    } else note.hidden = true;

    renderActiveFilters();

    const grid = $("grid");
    grid.classList.toggle("makers", makersMode);
    if (!ids.length) {
      grid.replaceChildren(h("div", { class: "empty-state" },
        state.sel != null
          ? `No ${makersMode ? "makers founded" : "cars introduced"} in ${state.sel} match the current filters.`
          : "Nothing matches the current filters in this period."));
      $("moreBtn").hidden = true;
      return;
    }
    const slice = ids.slice(0, state.shown);
    grid.replaceChildren(...slice.map((id, k) => (makersMode ? makerRow(makers[id], k) : carCard(cars[id], k))));
    const more = $("moreBtn");
    more.hidden = ids.length <= state.shown;
    more.textContent = `Show more (${num(ids.length - state.shown)} left)`;
    if (!moreObserver && "IntersectionObserver" in window) {
      moreObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && !$("moreBtn").hidden) loadMore();
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
    ids.slice(from, state.shown).forEach((id, k) => grid.appendChild(makersMode ? makerRow(makers[id], k) : carCard(cars[id], k)));
    const more = $("moreBtn");
    more.hidden = ids.length <= state.shown;
    more.textContent = `Show more (${num(ids.length - state.shown)} left)`;
  }
  $("moreBtn").onclick = loadMore;

  function renderActiveFilters() {
    const chips = [];
    const chip = (label, clear) => h("span", { class: "chip" }, label, h("button", { type: "button", "aria-label": `Remove filter ${label}`, onclick: clear }, "×"));
    if (state.maker != null) chips.push(chip(`Maker: ${makers[state.maker].n}`, () => { state.maker = null; refresh(); }));
    if (state.kind && state.metric === "models") chips.push(chip(D.kinds.find((k) => k.k === state.kind).n, () => { state.kind = null; renderPills(); refresh(); }));
    for (const dim of ["country", "body"]) {
      if (!state.off[dim].size) continue;
      if (dim === "body" && state.metric === "makers") continue;
      const hidden = [...state.off[dim]].map((k) => D.dims[dim].groups[k].n);
      chips.push(chip(`Hiding ${hidden.length > 2 ? hidden.length + " " + (dim === "country" ? "countries" : "body styles") : hidden.join(", ")}`, () => { state.off[dim].clear(); refresh(); }));
    }
    if (state.sel != null) chips.push(chip(`Year ${state.sel}`, () => { selectYear(null); hideTip(); }));
    $("activeFilters").replaceChildren(...chips);
  }

  function yearsLabel(c) {
    if (c.e && c.e !== c.y) return `${c.y}–${c.e}`;
    return String(c.y);
  }

  function carCard(c, k, extraClass) {
    const [name, paren] = splitTitle(c.n);
    const maker = c.m >= 0 ? makers[c.m].n : null;
    const col = COLORS[state.metric === "models" ? state.colorBy : "country"][carGroup(c, state.metric === "models" ? state.colorBy : "country")];
    const thumb = h("div", { class: "thumb" });
    if (c.i) thumb.append(wikiImg(c.i, 250, "")); else thumb.append(placeholder());
    thumb.append(h("span", { class: "yr" }, yearsLabel(c)));
    return h("button", {
      class: "card" + (extraClass ? " " + extraClass : ""), type: "button", style: { "--i": Math.min(k, 24) },
      onclick: () => openDetail("car", c._i),
      "aria-label": `${c.n}, ${yearsLabel(c)}`,
    },
      thumb,
      h("div", { class: "cap" },
        h("div", { class: "nm" }, name, paren ? h("small", null, ` (${paren})`) : null),
        h("div", { class: "mt" }, h("i", { class: "dot", style: { "--c": col } }), h("span", null, [maker, countryName(c.c)].filter(Boolean).join(" · ")))));
  }

  function makerLogo(m) {
    if (m.i) {
      const url = thumbUrl(m.i, 120);
      return h("div", { class: "mlogo", style: { backgroundImage: `url("${url}")` } });
    }
    return h("div", { class: "mlogo ph" }, m.n.slice(0, 1));
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
      makerLogo(m),
      h("div", { class: "mname" }, h("b", null, m.n),
        h("span", null, h("i", { class: "dot", style: { "--c": COLORS.country[makerGroup(m)] } }), countryName(m.c), m._count ? ` · ${m._count} model${m._count > 1 ? "s" : ""}` : "")),
      lifeBar(m));
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
  $("tableView").addEventListener("toggle", () => { if ($("tableView").open) renderTable(); });

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

  function introBlock(title, fallback) {
    const box = h("div", { class: "d-text loading" }, h("p", null, "Loading the Wikipedia introduction for this article…"), h("p", null, "…"));
    const fill = (text, note) => {
      box.classList.remove("loading");
      const paras = (text || "").split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1);
      if (!paras.length) { box.replaceChildren(...[h("p", null, fallback || "No introduction available."), note ? h("p", { class: "d-source" }, note) : null].filter(Boolean)); return; }
      const first = paras.slice(0, 3).map((t) => h("p", null, t));
      box.replaceChildren(...first);
      if (paras.length > 3) {
        const more = h("button", { class: "text-btn", type: "button", onclick: () => { more.remove(); paras.slice(3).forEach((t) => box.append(h("p", null, t))); } }, "Read the rest of the introduction");
        box.append(more);
      }
      if (note) box.append(h("p", { class: "d-source" }, note));
    };
    fetchIntro(title).then((t) => fill(t), () => fill(fallback, "Could not reach Wikipedia — showing the short description only."));
    return box;
  }

  /* ------------------------------------------------------------------ detail sheet */
  const sheet = $("sheet"), scrim = $("scrim"), body = $("sheetBody");
  let sheetOpen = false;
  let lastFocus = null;

  function heroImage(code, alt, logo) {
    const hero = h("div", { class: "d-hero" + (logo ? " logo" : "") });
    if (!code) { hero.append(placeholder()); return hero; }
    if (!logo) hero.append(h("div", { class: "bg", style: { backgroundImage: `url("${thumbUrl(code, 120)}")` } }));
    const img = wikiImg(code, logo ? 330 : 500, alt);
    img.loading = "eager";
    hero.append(img);
    hero.append(h("a", { class: "credit", href: commonsPage(code), target: "_blank", rel: "noopener" }, "Image: Wikimedia ↗"));
    return hero;
  }

  const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function extLink(title, label) {
    const a = h("a", { class: "btn primary", href: wikiUrl(title), target: "_blank", rel: "noopener" }, label || "Read on Wikipedia");
    a.insertAdjacentHTML("beforeend", ICON_EXT);
    return a;
  }

  function strip(ids, currentId) {
    const wrap = h("div", { class: "strip" }, ids.map((id, k) => carCard(cars[id], k, id === currentId ? "current" : null)));
    if (currentId != null) requestAnimationFrame(() => {
      const cur = wrap.querySelector(".current");
      if (cur) wrap.scrollLeft = cur.offsetLeft - wrap.clientWidth / 2 + cur.clientWidth / 2;
    });
    return wrap;
  }

  /** Lifespan ribbon: the car's production years on the whole timeline + sibling models. */
  function ribbon(c) {
    const box = h("div", { class: "ribbon" });
    requestAnimationFrame(() => {
      const W = box.clientWidth || 380, H = 54;
      const a = Math.min(D.firstYear, c.y) - 2, b = D.lastYear + 1;
      const x = (y) => 4 + ((y - a) / (b - a)) * (W - 8);
      const svg = s("svg", { viewBox: `0 0 ${W} ${H}` });
      const base = 30;
      svg.append(s("line", { class: "rb-track", x1: x(a), x2: x(b), y1: base, y2: base }));
      for (let y = Math.ceil(a / 20) * 20; y <= b; y += 20) {
        svg.append(s("line", { class: "rb-track", x1: x(y), x2: x(y), y1: base - 3, y2: base + 3 }));
        if ((W > 420 || y % 40 === 0)) svg.append(s("text", { class: "rb-tick", x: x(y), y: H - 2, "text-anchor": "middle" }, String(y)));
      }
      if (c.m >= 0) {
        for (const id of makerCars[c.m]) {
          if (id === c._i) continue;
          const o = cars[id];
          const dot = s("circle", { class: "rb-other", cx: x(o.y + 0.5), cy: base, r: 3.2 });
          dot.append(s("title", null, `${o.n} (${yearsLabel(o)})`));
          dot.addEventListener("click", () => openDetail("car", id));
          svg.append(dot);
        }
      }
      const end = c.e || c.y;
      svg.append(s("rect", { class: "rb-life", x: x(c.y), y: base - 4, width: Math.max(6, x(end + 1) - x(c.y)), height: 8, rx: 4 }));
      const lx = clamp(x((c.y + end + 1) / 2), 30, W - 30);
      svg.append(s("text", { class: "rb-lbl", x: lx, y: base - 10, "text-anchor": "middle" }, yearsLabel(c)));
      box.append(svg);
    });
    return box;
  }

  function renderCar(i) {
    const c = cars[i];
    const m = c.m >= 0 ? makers[c.m] : null;
    const [name, paren] = splitTitle(c.n);
    const bodyGroup = D.dims.body.groups[c.b];
    const facts = [
      ["Introduced", String(c.y)],
      ["Discontinued", c.e ? String(c.e) : "—"],
      ["Country", countryName(c.c)],
      ["Body", bodyGroup && !bodyGroup.other ? bodyGroup.n : "—"],
      ["On Wikipedia in", c.p ? `${c.p} language${c.p > 1 ? "s" : ""}` : "—"],
    ];
    const chips = [];
    if (m) chips.push(h("button", { class: "d-chip", type: "button", onclick: () => openDetail("maker", c.m) }, h("i", { class: "dot", style: { "--c": COLORS.country[makerGroup(m)] } }), m.n, h("span", { class: "arrow" }, "›")));
    for (const t of c.t || []) chips.push(h("span", { class: "d-chip" }, D.tags[t]));

    const sameYear = cars.filter((o) => o.y === c.y && o._i !== i).sort((a, b) => b.p - a.p).slice(0, 14).map((o) => o._i);

    body.replaceChildren(
      heroImage(c.i, c.n),
      h("div", { class: "d-main" },
        h("div", { class: "d-kick" }, `${yearsLabel(c)} · ${countryName(c.c)}`),
        h("h2", { class: "d-title", id: "sheetTitle" }, name, paren ? h("span", { style: { color: "var(--text-3)", fontSize: ".7em" } }, ` (${paren})`) : null),
        c.s ? h("p", { class: "d-desc" }, c.s) : null,
        chips.length ? h("div", { class: "d-chips" }, chips) : null,
        h("dl", { class: "d-facts" }, facts.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
        introBlock(c.n, c.s),
        h("div", { class: "d-actions" },
          extLink(c.n),
          h("button", { class: "btn ghost", type: "button", onclick: () => { closeSheet(); revealYear(c.y); } }, `Show ${c.y} on the timeline`)),
        h("div", { class: "d-sec" },
          h("h3", null, "Place in history"),
          h("p", { class: "sub" }, m ? `Production years, with ${m.n}’s other models as dots (click one to open it).` : "Production years on the full timeline."),
          ribbon(c)),
        m && makerCars[c.m].length > 1 ? h("div", { class: "d-sec" },
          h("h3", null, `More from ${m.n}`),
          h("p", { class: "sub" }, `${makerCars[c.m].length} models on Wikipedia, in order of introduction`),
          strip(makerCars[c.m].slice(0, 200), i)) : null,
        sameYear.length ? h("div", { class: "d-sec" },
          h("h3", null, `Also new in ${c.y}`),
          h("p", { class: "sub" }, "The most famous cars introduced the same year"),
          strip(sameYear)) : null,
        h("p", { class: "d-source" }, "Text: ", h("a", { href: wikiUrl(c.n), target: "_blank", rel: "noopener" }, `Wikipedia, “${c.n}”`), " (CC BY-SA 4.0). Facts from Wikipedia categories and Wikidata.")
      )
    );
    $("sheetKicker").textContent = "";
  }

  function renderMaker(mi) {
    const m = makers[mi];
    const ids = makerCars[mi];
    const years = ids.map((id) => cars[id].y);
    const col = COLORS.country[makerGroup(m)];
    const y0 = Math.min(...years, m.f || 9999), y1 = Math.max(...years, m.d || 0);
    const facts = [
      ["Founded", m.f ? String(m.f) : "—"],
      ["Defunct", m.d ? String(m.d) : m.f ? "Still active" : "—"],
      ["Country", countryName(m.c)],
      ["Models", num(ids.length)],
    ];
    const counts = {};
    for (const y of years) counts[y] = (counts[y] || 0) + 1;
    const chartBox = h("div", { class: "mini-chart" });
    const gridIds = ids.slice().sort((a, b) => cars[a].y - cars[b].y);
    const showN = 60;
    const grid = h("div", { class: "d-grid" }, gridIds.slice(0, showN).map((id, k) => carCard(cars[id], k)));
    const moreBtn = gridIds.length > showN ? h("button", { class: "text-btn", type: "button", style: { marginTop: "10px" }, onclick: () => { gridIds.slice(showN).forEach((id, k) => grid.append(carCard(cars[id], k))); moreBtn.remove(); } }, `Show all ${gridIds.length}`) : null;

    body.replaceChildren(
      heroImage(m.i, m.n, m.logo),
      h("div", { class: "d-main" },
        h("div", { class: "d-kick" }, [countryName(m.c), m.f ? `${m.f}–${m.d || "today"}` : null].filter(Boolean).join(" · ")),
        h("h2", { class: "d-title", id: "sheetTitle" }, m.n),
        m.s ? h("p", { class: "d-desc" }, m.s) : null,
        h("dl", { class: "d-facts" }, facts.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
        ids.length ? h("div", { class: "d-sec", style: { marginTop: 0 } },
          h("h3", null, "New models per year"),
          h("p", { class: "sub" }, coarse ? "Tap a bar to open that year" : "Click a bar to show that year in the timeline"),
          chartBox) : null,
        m.a ? introBlock(m.a, m.s) : null,
        h("div", { class: "d-actions" },
          m.a ? extLink(m.a) : null,
          ids.length ? h("button", { class: "btn ghost", type: "button", onclick: () => focusMaker(mi) }, "Show only this maker on the timeline") : null),
        ids.length ? h("div", { class: "d-sec" },
          h("h3", null, "Models"),
          h("p", { class: "sub" }, "In order of introduction"),
          grid, moreBtn) : null,
        m.a ? h("p", { class: "d-source" }, "Text: ", h("a", { href: wikiUrl(m.a), target: "_blank", rel: "noopener" }, `Wikipedia, “${m.a}”`), " (CC BY-SA 4.0).") : null
      )
    );
    if (ids.length) requestAnimationFrame(() => miniHistogram(chartBox, counts, Math.min(y0, y1), Math.max(y0, y1), col, (y) => { focusMaker(mi, y); }));
  }

  function renderMilestone(k) {
    const ms = D.milestones[k];
    const prev = D.milestones[k - 1], next = D.milestones[k + 1];
    body.replaceChildren(
      heroImage(ms.i, ms.label),
      h("div", { class: "d-main" },
        h("div", { class: "d-kick" }, `Milestone · ${ms.year}`),
        h("h2", { class: "d-title", id: "sheetTitle" }, ms.label),
        ms.s ? h("p", { class: "d-desc" }, `${ms.title} — ${ms.s}`) : h("p", { class: "d-desc" }, ms.title),
        ms.x ? h("div", { class: "d-text" }, ms.x.split(/\n+/).filter((t) => t.trim().length > 1).slice(0, 4).map((t) => h("p", null, t))) : introBlock(ms.title, ms.s),
        h("div", { class: "d-actions" },
          extLink(ms.title),
          h("button", { class: "btn ghost", type: "button", onclick: () => { closeSheet(); revealYear(ms.year); } }, `Go to ${ms.year}`)),
        h("div", { class: "d-actions", style: { justifyContent: "space-between" } },
          prev ? h("button", { class: "text-btn", type: "button", onclick: () => openDetail("milestone", k - 1, { replace: true }) }, `← ${prev.year} · ${prev.label}`) : h("span"),
          next ? h("button", { class: "text-btn", type: "button", onclick: () => openDetail("milestone", k + 1, { replace: true }) }, `${next.year} · ${next.label} →`) : null),
        h("p", { class: "d-source" }, "Text: ", h("a", { href: wikiUrl(ms.title), target: "_blank", rel: "noopener" }, `Wikipedia, “${ms.title}”`), " (CC BY-SA 4.0).")
      )
    );
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
    if (opts.fromRoute) { /* already in history */ }
    else if (opts.replace && sheetOpen) histReplace({ depth }, url);
    else histPush({ depth: depth + 1 }, url);
    showDetail(type, id);
  }

  function showDetail(type, id) {
    hideTip();
    stopPlay();
    if (type === "car") renderCar(id);
    else if (type === "maker") renderMaker(id);
    else renderMilestone(id);
    body.scrollTop = 0;
    const depth = (history.state && history.state.depth) || 1;
    $("sheetBack").hidden = depth <= 1;
    if (!sheetOpen) {
      sheetOpen = true;
      lastFocus = document.activeElement;
      scrim.hidden = false;
      sheet.setAttribute("aria-hidden", "false");
      document.body.classList.add("sheet-open");
      requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("open"); });
      setTimeout(() => $("sheetClose").focus({ preventScroll: true }), 60);
    }
  }

  function hideSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove("open");
    scrim.classList.remove("show");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("sheet-open");
    sheet.style.transform = "";
    setTimeout(() => { if (!sheetOpen) scrim.hidden = true; }, 380);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function closeSheet() {
    const depth = (history.state && history.state.depth) || 0;
    if (depth > 0) history.go(-depth);
    else { histReplace(null, state.sel != null ? `#/year/${state.sel}` : "#/"); hideSheet(); }
  }

  $("sheetClose").onclick = closeSheet;
  $("sheetBack").onclick = () => history.back();
  scrim.onclick = closeSheet;
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && sheetOpen) { ev.preventDefault(); closeSheet(); }
  });

  // drag-down to close (phones)
  (function sheetDrag() {
    const grab = $("sheetGrab");
    let y0 = null, t0 = 0, dy = 0;
    grab.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; t0 = performance.now(); dy = 0; try { grab.setPointerCapture(ev.pointerId); } catch (e) {} sheet.classList.add("dragging"); });
    grab.addEventListener("pointermove", (ev) => { if (y0 == null) return; dy = Math.max(0, ev.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
    const end = () => {
      if (y0 == null) return;
      sheet.classList.remove("dragging");
      const v = dy / Math.max(1, performance.now() - t0);
      y0 = null;
      if (dy > 140 || v > 0.6) closeSheet(); else sheet.style.transform = "";
    };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
  })();

  function revealYear(y) {
    if (state.metric !== "models") {
      state.metric = "models";
      for (const b of $("metricSeg").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.v === "models"));
      $("typePills").style.display = "";
      for (const b of $("colorSeg").querySelectorAll("button")) { b.disabled = false; b.style.opacity = ""; }
      refresh();
    }
    const [a, b] = chart.view;
    const t = Warp.t(y + 0.5);
    if (t < a || t > b || b - a > 0.6) {
      const span = Math.min(b - a, Warp.t(2000) - Warp.t(1960));
      chart.setView(t - span / 2, t + span / 2, true);
    }
    selectYear(y);
    setTimeout(() => {
      $("chart").scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => showYearTip(y), 500);
    }, 350);
  }

  function focusMaker(mi, year) {
    state.maker = mi;
    state.kind = null;
    state.off.country.clear();
    state.off.body.clear();
    if (state.metric !== "models") {
      state.metric = "models";
      for (const b of $("metricSeg").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.v === "models"));
      $("typePills").style.display = "";
      for (const b of $("colorSeg").querySelectorAll("button")) { b.disabled = false; b.style.opacity = ""; }
    }
    renderPills();
    closeSheet();
    refresh({ grow: true });
    const ys = makerCars[mi].map((id) => cars[id].y);
    if (ys.length) chart.showYears(Math.min(...ys), Math.max(...ys), true);
    selectYear(year != null ? year : null);
    setTimeout(() => $("chart").scrollIntoView({ behavior: "smooth", block: "center" }), 350);
  }

  /* ------------------------------------------------------------------ routing */
  function parseRoute() {
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
    const r = parseRoute();
    if (r && r.type !== "year") showDetail(r.type, r.id);
    else hideSheet();
  });

  /* ------------------------------------------------------------------ search */
  (function search() {
    const box = $("search"), input = $("searchInput"), list = $("searchResults");
    let items = [], active = -1;

    function score(nameNorm, q, tokens, pop) {
      if (!tokens.every((t) => nameNorm.includes(t))) return -1;
      let sc = pop;
      if (nameNorm === q) sc += 2000;
      else if (nameNorm.startsWith(q)) sc += 600;
      else if (nameNorm.includes(" " + tokens[0])) sc += 150;
      return sc;
    }

    function run() {
      const q = norm(input.value.trim());
      if (!q) { close(); return; }
      const tokens = q.split(/\s+/);
      const mk = [];
      for (const m of makers) { const sc = score(m._n, q, tokens, m.p * 4 + m._count); if (sc >= 0) mk.push([sc, m]); }
      mk.sort((a, b) => b[0] - a[0]);
      const cs = [];
      for (const c of cars) { const sc = score(c._n, q, tokens, c.p * 3); if (sc >= 0) cs.push([sc, c]); }
      cs.sort((a, b) => b[0] - a[0]);
      const nodes = [];
      items = [];
      const yr = /^\d{4}$/.test(q) ? +q : null;
      if (yr && yr >= START_YEAR && yr <= D.lastYear) {
        nodes.push(h("div", { class: "sr-group" }, "Year"));
        nodes.push(item(null, `Go to ${yr}`, "Show the cars introduced that year", () => revealYear(yr), false));
      }
      if (mk.length) {
        nodes.push(h("div", { class: "sr-group" }, "Makers"));
        mk.slice(0, 5).forEach(([, m]) => nodes.push(item(m.i, m.n, [countryName(m.c), m.f ? `since ${m.f}` : null, `${m._count} models`].filter(Boolean).join(" · "), () => openDetail("maker", m._i), true, tokens)));
      }
      if (cs.length) {
        nodes.push(h("div", { class: "sr-group" }, `Cars${cs.length > 10 ? ` · top 10 of ${num(cs.length)}` : ""}`));
        cs.slice(0, 10).forEach(([, c]) => nodes.push(item(c.i, c.n, [yearsLabel(c), c.m >= 0 ? makers[c.m].n : null].filter(Boolean).join(" · "), () => openDetail("car", c._i), false, tokens)));
      }
      if (!nodes.length) nodes.push(h("div", { class: "sr-empty" }, `Nothing found for “${input.value.trim()}”.`));
      list.replaceChildren(...nodes);
      active = items.length ? 0 : -1;
      mark();
      box.classList.add("open");
      input.setAttribute("aria-expanded", "true");
    }

    function highlight(name, tokens) {
      if (!tokens) return [name];
      const n = norm(name);
      const marks = new Array(name.length).fill(false);
      for (const t of tokens) { let i = n.indexOf(t); if (i >= 0) for (let k = i; k < i + t.length; k++) marks[k] = true; }
      const out = [];
      let buf = "", on = false;
      for (let i = 0; i < name.length; i++) {
        if (marks[i] !== on) { if (buf) out.push(on ? h("mark", null, buf) : buf); buf = ""; on = marks[i]; }
        buf += name[i];
      }
      if (buf) out.push(on ? h("mark", null, buf) : buf);
      return out;
    }

    function item(img, name, meta, action, round, tokens) {
      const idx = items.length;
      const el = h("button", { class: "sr-item", type: "button", role: "option", "aria-selected": "false",
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => { close(); input.blur(); action(); } },
        h("span", { class: "sr-thumb" + (round ? " round" : ""), style: img ? { backgroundImage: `url("${thumbUrl(img, 120)}")` } : null }),
        h("span", { class: "sr-main" }, h("div", { class: "sr-name" }, highlight(name, tokens)), h("div", { class: "sr-meta" }, meta)));
      el.addEventListener("mouseenter", () => { active = idx; mark(); });
      items.push({ el, action });
      return el;
    }

    function mark() { items.forEach((it, k) => it.el.setAttribute("aria-selected", String(k === active))); if (items[active]) items[active].el.scrollIntoView({ block: "nearest" }); }
    function close() { box.classList.remove("open"); input.setAttribute("aria-expanded", "false"); }

    input.addEventListener("input", debounce(run, 90));
    input.addEventListener("focus", () => { if (input.value.trim()) run(); });
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); mark(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { active = Math.max(0, active - 1); mark(); ev.preventDefault(); }
      else if (ev.key === "Enter" && items[active]) { const a = items[active].action; close(); input.blur(); a(); }
      else if (ev.key === "Escape") { input.value = ""; close(); input.blur(); }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "/" && document.activeElement !== input && !sheetOpen && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        ev.preventDefault(); input.focus();
      }
    });
  })();

  /* ------------------------------------------------------------------ theme */
  $("themeBtn").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("verbiest-theme", next); } catch (e) {}
    readColors();
    chart.setColors(COLORS[agg.dim]);
    renderLegend();
    renderResults();
    overview.draw();
  };

  if (innerWidth < 520) $("searchInput").placeholder = "Search";

  /* ------------------------------------------------------------------ intro */
  function renderIntro() {
    const nCountries = new Set(cars.map((c) => c.c).filter((c) => c >= 0)).size;
    $("introText").textContent =
      `Explore ${num(cars.length)} car models and ${num(makers.length)} makers documented on Wikipedia, year by year — from Ferdinand Verbiest’s little steam trolley of 1672 to today’s electric cars. ` +
      (coarse ? "Tap a bar to see that year’s cars, and open any car to read its story." : "Hover a bar to peek, click it to list that year’s cars, and open any car to read its story.");
    const stat = (v, l) => h("div", { class: "stat" }, h("span", { class: "stat-v" }, v), h("span", { class: "stat-l" }, l));
    $("stats").replaceChildren(
      stat(num(cars.length), "car models"),
      stat(num(makers.length), "makers"),
      stat(num(nCountries), "countries"),
      stat(`${D.lastYear - 1672}`, "years of history"));
    $("generated").textContent = `Snapshot taken ${D.generated}.`;
  }

  window.VERBIEST_APP = { chart, overview, state }; // handy for debugging in the console

  /* ------------------------------------------------------------------ boot */
  renderIntro();
  renderPills();
  renderEraChips();
  refresh({ grow: true });
  chart.setView(0, 1, false);

  const r0 = parseRoute();
  if (r0 && r0.type === "year") {
    if (r0.id >= START_YEAR && r0.id <= D.lastYear) setTimeout(() => revealYear(r0.id), 300);
  } else if (r0) {
    const url = location.hash;
    histReplace(null, "#/");
    histPush({ depth: 1 }, url);
    showDetail(r0.type, r0.id);
  }
})();
