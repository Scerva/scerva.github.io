(async function () {
  const root = document.documentElement;
  const wingEls = {
    projects: document.getElementById("wing-projects"),
    timeline: document.getElementById("wing-timeline"),
  };

  const load = async (url) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };

  let projects, timeline, manifest;
  try {
    [projects, timeline, manifest] = await Promise.all([
      load("paintings.json"),
      load("timeline.json"),
      load("photos/manifest.json"),
    ]);
  } catch (err) {
    wingEls.projects.innerHTML =
      '<p class="noscript">Could not load the gallery data. Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>).</p>';
    console.error(err);
    return;
  }

  const ARTIST = "Sergio Cervantes";
  const FALLBACK_COLOR = [238, 235, 229];

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Photo metadata comes from photos/manifest.json (built by tools/build_photos.py).
  // An entry may still override with its own "title" / "artist" / "color".
  function describe(w) {
    const meta = manifest[w.image] || {};
    const date = meta.date
      ? new Date(meta.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "";
    return {
      artist: w.artist || ARTIST,
      title: w.title || date || "Untitled",
      color: w.color || meta.color || FALLBACK_COLOR,
    };
  }

  // ---------- Color math ----------

  const toLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (l) => {
    const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, c)) * 255);
  };
  // Mix in linear light so blends between rooms don't go muddy.
  const lin = (rgb) => rgb.map(toLin);
  const mixLin = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const luminance = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const css = (l) => `rgb(${l.map(toSrgb).join(",")})`;
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  // Text palettes: light text for dark walls, dark beige-brown for light walls.
  // [r, g, b, alpha] — blended continuously as the wall color changes.
  const INK = {
    light: { ink: [255, 255, 255, 0.95], soft: [255, 255, 255, 0.72], faint: [255, 255, 255, 0.5], credit: [236, 226, 206, 0.5] },
    dark: { ink: [42, 36, 30, 0.95], soft: [42, 36, 30, 0.66], faint: [42, 36, 30, 0.45], credit: [96, 80, 56, 0.45] },
  };
  const DARK_INK_L = luminance(lin(INK.dark.ink.slice(0, 3)));
  const rgba = (a, b, t) => {
    const m = a.map((v, i) => v + (b[i] - v) * t);
    return `rgba(${Math.round(m[0])},${Math.round(m[1])},${Math.round(m[2])},${m[3].toFixed(3)})`;
  };

  // ---------- Rooms ----------

  function buildFrame(w, i, link, linkLabel) {
    const d = describe(w);
    // Projects: the painting is the link. Timeline: it just hangs there.
    const frame = el(link ? "a" : "div", "painting");
    if (link) {
      frame.href = link;
      frame.target = "_blank";
      frame.rel = "noopener";
      frame.setAttribute("aria-label", `${d.title} — open ${linkLabel}`);
    }
    const img = new Image();
    img.alt = `Photograph by ${d.artist}, ${d.title}`;
    img.decoding = "async";
    if (i > 1) img.loading = "lazy";
    img.addEventListener("load", () => img.classList.add("loaded"));
    img.src = w.image;
    if (img.complete) img.classList.add("loaded");
    frame.appendChild(img);
    return frame;
  }

  function buildRoom(p, i, kind) {
    // A room hangs one painting, or several side by side ("paintings": [...]).
    const works = p.paintings || [p];
    const described = works.map(describe);
    const room = el("section", "room");
    if (p.anchor) room.dataset.anchor = p.anchor;
    room.setAttribute("aria-label", described.map((d) => `${d.title}, ${d.artist}`).join("; "));

    // The wall takes the room's color: the photo's dominant color, or for a
    // row, the center piece's (averaging several tends to go muddy gray).
    room._color = lin(described[Math.floor((described.length - 1) / 2)].color);
    // Each room commits to whichever text color contrasts better with its wall
    // (1 = dark beige text, 0 = white); blending only happens between rooms.
    const L = luminance(room._color);
    room._darkText = (L + 0.05) / (DARK_INK_L + 0.05) > (1.05 / (L + 0.05)) ? 1 : 0;
    // Manual override from the JSON: "text": "light" (white) or "dark".
    if (p.text === "light") room._darkText = 0;
    else if (p.text === "dark") room._darkText = 1;

    let frame;
    if (works.length === 1) {
      frame = buildFrame(works[0], i, works[0].link || p.link, p.linkText || works[0].link || p.link);
    } else {
      // A grid: each piece with its own small label beneath it, up to
      // "perRow" pieces per row (default 3). A shorter last row is centered:
      // every piece spans two half-columns, so it can shift by half a slot.
      const perRow = Math.min(works.length, p.perRow || 3);
      const rows = Math.ceil(works.length / perRow);
      frame = el("div", "painting-row");
      frame.style.setProperty("--cols", perRow);
      frame.style.setProperty("--rows", rows);
      works.forEach((w, j) => {
        const r = Math.floor(j / perRow);
        const inRow = Math.min(perRow, works.length - r * perRow);
        const col = (j % perRow) * 2 + 1 + (perRow - inRow);
        const place = (node, row) => {
          node.style.setProperty("--j", j % perRow);
          node.style.gridColumn = `${col} / span 2`;
          node.style.gridRow = row;
        };
        // Each piece may link somewhere of its own (e.g. the firm's website).
        const f = buildFrame(w, i, w.link || p.link, w.caption || w.linkText || p.linkText || w.link || p.link);
        place(f, r * 2 + 1);
        frame.appendChild(f);
        if (w.caption || w.dates || w.subcaption) {
          // Role, then its dates on their own line, then the organization.
          const cap = el("div", "piece-label");
          place(cap, r * 2 + 2);
          if (w.caption) cap.appendChild(el("p", "piece-title", w.caption));
          if (w.dates) cap.appendChild(el("p", "piece-dates", w.dates));
          if (w.subcaption) cap.appendChild(el("p", "piece-sub", w.subcaption));
          frame.appendChild(cap);
        }
      });
    }

    const placard = el("aside", "placard");
    if (kind === "projects") {
      if (p.linkColor) placard.style.setProperty("--link-color", p.linkColor);
      if (p.description) placard.appendChild(el("p", "description", p.description));
      if (p.link) {
        const link = el("a", "link", p.linkText || p.link.replace(/^https?:\/\/(www\.)?/, ""));
        link.href = p.link;
        link.target = "_blank";
        link.rel = "noopener";
        placard.appendChild(link);
      }
    } else {
      if (p.jobTitle) placard.appendChild(el("p", "description", p.jobTitle));
      if (p.dateRange) placard.appendChild(el("p", "dates", p.dateRange));
    }

    // "Sergio Cervantes, October 17, 2024"; for a group by one artist, the span
    // of dates ("…, December 22, 2023 – March 8, 2026") so it stays one line.
    const sameArtist = described.every((d) => d.artist === described[0].artist);
    let creditText;
    if (described.length === 1) creditText = `${described[0].artist}, ${described[0].title}`;
    else if (sameArtist) {
      const dated = works
        .map((w, k) => [manifest[w.image]?.date, described[k].title])
        .filter(([d]) => d)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      creditText = dated.length > 1
        ? `${described[0].artist}, ${dated[0][1]} – ${dated[dated.length - 1][1]}`
        : `${described[0].artist}, ${described.map((d) => d.title).join(" · ")}`;
    } else creditText = described.map((d) => `${d.artist}, ${d.title}`).join(" · ");
    const credit = el("div", "credit", creditText);

    room.append(frame, placard, credit);
    return room;
  }

  projects.forEach((p, i) => wingEls.projects.appendChild(buildRoom(p, i, "projects")));
  timeline.forEach((p, i) => wingEls.timeline.appendChild(buildRoom(p, i, "timeline")));

  // ---------- Parallax (per wing, each wing scrolls on its own) ----------

  function updateWing(wing) {
    const vh = wing.clientHeight;
    for (const room of wing.children) {
      const r = room.getBoundingClientRect();
      if (r.bottom < -vh || r.top > 2 * vh) continue;
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
      room.style.setProperty("--p", p.toFixed(4));
      room.style.setProperty("--ap", Math.abs(p).toFixed(4));
    }
  }

  // ---------- Wall color follows the scroll ----------

  let active = "projects";
  let switchFrom = null; // { top, bottom, mid } in linear light, captured when changing wings
  let switchStart = 0;
  const SWITCH_MS = 1400;
  let last = null;

  // Neighboring rooms and the blend between them at fractional position f
  // (0 = first room centered).
  function between(wing, f) {
    const rooms = wing.children;
    const n = rooms.length - 1;
    f = Math.max(0, Math.min(n, f));
    const i = Math.floor(f);
    return [rooms[i], rooms[Math.min(n, i + 1)], f - i];
  }

  function colorAt(wing, f) {
    if (!wing.children.length) return lin(FALLBACK_COLOR);
    const [a, b, t] = between(wing, f);
    return mixLin(a._color, b._color, t);
  }

  // The wall is a vertical gradient: what's above you, here, and what's coming.
  function wallFor(name) {
    const wing = wingEls[name];
    const f = wing.scrollTop / (wing.clientHeight || 1);
    let text = 1;
    if (wing.children.length) {
      const [a, b, t] = between(wing, f);
      text = a._darkText + (b._darkText - a._darkText) * smoothstep(0.3, 0.7, t);
    }
    return { top: colorAt(wing, f - 0.35), mid: colorAt(wing, f), bottom: colorAt(wing, f + 0.35), text };
  }

  function paintWall() {
    let wall = wallFor(active);
    const now = performance.now();
    let animating = false;
    if (switchFrom) {
      const t = (now - switchStart) / SWITCH_MS;
      if (t >= 1) switchFrom = null;
      else {
        const e = ease(t);
        wall = {
          top: mixLin(switchFrom.top, wall.top, e),
          mid: mixLin(switchFrom.mid, wall.mid, e),
          bottom: mixLin(switchFrom.bottom, wall.bottom, e),
          text: switchFrom.text + (wall.text - switchFrom.text) * e,
        };
        animating = true;
      }
    }
    last = wall;

    root.style.setProperty("--bg-top", css(wall.top));
    root.style.setProperty("--bg", css(wall.mid));
    root.style.setProperty("--bg-bottom", css(wall.bottom));

    for (const k of ["ink", "soft", "faint", "credit"]) {
      root.style.setProperty(k === "ink" ? "--ink" : `--ink-${k}`, rgba(INK.light[k], INK.dark[k], wall.text));
    }
    return animating;
  }

  let framePending = false;
  function frame() {
    framePending = false;
    const animating = paintWall();
    if (animating) request();
  }
  function request() {
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(frame);
    }
  }

  // ---------- "Skip to Graduation" ----------

  const skip = document.getElementById("skip-graduation");
  const gradRoom = wingEls.timeline.querySelector('[data-anchor="graduation"]');

  function updateSkip() {
    if (!gradRoom) {
      skip.classList.remove("visible");
      skip.inert = true;
      return;
    }
    const wing = wingEls.timeline;
    // Visible while the graduation room is still below the current view.
    const before = gradRoom.offsetTop - wing.scrollTop > wing.clientHeight / 2;
    skip.classList.toggle("visible", before);
    skip.inert = !before || active !== "timeline";
  }

  skip.addEventListener("click", () => {
    wingEls.timeline.scrollTo({ top: gradRoom.offsetTop, behavior: "smooth" });
  });

  for (const wing of Object.values(wingEls)) {
    let ticking = false;
    wing.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          updateWing(wing);
          if (wing === wingEls.timeline) updateSkip();
          ticking = false;
        });
        request();
      },
      { passive: true }
    );
    updateWing(wing);
  }
  window.addEventListener("resize", () => {
    Object.values(wingEls).forEach(updateWing);
    updateSkip();
    request();
  });

  // ---------- Switching wings ----------

  const toTimeline = document.getElementById("to-timeline");
  const toProjects = document.getElementById("to-projects");

  function show(name, { push = true, instant = false } = {}) {
    if (name === active && !instant) return;
    if (!instant && last) {
      switchFrom = last;
      switchStart = performance.now();
    }
    active = name;
    const atTimeline = name === "timeline";
    document.body.classList.toggle("at-timeline", atTimeline);
    wingEls.projects.inert = atTimeline;
    wingEls.timeline.inert = !atTimeline;
    toTimeline.inert = atTimeline;
    toProjects.inert = !atTimeline;
    updateSkip();
    request();
    if (push) history.replaceState(null, "", atTimeline ? "#timeline" : location.pathname);
    // Give the active wing keyboard focus so arrow/page keys scroll it.
    wingEls[name].focus({ preventScroll: true });
  }

  toTimeline.addEventListener("click", () => show("timeline"));
  toProjects.addEventListener("click", () => show("projects"));

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show("timeline");
    else if (e.key === "ArrowLeft") show("projects");
  });

  // ---------- Horizontal scroll / swipe switches wings ----------

  const go = (dir) => show(dir > 0 ? "timeline" : "projects");

  // Trackpad sideways swipe, or Shift + mouse wheel.
  let accX = 0;
  let lockedUntil = 0;
  let resetTimer;
  window.addEventListener(
    "wheel",
    (e) => {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return; // mostly vertical: let the wing scroll
      e.preventDefault(); // also stops the browser's swipe-to-go-back
      if (performance.now() < lockedUntil) return; // ignore momentum while sliding
      accX += dx;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (accX = 0), 200);
      if (Math.abs(accX) > 50) {
        const dir = Math.sign(accX);
        accX = 0;
        if ((dir > 0) !== (active === "timeline")) {
          go(dir);
          lockedUntil = performance.now() + 1500;
        }
      }
    },
    { passive: false }
  );

  // Touch: a deliberate sideways swipe.
  let tx = 0, ty = 0;
  window.addEventListener("touchstart", (e) => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(-dx);
  }, { passive: true });

  show(location.hash === "#timeline" ? "timeline" : "projects", { push: false, instant: true });
})();
