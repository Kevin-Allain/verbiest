/* Small shared helpers (no dependencies). */
(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";

  /** Create an HTML element: h("div", {class: "x", onclick: fn}, child, "text") */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    applyAttrs(el, attrs);
    append(el, children);
    return el;
  }

  /** Create an SVG element */
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVGNS, tag);
    applyAttrs(el, attrs);
    append(el, children);
    return el;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") {
        for (const sk in v) {
          if (v[sk] == null) continue;
          if (sk.startsWith("--")) el.style.setProperty(sk, v[sk]);
          else el.style[sk] = v[sk];
        }
      }
      else if (k === "text") el.textContent = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
  }

  const fmt = new Intl.NumberFormat("en-US");
  const num = (n) => fmt.format(Math.round(n));

  /** Accent-insensitive, lower-case form used for searching. */
  function norm(str) {
    return (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  /* ---- Wikimedia images --------------------------------------------------
     Images are stored as "<repo><md5[0:2]>|<File_name.ext>", where repo is
     "c" (Wikimedia Commons) or "e" (English Wikipedia). Thumbnails must use
     one of Wikimedia's standard widths. */
  const STD_WIDTHS = [120, 250, 330, 500, 960, 1280];

  function parseImg(code) {
    if (!code) return null;
    const bar = code.indexOf("|");
    return { repo: code[0] === "e" ? "en" : "commons", hash: code.slice(1, bar), file: code.slice(bar + 1) };
  }

  function thumbUrl(code, width) {
    const im = parseImg(code);
    if (!im) return null;
    const w = STD_WIDTHS.find((x) => x >= width) || 1280;
    const f = im.file;
    const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
    let name = `${w}px-${f}`;
    if (ext === "svg") name += ".png";
    else if (ext === "tif" || ext === "tiff") name = `lossy-page1-${w}px-${f}.jpg`;
    else if (ext === "pdf" || ext === "djvu") name = `page1-${w}px-${f}.jpg`;
    const e = encodeURIComponent;
    return `https://upload.wikimedia.org/wikipedia/${im.repo}/thumb/${im.hash[0]}/${im.hash}/${e(f)}/${e(name)}`;
  }

  function originalUrl(code) {
    const im = parseImg(code);
    if (!im) return null;
    return `https://upload.wikimedia.org/wikipedia/${im.repo}/${im.hash[0]}/${im.hash}/${encodeURIComponent(im.file)}`;
  }

  /** <img> that fades in on load and falls back to the original file if the
      thumbnail can't be produced (e.g. the original is smaller than asked). */
  function wikiImg(code, width, alt, cls) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const img = h("img", { alt: alt || "", loading: "lazy", decoding: "async", class: cls || null, referrerpolicy: "no-referrer" });
    img.addEventListener("load", () => img.classList.add("loaded"));
    img.addEventListener("error", function onErr() {
      if (!img.dataset.fallback) {
        img.dataset.fallback = "1";
        img.src = originalUrl(code);
      } else {
        img.removeEventListener("error", onErr);
        img.remove();
      }
    });
    img.src = thumbUrl(code, width * dpr);
    return img;
  }

  function commonsPage(code) {
    const im = parseImg(code);
    if (!im) return null;
    const host = im.repo === "en" ? "en.wikipedia.org" : "commons.wikimedia.org";
    return `https://${host}/wiki/File:${encodeURIComponent(im.file)}`;
  }

  function wikiUrl(title) {
    return "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  }

  /** Split "Ford Falcon (XA)" into ["Ford Falcon", "XA"]. */
  function splitTitle(title) {
    const m = /^(.*?)\s*\(([^)]+)\)$/.exec(title);
    return m ? [m[1], m[2]] : [title, null];
  }

  const CAR_SVG = '<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M8 42c0-6 3-9 9-10l14-3 14-11c3-2 6-3 10-3h22c4 0 7 1 10 4l10 10 12 2c5 1 8 4 8 9v5c0 2-1 3-3 3h-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="M43 48H76M8 42v3c0 2 1 3 3 3h6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="30" cy="47" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="89" cy="47" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M49 29l8-8c2-1 3-2 5-2h12v10zM78 19h7c2 0 3 1 4 2l7 8H78z" fill="currentColor" opacity=".5"/></svg>';

  function placeholder() {
    const d = h("div", { class: "ph" });
    d.innerHTML = CAR_SVG; // static, trusted markup
    return d;
  }

  window.V = { h, s, num, norm, clamp, debounce, thumbUrl, originalUrl, wikiImg, commonsPage, wikiUrl, splitTitle, placeholder, SVGNS };
})();
