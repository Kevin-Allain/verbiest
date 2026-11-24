/* Timeline histogram + overview brush, hand-written SVG (no dependencies).

   The time axis is "warped": the long, nearly empty prelude before the first
   data year (Verbiest 1672 … 1859) is compressed into a narrow strip on the
   left so the 1860–today histogram keeps most of the width. The compression
   is marked on the axis with a break symbol. All zooming/panning happens in
   warped space t ∈ [0, 1].
*/
(function () {
  "use strict";
  const { s, clamp, num } = V;

  /* ------------------------------------------------------------- warp */
  const Warp = {
    y0: 1660, yb: 1860, y1: 2027, tb: 0.06,
    configure(firstDataYear, lastDataYear) {
      this.yb = firstDataYear;
      this.y1 = lastDataYear + 1;
    },
    t(y) {
      return y < this.yb
        ? ((y - this.y0) / (this.yb - this.y0)) * this.tb
        : this.tb + ((y - this.yb) / (this.y1 - this.yb)) * (1 - this.tb);
    },
    y(t) {
      return t < this.tb
        ? this.y0 + (t / this.tb) * (this.yb - this.y0)
        : this.yb + ((t - this.tb) / (1 - this.tb)) * (this.y1 - this.yb);
    },
  };

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function niceMax(v) {
    if (v <= 0) return 4;
    const st = niceStep(v, 4);
    return Math.max(st * Math.ceil((v * 1.04) / st), 2);
  }
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  /** Rect path with optional rounded top corners. */
  function barPath(x, yTop, w, yBot, r) {
    if (yBot - yTop < 0.25 || w <= 0) return "";
    if (!r) return `M${x.toFixed(2)},${yBot.toFixed(2)}V${yTop.toFixed(2)}h${w.toFixed(2)}V${yBot.toFixed(2)}Z`;
    r = Math.min(r, (yBot - yTop), w / 2);
    const x2 = x + w;
    return `M${x.toFixed(2)},${yBot.toFixed(2)}V${(yTop + r).toFixed(2)}Q${x.toFixed(2)},${yTop.toFixed(2)} ${(x + r).toFixed(2)},${yTop.toFixed(2)}H${(x2 - r).toFixed(2)}Q${x2.toFixed(2)},${yTop.toFixed(2)} ${x2.toFixed(2)},${(yTop + r).toFixed(2)}V${yBot.toFixed(2)}Z`;
  }

  /* =================================================================== */
  class TimelineChart {
    constructor(el, opts) {
      this.el = el;
      this.o = opts;
      this.view = [0, 1];
      this.viewAnim = null;
      this.sel = null;
      this.hover = null;
      this.G = 0;
      this.colors = [];
      this.years0 = opts.firstYear;
      this.nY = opts.lastYear - opts.firstYear + 1;
      this.target = new Float32Array(0);
      this.disp = new Float32Array(0);
      this.yMaxD = 10;
      this.yMaxT = 10;
      this.milestones = opts.milestones || [];
      this.eras = opts.eras || [];
      this.pointers = new Map();
      this._raf = 0;
      this._last = 0;
      this.build();
      new ResizeObserver(() => this.draw()).observe(el);
    }

    build() {
      this.svg = s("svg", { role: "img", "aria-hidden": "true" });
      this.gEra = s("g");
      this.gGrid = s("g");
      this.gHoverBand = s("g");
      this.gBars = s("g", { class: "c-bars" });
      this.gBarsSel = s("g", { class: "c-bars-sel" });
      this.gAxis = s("g");
      this.gPins = s("g");
      this.gTop = s("g");
      this.svg.append(this.gEra, this.gGrid, this.gHoverBand, this.gBars, this.gBarsSel, this.gAxis, this.gPins, this.gTop);
      this.el.appendChild(this.svg);
      this.bindEvents();
    }

    /* ---------------- data ---------------- */
    setSeries(matrix, G, colors, { grow = false } = {}) {
      const changedShape = G !== this.G;
      this.G = G;
      this.colors = colors;
      this.target = matrix;
      if (changedShape || grow || this.disp.length !== matrix.length) {
        this.disp = new Float32Array(matrix.length); // regrow from zero
      }
      this.updateYMax();
      this.kick();
    }

    setColors(colors) { this.colors = colors; this.draw(); }

    totalsT(i) {
      let t = 0;
      for (let g = 0; g < this.G; g++) t += this.target[i * this.G + g];
      return t;
    }

    updateYMax() {
      const [a, b] = this.visibleYearRange(this.viewAnim ? this.viewAnim.to : this.view);
      let m = 0;
      for (let y = a; y <= b; y++) {
        const i = y - this.years0;
        if (i < 0 || i >= this.nY) continue;
        m = Math.max(m, this.totalsT(i));
      }
      this.yMaxT = niceMax(m);
    }

    visibleYearRange(view) {
      return [Math.floor(Warp.y(view[0])), Math.ceil(Warp.y(view[1]))];
    }

    /* ---------------- view ---------------- */
    setView(t0, t1, animate) {
      const minSpan = Warp.t(2000) - Warp.t(1994); // ≈ 6 years
      let span = clamp(t1 - t0, minSpan, 1);
      let a = clamp(t0, 0, 1 - span);
      const to = [a, a + span];
      if (animate) {
        this.viewAnim = { from: this.view.slice(), to, start: performance.now(), dur: 650 };
      } else {
        this.viewAnim = null;
        this.view = to;
      }
      this.updateYMax();
      this.kick();
      if (this.o.onViewChange) this.o.onViewChange(to, !!animate);
    }

    zoomAt(factor, tCenter, animate) {
      const [a, b] = this.viewAnim ? this.viewAnim.to : this.view;
      const span = (b - a) * factor;
      const c = tCenter == null ? (a + b) / 2 : tCenter;
      const rel = (c - a) / (b - a);
      this.setView(c - rel * span, c - rel * span + span, animate);
    }

    showYears(y0, y1, animate = true) {
      const pad = (y1 - y0 + 1) * 0.04;
      this.setView(Warp.t(y0 - pad), Warp.t(y1 + 1 + pad), animate);
    }

    setSelection(year) {
      this.sel = year;
      this.draw();
    }

    /* ---------------- animation loop ---------------- */
    kick() {
      if (!this._raf) {
        this._last = performance.now();
        this._raf = requestAnimationFrame((t) => this.tick(t));
      }
    }

    tick(now) {
      this._raf = 0;
      const dt = Math.min(64, now - this._last);
      this._last = now;
      const k = 1 - Math.exp(-dt / 90);
      let moving = false;
      const T = this.target, D = this.disp;
      for (let i = 0; i < T.length; i++) {
        const d = T[i] - D[i];
        if (d > 0.004 || d < -0.004) { D[i] += d * k; moving = true; } else D[i] = T[i];
      }
      const dm = this.yMaxT - this.yMaxD;
      if (Math.abs(dm) > 0.01) { this.yMaxD += dm * (1 - Math.exp(-dt / 110)); moving = true; } else this.yMaxD = this.yMaxT;
      if (this.viewAnim) {
        const va = this.viewAnim;
        const p = clamp((now - va.start) / va.dur, 0, 1);
        const e = easeInOut(p);
        this.view = [va.from[0] + (va.to[0] - va.from[0]) * e, va.from[1] + (va.to[1] - va.from[1]) * e];
        if (p >= 1) this.viewAnim = null; else moving = true;
        if (this.o.onViewFrame) this.o.onViewFrame(this.view);
      }
      this.draw();
      if (moving) this._raf = requestAnimationFrame((t) => this.tick(t));
    }

    /* ---------------- geometry ---------------- */
    dims() {
      const W = this.el.clientWidth, H = this.el.clientHeight;
      const compact = W < 560;
      // Apple-chart layout: value axis on the trailing (right) edge
      const M = { l: 2, r: compact ? 34 : 40, t: compact ? 40 : 46, b: 24 };
      return { W, H, M, pw: Math.max(10, W - M.l - M.r), ph: Math.max(10, H - M.t - M.b), compact };
    }

    xOf(year, d) {
      const [a, b] = this.view;
      return d.M.l + ((Warp.t(year) - a) / (b - a)) * d.pw;
    }

    yearAt(clientX) {
      const d = this.dims();
      const r = this.el.getBoundingClientRect();
      const [a, b] = this.view;
      const t = a + ((clientX - r.left - d.M.l) / d.pw) * (b - a);
      return Math.floor(Warp.y(t));
    }

    tAt(clientX) {
      const d = this.dims();
      const r = this.el.getBoundingClientRect();
      const [a, b] = this.view;
      return a + ((clientX - r.left - d.M.l) / d.pw) * (b - a);
    }

    /** Screen position of a year's bar top (for tooltips). */
    anchorFor(year) {
      const d = this.dims();
      const r = this.el.getBoundingClientRect();
      const i = year - this.years0;
      const tot = i >= 0 && i < this.nY ? this.totalsT(i) : 0;
      const x = (this.xOf(year, d) + this.xOf(year + 1, d)) / 2;
      const y = d.M.t + d.ph - (tot / this.yMaxD) * d.ph;
      return { x: r.left + x, y: r.top + Math.max(d.M.t, y), bottom: r.top + d.M.t + d.ph };
    }

    /* ---------------- drawing ---------------- */
    draw() {
      const d = this.dims();
      const { W, H, M, pw, ph } = d;
      if (!W || !H) return;
      this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const base = M.t + ph;
      const xL = M.l, xR = M.l + pw;
      const yOf = (v) => base - (v / this.yMaxD) * ph;
      const clipX = (x) => clamp(x, xL, xR);

      /* eras ---------------------------------------------------------- */
      const eraNodes = [];
      this.eras.forEach((e, k) => {
        const x0 = this.xOf(e.from, d), x1 = this.xOf(e.to + 1, d);
        if (x1 < xL || x0 > xR) return;
        const a = clipX(x0), b = clipX(x1);
        eraNodes.push(s("rect", { class: "c-era" + (k % 2 ? " alt" : ""), x: a, y: M.t - 4, width: Math.max(0, b - a), height: ph + 4 }));
        if (x0 > xL + 1) eraNodes.push(s("line", { class: "c-era-line", x1: x0, x2: x0, y1: 4, y2: base }));
        const cw = 7.4; // uppercase, tracked label: ~7.4px per character
        const label = (b - a) > (e.name.length * cw + 18) ? e.name : (b - a) > (e.short.length * cw + 14) ? e.short : null;
        if (label) {
          const t = s("text", { x: a + 7, y: 14, class: "c-era-lab" }, label.toUpperCase());
          t.addEventListener("click", () => this.o.onEra && this.o.onEra(e));
          eraNodes.push(t);
        }
      });
      this.gEra.replaceChildren(...eraNodes);

      /* grid ---------------------------------------------------------- */
      const gridNodes = [];
      const step = Math.max(1, niceStep(this.yMaxT, d.compact ? 3 : 4)); // counts: whole numbers only
      for (let v = step; v <= this.yMaxD * 1.001; v += step) {
        const y = Math.round(yOf(v)) + 0.5;
        gridNodes.push(s("line", { class: "c-grid", x1: xL, x2: xR, y1: y, y2: y }));
        gridNodes.push(s("text", { class: "c-ylab", x: xR + 7, y: y + 3.5 }, num(v)));
      }
      gridNodes.push(s("text", { class: "c-ylab", x: xR + 7, y: base + 3.5 }, "0"));
      this.gGrid.replaceChildren(...gridNodes);

      /* bars ---------------------------------------------------------- */
      const G = this.G;
      const paths = new Array(G).fill("");
      const selPaths = new Array(G).fill("");
      const [ya, yb] = this.visibleYearRange(this.view);
      for (let y = Math.max(ya, this.years0); y <= Math.min(yb, this.years0 + this.nY - 1); y++) {
        const i = y - this.years0;
        const x0 = this.xOf(y, d), x1 = this.xOf(y + 1, d);
        if (x1 < xL - 1 || x0 > xR + 1) continue;
        const band = x1 - x0;
        const gap = band >= 7 ? 2 : band >= 3 ? 1 : 0;
        const bw = Math.min(band - gap, 42);
        const bx = x0 + (band - bw) / 2;
        const segGap = bw >= 7 ? 1.5 : bw >= 3 ? 1 : 0;
        const r = bw >= 6 ? 3.5 : bw >= 3 ? 1 : 0;
        // find top-most non-empty group
        let topG = -1;
        for (let g = G - 1; g >= 0; g--) if (this.disp[i * G + g] > 0.02) { topG = g; break; }
        let yCur = base;
        const isSel = this.sel === y;
        for (let g = 0; g <= topG; g++) {
          const v = this.disp[i * G + g];
          if (v <= 0.02) continue;
          let hgt = (v / this.yMaxD) * ph;
          const minH = 1.2 + (yCur < base ? segGap : 0);
          if (hgt < minH) hgt = minH;
          const yTop = yCur - hgt;
          const yBot = yCur - (yCur < base ? segGap : 0);
          const p = barPath(bx, yTop, bw, yBot, g === topG ? r : 0);
          if (isSel) selPaths[g] += p; else paths[g] += p;
          yCur = yTop;
        }
      }
      this.gBars.classList.toggle("dim", this.sel != null);
      this.gBars.replaceChildren(...paths.map((p, g) => s("path", { d: p, fill: this.colors[g] })));
      this.gBarsSel.replaceChildren(...selPaths.map((p, g) => s("path", { d: p, fill: this.colors[g] })));

      /* hover band / selection rule ----------------------------------- */
      const bandNodes = [];
      const topNodes = [];
      const barTop = (year) => {
        const i = year - this.years0;
        let tot = 0;
        if (i >= 0 && i < this.nY) for (let g = 0; g < G; g++) tot += this.disp[i * G + g];
        return yOf(tot);
      };
      const ruleYear = this.sel != null ? this.sel : null;
      if (this.hover != null && this.hover !== ruleYear) {
        const x0 = this.xOf(this.hover, d), x1 = this.xOf(this.hover + 1, d);
        if (x1 > xL && x0 < xR) bandNodes.push(s("rect", { class: "c-hover-band", x: x0, y: M.t - 4, width: Math.max(1, x1 - x0), height: ph + 4, rx: Math.min(6, (x1 - x0) / 2) }));
      }
      if (ruleYear != null) {
        const x0 = this.xOf(ruleYear, d), x1 = this.xOf(ruleYear + 1, d);
        if (x1 > xL && x0 < xR) {
          // a "rule mark" from the top of the plot down to the selected bar, as in Apple's charts
          const cx = Math.round((x0 + x1) / 2) + 0.5;
          const yTop = Math.min(base, barTop(ruleYear)) - 5;
          if (yTop > M.t - 2) topNodes.push(s("line", { class: "c-rule", x1: cx, x2: cx, y1: M.t - 6, y2: yTop }));
        }
      }
      this.gHoverBand.replaceChildren(...bandNodes);

      /* x axis (Swift Charts style: gridline at the start of the year, label just after it) */
      const axisNodes = [s("line", { class: "c-base", x1: xL, x2: xR, y1: base + 0.5, y2: base + 0.5 })];
      const ticks = this.xTicks(d);
      const selX = this.sel != null ? this.xOf(this.sel + 0.5, d) : null;
      for (const tk of ticks) {
        const x = Math.round(this.xOf(tk.y, d)) + 0.5;
        if (x < xL - 1 || x > xR - 4) continue;
        axisNodes.push(s("line", { class: "c-vgrid", x1: x, x2: x, y1: M.t - 4, y2: base + 5 }));
        const lx = x + 4, lw = String(tk.y).length * 6.6;
        if (selX != null && lx < selX + 24 && lx + lw > selX - 24) continue; // keep clear of the selected-year pill
        if (lx + lw > xR + 30) continue;
        axisNodes.push(s("text", { class: "c-xlab", x: lx, y: base + 16 }, String(tk.y)));
      }
      // compression break
      const xb = this.xOf(Warp.yb, d);
      if (xb > xL + 2 && xb < xR - 2) {
        axisNodes.push(s("rect", { class: "c-break-bg", x: xb - 5, y: base - 4, width: 10, height: 9 }));
        axisNodes.push(s("path", { class: "c-break", d: `M${xb - 6},${base + 4} l4,-8 M${xb + 2},${base + 4} l4,-8` }));
        const xp0 = clipX(this.xOf(Warp.y0, d));
        if (xb - xp0 > 90) {
          axisNodes.push(s("text", { class: "c-prelude-note", x: (xp0 + xb) / 2, y: base - 8, "text-anchor": "middle" }, window.I18N ? I18N.t("compressed") : "compressed scale"));
        }
      }
      // selected year as a tinted pill on the axis
      if (this.sel != null) {
        const x0 = this.xOf(this.sel, d), x1 = this.xOf(this.sel + 1, d);
        if (x1 > xL && x0 < xR) {
          const cx = (x0 + x1) / 2;
          topNodes.push(s("rect", { class: "c-sel-pill", x: cx - 21, y: base + 4, width: 42, height: 18, rx: 9 }));
          topNodes.push(s("text", { class: "c-sel-label", x: cx, y: base + 17, "text-anchor": "middle" }, String(this.sel)));
        }
      }
      this.gAxis.replaceChildren(...axisNodes);
      this.gTop.replaceChildren(...topNodes);

      /* milestone pins ------------------------------------------------ */
      const pinNodes = [];
      const pinY = M.t - 18;
      let lastLabelEnd = -Infinity;
      // drop pins that would overlap the previous one (they reappear when zoomed in)
      let lastPinX = -Infinity;
      const visible = this.milestones
        .map((m) => ({ m, x: this.xOf(m.year + 0.5, d) }))
        .filter((p) => p.x >= xL - 2 && p.x <= xR + 2)
        .filter((p) => { if (p.x - lastPinX < 11) return false; lastPinX = p.x; return true; });
      visible.forEach((p, k) => {
        const next = visible[k + 1];
        const room = (next ? next.x : xR + 40) - p.x - 14;
        const labelW = p.m.label.length * 6 + 6;
        const g = s("g", { class: "c-pin" + (this.o.activePin === p.m ? " on" : ""), transform: `translate(${p.x.toFixed(1)},${pinY})`, tabindex: "-1" });
        g.append(
          s("line", { x1: 0, x2: 0, y1: 5, y2: 14 }),
          s("circle", { class: "hit", r: 11 }),
          s("circle", { class: "dot", r: 4.2 })
        );
        if (room > labelW && p.x > lastLabelEnd + 4 && p.x + labelW < W) {
          g.append(s("text", { x: 8, y: 4 }, p.m.label));
          lastLabelEnd = p.x + labelW + 8;
        }
        g.addEventListener("pointerenter", (ev) => this.o.onPinHover && this.o.onPinHover(p.m, ev));
        g.addEventListener("pointerleave", () => this.o.onPinHover && this.o.onPinHover(null));
        g.addEventListener("click", (ev) => { ev.stopPropagation(); this.o.onPin && this.o.onPin(p.m); });
        pinNodes.push(g);
      });
      this.gPins.replaceChildren(...pinNodes);

      if (this.o.onDraw) this.o.onDraw();
    }

    xTicks(d) {
      const out = [];
      const [a, b] = this.view;
      // main segment
      const ya = Math.max(Warp.y(a), Warp.yb), yb = Warp.y(b);
      if (yb > ya) {
        const pxPerYear = d.pw / ((b - a) / ((1 - Warp.tb) / (Warp.y1 - Warp.yb)));
        const minPx = d.compact ? 44 : 56;
        const step = [1, 2, 5, 10, 20, 25, 50, 100].find((st) => st * pxPerYear >= minPx) || 100;
        const major = step < 10 ? 10 : step * 2;
        for (let y = Math.ceil(ya / step) * step; y <= yb; y += step) out.push({ y, major: y % major === 0 });
      }
      // compressed prelude: just a couple of labels if there's room
      if (a < Warp.tb) {
        const pre = [1700, 1750, 1800];
        let last = -Infinity;
        for (const y of pre) {
          const x = this.xOf(y, d);
          if (x - last > 40 && this.xOf(Warp.yb, d) - x > 30) { out.push({ y, major: false }); last = x; }
        }
      }
      return out;
    }

    /* ---------------- interaction ---------------- */
    bindEvents() {
      const el = this.el;
      let downX = 0, downY = 0, startView = null, moved = false, pinch = null;
      // touch: press and hold, then slide, to scrub through the years (as in Apple's Health charts)
      let holdTimer = 0, scrubbing = false;
      const cancelHold = () => { clearTimeout(holdTimer); holdTimer = 0; };

      el.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest && ev.target.closest(".c-pin")) return;
        if (ev.target.classList && ev.target.classList.contains("c-era-lab")) return;
        this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointer */ }
        if (this.pointers.size === 1) {
          downX = ev.clientX; downY = ev.clientY; startView = this.view.slice(); moved = false;
          if (ev.pointerType !== "mouse") {
            cancelHold();
            holdTimer = setTimeout(() => {
              holdTimer = 0;
              if (moved || this.pointers.size !== 1) return;
              scrubbing = true;
              el.classList.add("scrubbing");
              this.setHover(this.yearAt(downX), ev);
            }, 260);
          }
        } else if (this.pointers.size === 2) {
          cancelHold();
          if (scrubbing) { scrubbing = false; el.classList.remove("scrubbing"); this.setHover(null); }
          const [p1, p2] = [...this.pointers.values()];
          pinch = { dist: Math.abs(p1.x - p2.x) || 1, view: this.view.slice(), tc: this.tAt((p1.x + p2.x) / 2) };
          moved = true;
        }
      });

      el.addEventListener("pointermove", (ev) => {
        if (this.pointers.has(ev.pointerId)) {
          this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          if (scrubbing) { this.setHover(this.yearAt(ev.clientX), ev); return; }
          if (holdTimer && Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) cancelHold();
          if (this.pointers.size >= 2 && pinch) {
            const [p1, p2] = [...this.pointers.values()];
            const dist = Math.abs(p1.x - p2.x) || 1;
            const span = (pinch.view[1] - pinch.view[0]) * (pinch.dist / dist);
            const rel = (pinch.tc - pinch.view[0]) / (pinch.view[1] - pinch.view[0]);
            this.setView(pinch.tc - rel * span, pinch.tc - rel * span + span, false);
            return;
          }
          const dx = ev.clientX - downX;
          if (!moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(ev.clientY - downY)) {
            moved = true;
            el.classList.add("panning");
            this.setHover(null);
          }
          if (moved && startView) {
            const d = this.dims();
            const dt = (-dx / d.pw) * (startView[1] - startView[0]);
            this.setView(startView[0] + dt, startView[1] + dt, false);
          }
          return;
        }
        if (ev.pointerType === "mouse") this.setHover(this.yearAt(ev.clientX), ev);
      });

      const end = (ev) => {
        cancelHold();
        if (scrubbing) {
          scrubbing = false;
          el.classList.remove("scrubbing");
          const y = this.hover;
          this.pointers.delete(ev.pointerId);
          this.setHover(null);
          if (ev.type === "pointerup" && y != null) this.o.onSelect && this.o.onSelect(y, "scrub");
          if (this.pointers.size === 0) { startView = null; moved = false; }
          return;
        }
        const wasTap = this.pointers.size === 1 && !moved && ev.type === "pointerup";
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) pinch = null;
        if (this.pointers.size === 0) {
          el.classList.remove("panning");
          if (wasTap) {
            const y = this.yearAt(ev.clientX);
            if (y >= this.years0 && y < this.years0 + this.nY) {
              this.o.onSelect && this.o.onSelect(this.sel === y ? null : y, ev.pointerType);
            } else {
              this.o.onSelect && this.o.onSelect(null, ev.pointerType);
            }
          }
          startView = null;
          moved = false;
        }
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.setHover(null); });
      // while scrubbing, keep the page from scrolling under the finger
      el.addEventListener("touchmove", (ev) => { if (scrubbing) ev.preventDefault(); }, { passive: false });
      el.addEventListener("contextmenu", (ev) => { if (scrubbing || holdTimer) ev.preventDefault(); });

      el.addEventListener("wheel", (ev) => {
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault();
          this.zoomAt(Math.exp(ev.deltaY * 0.01), this.tAt(ev.clientX), false);
        } else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
          ev.preventDefault();
          const d = this.dims();
          const [a, b] = this.view;
          const dt = (ev.deltaX / d.pw) * (b - a);
          this.setView(a + dt, b + dt, false);
        }
      }, { passive: false });

      el.addEventListener("dblclick", (ev) => this.zoomAt(0.5, this.tAt(ev.clientX), true));

      el.addEventListener("keydown", (ev) => {
        const cur = this.sel != null ? this.sel : Math.round(Warp.y((this.view[0] + this.view[1]) / 2));
        let handled = true;
        if (ev.key === "ArrowLeft") this.o.onSelect(Math.max(this.years0, cur - 1), "key");
        else if (ev.key === "ArrowRight") this.o.onSelect(Math.min(this.years0 + this.nY - 1, cur + 1), "key");
        else if (ev.key === "+" || ev.key === "=") this.zoomAt(0.6, null, true);
        else if (ev.key === "-" || ev.key === "_") this.zoomAt(1 / 0.6, null, true);
        else if (ev.key === "Escape") this.o.onSelect(null, "key");
        else handled = false;
        if (handled) ev.preventDefault();
      });
    }

    setHover(year, ev) {
      if (year != null && (year < this.years0 || year >= this.years0 + this.nY)) year = null;
      if (year === this.hover) return;
      this.hover = year;
      this.draw();
      if (this.o.onHover) this.o.onHover(year, ev);
    }

    /** Keep the selected year in view (used for keyboard navigation). */
    ensureVisible(year) {
      const [a, b] = this.view;
      const t0 = Warp.t(year), t1 = Warp.t(year + 1);
      if (t0 < a || t1 > b) {
        const span = b - a;
        const c = (t0 + t1) / 2;
        this.setView(c - span / 2, c + span / 2, true);
      }
    }
  }

  /* =================================================================== */
  /** Overview strip: whole timeline with a draggable zoom window. */
  class Overview {
    constructor(el, opts) {
      this.el = el;
      this.o = opts;
      this.totals = new Float32Array(0);
      this.years0 = opts.firstYear;
      this.view = [0, 1];
      this.sel = null;
      this.svg = s("svg", { "aria-hidden": "true" });
      this.gBars = s("g", { class: "o-bars" });
      this.gWin = s("g");
      this.svg.append(this.gBars, this.gWin);
      el.appendChild(this.svg);
      new ResizeObserver(() => this.draw()).observe(el);
      this.bind();
    }

    setTotals(totals) { this.totals = totals; this.draw(); }
    setView(v) { this.view = v; this.drawWindow(); }
    setSelection(y) { this.sel = y; this.drawWindow(); }

    dims() {
      const W = this.el.clientWidth, H = this.el.clientHeight;
      const m = this.o.margins ? this.o.margins() : { l: 2, r: 40 };
      const M = { l: m.l, r: m.r };
      return { W, H, M, pw: Math.max(10, W - M.l - M.r), barsH: H - 15 };
    }
    x(t, d) { return d.M.l + t * d.pw; }

    draw() {
      const d = this.dims();
      if (!d.W) return;
      this.svg.setAttribute("viewBox", `0 0 ${d.W} ${d.H}`);
      let max = 1;
      for (let i = 0; i < this.totals.length; i++) max = Math.max(max, this.totals[i]);
      let p = "";
      for (let i = 0; i < this.totals.length; i++) {
        const v = this.totals[i];
        if (v <= 0) continue;
        const y = this.years0 + i;
        const x0 = this.x(Warp.t(y), d), x1 = this.x(Warp.t(y + 1), d);
        const hgt = Math.max(1, (Math.sqrt(v / max)) * (d.barsH - 4));
        const w = Math.max(0.8, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
        p += barPath(x0, d.barsH - hgt, w, d.barsH, 0);
      }
      const nodes = [s("path", { d: p })];
      // ticks
      let last = -Infinity;
      for (const y of [1700, 1800, 1900, 1925, 1950, 1975, 2000]) {
        const x = this.x(Warp.t(y), d);
        if (x - last < 34) continue;
        last = x;
        nodes.push(s("text", { class: "o-label", x, y: d.H - 1, "text-anchor": "middle" }, String(y)));
      }
      this.gBars.replaceChildren(...nodes);
      this.drawWindow();
    }

    drawWindow() {
      const d = this.dims();
      if (!d.W) return;
      const [a, b] = this.view;
      const xa = this.x(a, d), xb = this.x(b, d);
      const full = a <= 0.0005 && b >= 0.9995;
      const nodes = [];
      const H = d.barsH, hw = 11; // handle width
      if (!full) {
        nodes.push(s("rect", { class: "o-shade", x: d.M.l - hw, y: 0, width: Math.max(0, xa - d.M.l + hw), height: H }));
        nodes.push(s("rect", { class: "o-shade", x: xb, y: 0, width: Math.max(0, d.M.l + d.pw - xb + hw), height: H }));
      }
      if (this.sel != null) {
        const xs = this.x(Warp.t(this.sel + 0.5), d);
        nodes.push(s("line", { class: "o-sel", x1: xs, x2: xs, y1: 4, y2: H - 4 }));
      }
      // trimmer frame, like the trim control in Apple's Photos: thick handles with chevrons
      const r = 7, bw = 2.5, w = Math.max(2, xb - xa);
      const outer = `M${xa - hw + r},0H${xb + hw - r}Q${xb + hw},0 ${xb + hw},${r}V${H - r}Q${xb + hw},${H} ${xb + hw - r},${H}H${xa - hw + r}Q${xa - hw},${H} ${xa - hw},${H - r}V${r}Q${xa - hw},0 ${xa - hw + r},0Z`;
      const inner = `M${xa},${bw}V${H - bw}H${xa + w}V${bw}Z`;
      this.win = s("rect", { class: "o-win", x: xa, y: bw, width: w, height: H - 2 * bw });
      nodes.push(this.win);
      nodes.push(s("path", { class: "o-frame", d: outer + inner, "fill-rule": "evenodd" }));
      for (const [side, x] of [["l", xa - hw / 2], ["r", xb + hw / 2]]) {
        const g = s("g", { class: "o-handle", "data-side": side, transform: `translate(${x},${H / 2})` });
        const c = side === "l" ? "M1.6,-4.5 -1.6,0 1.6,4.5" : "M-1.6,-4.5 1.6,0 -1.6,4.5";
        g.append(
          s("rect", { class: "hit", x: -14, y: -H / 2, width: 28, height: H }),
          s("path", { class: "o-chev", d: c })
        );
        nodes.push(g);
      }
      this.gWin.replaceChildren(...nodes);
    }

    bind() {
      let drag = null;
      const tAt = (clientX) => {
        const d = this.dims();
        const r = this.el.getBoundingClientRect();
        return clamp((clientX - r.left - d.M.l) / d.pw, 0, 1);
      };
      this.el.addEventListener("pointerdown", (ev) => {
        const t = tAt(ev.clientX);
        const handle = ev.target.closest && ev.target.closest(".o-handle");
        const [a, b] = this.view;
        if (handle) drag = { mode: handle.dataset.side, t0: t, view: [a, b] };
        else if (t >= a && t <= b) drag = { mode: "move", t0: t, view: [a, b] };
        else {
          const span = b - a;
          this.o.onBrush(t - span / 2, t + span / 2, true);
          drag = { mode: "move", t0: t, view: [t - span / 2, t + span / 2] };
        }
        try { this.el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointer */ }
        ev.preventDefault();
      });
      this.el.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        const t = tAt(ev.clientX);
        const dt = t - drag.t0;
        const [a, b] = drag.view;
        if (drag.mode === "move") this.o.onBrush(a + dt, b + dt, false);
        else if (drag.mode === "l") this.o.onBrush(Math.min(a + dt, b - 0.01), b, false);
        else this.o.onBrush(a, Math.max(b + dt, a + 0.01), false);
      });
      const end = () => { drag = null; };
      this.el.addEventListener("pointerup", end);
      this.el.addEventListener("pointercancel", end);
    }
  }

  /* =================================================================== */
  /** Small, static histogram used in maker details. */
  function miniHistogram(el, counts, y0, y1, color, onBar) {
    const W = el.clientWidth || 400, H = el.clientHeight || 110;
    const M = { l: 2, r: 28, t: 6, b: 20 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const n = y1 - y0 + 1;
    let max = 1;
    for (const k in counts) max = Math.max(max, counts[k]);
    const top = niceMax(max);
    const band = pw / n;
    const bw = Math.max(1, Math.min(band - (band > 4 ? 1.5 : 0.5), 18));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const base = M.t + ph;
    const st = Math.max(1, niceStep(top, 2));
    for (let v = st; v <= top; v += st) {
      const y = Math.round(base - (v / top) * ph) + 0.5;
      svg.append(s("line", { class: "c-grid", x1: M.l, x2: W - M.r, y1: y, y2: y }));
      svg.append(s("text", { class: "c-ylab", x: W - M.r + 6, y: y + 3.5 }, num(v)));
    }
    let path = "";
    for (let y = y0; y <= y1; y++) {
      const v = counts[y] || 0;
      if (!v) continue;
      const x = M.l + (y - y0) * band + (band - bw) / 2;
      const hgt = Math.max(2, (v / top) * ph);
      path += barPath(x, base - hgt, bw, base, bw >= 6 ? 3 : 1);
    }
    svg.append(s("path", { d: path, fill: color }));
    svg.append(s("line", { class: "c-base", x1: M.l, x2: W - M.r, y1: base + 0.5, y2: base + 0.5 }));
    const stepY = niceStep(n, Math.max(2, Math.floor(pw / 64)));
    for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY) {
      const x = Math.round(M.l + (y - y0) * band) + 0.5;
      svg.prepend(s("line", { class: "c-vgrid", x1: x, x2: x, y1: M.t, y2: base + 4 }));
      if (x + 30 < W) svg.append(s("text", { class: "c-xlab", x: x + 4, y: H - 4 }, String(y)));
    }
    // hit areas with native tooltips
    for (let y = y0; y <= y1; y++) {
      const v = counts[y] || 0;
      if (!v) continue;
      const r = s("rect", { x: M.l + (y - y0) * band, y: M.t, width: band, height: ph, fill: "transparent", style: { cursor: onBar ? "pointer" : "default" } });
      r.append(s("title", null, `${y}: ${v} model${v > 1 ? "s" : ""}`));
      if (onBar) r.addEventListener("click", () => onBar(y));
      svg.append(r);
    }
    el.replaceChildren(svg);
  }

  window.VChart = { Warp, TimelineChart, Overview, miniHistogram, niceStep };
})();
