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

  const fmt = new Intl.NumberFormat(document.documentElement.lang === "fr" ? "fr-FR" : "en-US");
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

  /* SF-Symbols-like line icons (drawn for this app). */
  const ICONS = {
    chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 4.8 7.2 7.2L9 19.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowUpRight: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    xmarkCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".22"/><path d="m8.6 8.6 6.8 6.8m0-6.8-6.8 6.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><rect x="3" y="12.5" width="4.6" height="8" rx="1.6" fill="currentColor"/><rect x="9.7" y="7.5" width="4.6" height="13" rx="1.6" fill="currentColor"/><rect x="16.4" y="3.5" width="4.6" height="17" rx="1.6" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="m15.6 15.6 5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.2s-7.6-4.5-9.1-9.4C1.8 7.3 4.1 4.2 7.4 4.2c2 0 3.6 1.1 4.6 2.6 1-1.5 2.6-2.6 4.6-2.6 3.3 0 5.6 3.1 4.5 6.6-1.5 4.9-9.1 9.4-9.1 9.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    heartFill: '<svg viewBox="0 0 24 24"><path d="M12 20.2s-7.6-4.5-9.1-9.4C1.8 7.3 4.1 4.2 7.4 4.2c2 0 3.6 1.1 4.6 2.6 1-1.5 2.6-2.6 4.6-2.6 3.3 0 5.6 3.1 4.5 6.6-1.5 4.9-9.1 9.4-9.1 9.4Z" fill="currentColor"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="7.6" cy="12" r="4.3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M11.9 12h9M17.2 12v3.2M20.2 12v2.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    keyFill: '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M7.6 6.5a5.5 5.5 0 0 1 5.3 4.1h8.3c.7 0 1.2.6 1.2 1.3v2.6a1.2 1.2 0 0 1-2.4 0v-1.4h-.8v1.6a1.2 1.2 0 0 1-2.4 0v-1.6h-3.9A5.5 5.5 0 1 1 7.6 6.5Zm0 3.3a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/></svg>',
    car: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" fill="currentColor" d="M4 11.4 5.6 6.6A2.6 2.6 0 0 1 8 4.8h8a2.6 2.6 0 0 1 2.4 1.8l1.6 4.8c.9.5 1.5 1.5 1.5 2.6v4.6c0 .6-.4 1-1 1h-1.7c-.6 0-1-.4-1-1v-1.3H6.2v1.3c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1V14c0-1.1.6-2.1 1.5-2.6ZM6.5 10.9h11l-1.2-3.5a1 1 0 0 0-.9-.7H8.6a1 1 0 0 0-.9.7ZM5.6 14.7a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0ZM15.6 14.7a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0Z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 14.5V3.6M8.2 7.2 12 3.4l3.8 3.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.6 10.2H7.2a2 2 0 0 0-2 2v6.4a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-6.4a2 2 0 0 0-2-2h-1.4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
    tray: '<svg viewBox="0 0 24 24"><path d="M12 3.6v10.9M8.2 10.7l3.8 3.8 3.8-3.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 14.2v4.4a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-4.4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.3" fill="currentColor"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M12 6.4C10.3 5 8 4.4 4.6 4.5c-.6 0-1.1.5-1.1 1.1v11.6c0 .6.5 1.1 1.1 1.1 3.2-.1 5.4.5 7.4 1.9 2-1.4 4.2-2 7.4-1.9.6 0 1.1-.5 1.1-1.1V5.6c0-.6-.5-1.1-1.1-1.1C16 4.4 13.7 5 12 6.4Zm0 0v12.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3.8 12.6V5a1.2 1.2 0 0 1 1.2-1.2h7.6c.3 0 .6.1.9.4l7.3 7.3c.5.5.5 1.2 0 1.7l-7.6 7.6c-.5.5-1.2.5-1.7 0l-7.3-7.3a1.3 1.3 0 0 1-.4-.9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8.4" cy="8.4" r="1.6" fill="currentColor"/></svg>',
    checkmark: '<svg viewBox="0 0 24 24"><path d="m5.5 12.5 4.3 4.3 8.7-9.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5.6 21V3.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5.6 4.3c2.5-1.5 5-1.3 7.2 0 2.2 1.2 4.4 1.4 6.7.3v9.1c-2.3 1.1-4.5.9-6.7-.3-2.2-1.3-4.7-1.5-7.2 0Z" fill="currentColor"/></svg>',
  };
  const tpl = document.createElement("template");
  function icon(name, cls) {
    tpl.innerHTML = ICONS[name] || ""; // static, trusted markup
    const el = tpl.content.firstElementChild;
    if (!el) return null;
    el.setAttribute("aria-hidden", "true");
    if (cls) el.setAttribute("class", cls);
    return el;
  }

  function placeholder() {
    const d = h("div", { class: "ph" });
    d.innerHTML = CAR_SVG; // static, trusted markup
    return d;
  }

  window.V = { h, s, num, norm, clamp, debounce, thumbUrl, originalUrl, wikiImg, commonsPage, wikiUrl, splitTitle, placeholder, icon, SVGNS };
})();
