
  /* ---------- 6. Map and table screen ---------- */
  (function () {
    var frame = $("#map-frame");
    var map = $("#map");
    var hz = $("#map-hz");
    var nameEl = $("#map-name");
    var timers = new Timers();
    var st = {};
    function box(c, r, w, h) {
      return { left: (c / 16) * 100 + "%", top: (r / 8) * 100 + "%", width: (w / 16) * 100 + "%", height: (h / 8) * 100 + "%" };
    }
    function add(parent, cls, css, html) {
      var e = document.createElement("div");
      e.className = cls;
      Object.keys(css).forEach(function (k) {
        e.style[k] = css[k];
      });
      if (html) e.innerHTML = html;
      parent.appendChild(e);
      return e;
    }
    function token(parent, c, r, label, foe) {
      return add(parent, "token" + (foe ? " foe" : ""), box(c + 0.1, r + 0.1, 0.8, 0.8), label);
    }
    function sceneA() {
      var s = document.createElement("div");
      s.className = "map-scene";
      add(s, "room", box(1, 1, 7, 6));
      add(s, "room", box(8, 3, 2, 2));
      add(s, "room b", box(10, 1, 5, 6));
      add(s, "room-gap", box(7.9, 3.08, 0.3, 1.84));
      add(s, "barrel", box(1.25, 1.25, 0.6, 0.6));
      add(s, "barrel", box(1.25, 1.95, 0.6, 0.6));
      add(s, "table", box(12, 4.2, 2, 1));
      add(s, "grid", {});
      st.trap = add(s, "trap", box(8, 3, 1, 1), '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18l3-8 3 5 3-9 3 12"/></svg>');
      st.trap.hidden = true;
      st.torch = add(s, "torch", box(1.5, -1.5, 8, 8));
      st.torch.hidden = true;
      st.lyra = token(s, 3, 4, "L");
      st.borin = token(s, 5, 2, "B");
      st.goblin = token(s, 13, 2, "G", true);
      st.fog = add(s, "fog", box(9.95, 0.9, 5.2, 6.2));
      st.door = add(s, "door", box(9.92, 3.05, 0.16, 1.9));
      st.zone = add(s, "zone", box(9.5, -1.5, 8, 8));
      st.zone.hidden = true;
      add(s, "scene-tag", {}, "GOBLIN WARREN");
      st.lyraAt = [3, 4];
      return s;
    }
    function sceneB() {
      var s = document.createElement("div");
      s.className = "map-scene";
      add(s, "grass", box(0, 0, 16, 8));
      add(s, "road", box(0, 3, 16, 2));
      [[2, 1], [5, 0.5], [9, 1.2], [13, 0.8], [3, 6], [7, 6.4], [11, 5.8], [14, 6.2]].forEach(function (p) {
        add(s, "tree", box(p[0], p[1], 1.4, 1.4));
      });
      add(s, "grid", {});
      token(s, 6, 3, "L");
      token(s, 5, 4, "B");
      token(s, 4, 3, "M");
      add(s, "scene-tag", {}, "THORNWOOD ROAD");
      return s;
    }
    function build() {
      timers.clear();
      map.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      $$(".map-scene, .fx, .trail", map).forEach(function (n) {
        n.remove();
      });
      map.appendChild(sceneA());
      st.scene = "a";
      frame.classList.remove("is-tv");
      nameEl.textContent = "The map";
    }
    function ensureA() {
      if (st.scene !== "a") build();
    }
    function sq() {
      return map.clientWidth / 16;
    }
    function centre(c, r) {
      return { x: (c + 0.5) * sq(), y: (r + 0.5) * sq() };
    }

    function move() {
      ensureA();
      var path = [[3, 4], [4, 4], [5, 4], [6, 4], [7, 3]];
      if (st.lyraAt[0] !== 3) {
        Object.assign(st.lyra.style, box(3.1, 4.1, 0.8, 0.8));
        st.lyraAt = [3, 4];
      }
      var end = path[path.length - 1];
      var s = sq();
      Object.assign(st.lyra.style, box(end[0] + 0.1, end[1] + 0.1, 0.8, 0.8));
      st.lyraAt = end;
      var pts = path.map(function (p) {
        return centre(p[0], p[1]);
      });
      var lens = [0];
      for (var i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      var L = lens[lens.length - 1];
      var frames = path.map(function (p, i) {
        return { offset: lens[i] / L, transform: "translate(" + px((p[0] - end[0]) * s) + ", " + px((p[1] - end[1]) * s) + ")" };
      });
      anim(st.lyra, frames, { dur: 240, ease: EASE.settle });
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "trail");
      svg.setAttribute("viewBox", "0 0 " + map.clientWidth + " " + map.clientHeight);
      svg.setAttribute("aria-hidden", "true");
      var line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", pts.map(function (p) {
        return p.x + "," + p.y;
      }).join(" "));
      line.style.strokeDasharray = L + " " + L;
      svg.appendChild(line);
      map.appendChild(svg);
      var a = anim(line, [{ strokeDashoffset: L }, { offset: 0.55, strokeDashoffset: 0 }, { strokeDashoffset: -L }], { dur: 440, ease: "linear", fill: "both" });
      function rm() {
        svg.remove();
      }
      a.finished.then(rm, rm);
      var e = centre(end[0], end[1]);
      pop(map, { x: e.x, y: e.y, size: s * 1.3, delay: 220 });
    }
    function fog() {
      ensureA();
      var f = st.fog;
      if (f.hidden) {
        f.hidden = false;
        f.style.clipPath = "";
        fadeIn(f, { delay: 0, dur: 200 });
        return;
      }
      var b = rel(f, map);
      anim(f, [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], { dur: 340, ease: EASE.settle, fill: "forwards" }).finished.then(function () {
        f.hidden = true;
        f.getAnimations().forEach(function (x) {
          x.cancel();
        });
      });
      temp(map, "edge-v", { left: px(b.x - 1), top: px(b.y), height: px(b.h) }, [{ transform: "translateX(0)", opacity: 1 }, { offset: 0.85, opacity: 1 }, { transform: "translateX(" + px(b.w) + ")", opacity: 0 }], {
        dur: 340,
        ease: EASE.settle
      });
    }
    function door() {
      ensureA();
      var d = st.door;
      var open = d.classList.toggle("is-open");
      anim(d, [{ transform: open ? "rotate(0deg)" : "rotate(-80deg)" }, { transform: open ? "rotate(-80deg)" : "rotate(0deg)" }], { dur: 200 });
      if (open) {
        var b = rel(d, map);
        pop(map, { x: b.x + b.w / 2, y: b.y, size: sq() * 0.9, delay: 0 });
      }
    }
    function light() {
      ensureA();
      var t = st.torch;
      if (!t.hidden) {
        fadeOut(t, { dur: 200 }).finished.then(function () {
          t.hidden = true;
          t.getAnimations().forEach(function (x) {
            x.cancel();
          });
        });
        return;
      }
      t.hidden = false;
      anim(t, [{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "scale(1)" }], { dur: 280, ease: EASE.out });
      var c = centre(5, 2);
      pop(map, { x: c.x, y: c.y, size: sq() * 1.6, cls: "gold" });
    }
    function zone() {
      ensureA();
      var z = st.zone;
      if (!z.hidden) {
        fadeOut(z, { dur: 180 }).finished.then(function () {
          z.hidden = true;
          z.getAnimations().forEach(function (x) {
            x.cancel();
          });
        });
        return;
      }
      z.hidden = false;
      anim(z, [{ transform: "scale(0)", opacity: 0.6, borderColor: "rgba(0, 0, 0, 0)" }, { offset: 0.6, transform: "scale(1)", opacity: 1, borderColor: "rgba(0, 0, 0, 0)" }, { transform: "scale(1)", opacity: 1, borderColor: cssVar(z, "--zone-edge") }], {
        dur: 300,
        ease: EASE.out
      });
      var c = centre(13, 2);
      pop(map, { x: c.x, y: c.y, size: sq() * 1.6, cls: "gold" });
    }
    function trap() {
      ensureA();
      var t = st.trap;
      if (!t.hidden) {
        t.hidden = true;
        return;
      }
      var s = sq();
      temp(map, "", { left: px(8 * s), top: px(3 * s), width: px(s), height: px(s), background: "var(--trap)", zIndex: "6" }, [{ opacity: 0 }, { offset: 0.2, opacity: 0.85 }, { opacity: 0 }], {
        dur: 200,
        ease: "ease-out"
      });
      var c = centre(8, 3);
      pop(map, { x: c.x, y: c.y, size: s * 2, cls: "red" });
      t.hidden = false;
      fadeIn(t, { delay: 120, dur: 140 });
    }
    function ping() {
      ensureA();
      var c = centre(12, 5);
      var s = sq();
      temp(map, "ping-ring", { left: px(c.x - s / 2), top: px(c.y - s / 2), width: px(s), height: px(s) }, [{ transform: "scale(0.3)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }], {
        dur: 600,
        ease: EASE.out
      });
      pop(map, { x: c.x, y: c.y, size: s * 0.8, color: "var(--magenta)" });
    }
    function scene() {
      timers.clear();
      var old = $(".map-scene", map);
      var nu = st.scene === "a" ? sceneB() : sceneA();
      st.scene = st.scene === "a" ? "b" : "a";
      frame.classList.add("is-tv");
      nameEl.textContent = "The table screen";
      nu.style.zIndex = "7";
      map.appendChild(nu);
      var W = map.clientWidth;
      var H = map.clientHeight;
      var y = rel(hz, map).cy;
      anim(nu, [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { dur: 700, ease: EASE.travel }).finished.then(function () {
        if (old && old.parentNode) old.remove();
        nu.style.zIndex = "";
      });
      temp(map, "edge-v", { left: "-1px", top: "0", height: px(H), zIndex: "8" }, [{ transform: "translateX(0)", opacity: 1 }, { offset: 0.9, opacity: 1 }, { transform: "translateX(" + px(W) + ")", opacity: 0 }], {
        dur: 700,
        ease: EASE.travel
      });
      comet(map, { from: 0, to: W, y: y, delay: 0, dur: 700, maxLen: 320 });
      burst(map, { at: W - 30, y: y, delay: 660, w: 160 });
      wash(map, { at: W * 0.8, top: 0, h: H * 0.7, delay: 640, dur: 320 });
    }
    PLAY["map.move"] = move;
    PLAY["map.fog"] = fog;
    PLAY["map.door"] = door;
    PLAY["map.light"] = light;
    PLAY["map.zone"] = zone;
    PLAY["map.trap"] = trap;
    PLAY["map.ping"] = ping;
    PLAY["map.scene"] = scene;
    PLAY["map.reset"] = build;
    build();
  })();

  /* ---------- 7. Codex ---------- */
  (function () {
    var tabs = $("#cx-tabs");
    var ink = $("#cx-ink");
    var pages = $("#cx-pages");
    var badge = $("#cx-badge");
    var slot = $("#cx-slot");
    function placeInk() {
      var btn = $('[aria-selected="true"]', tabs);
      ink.style.left = btn.offsetLeft + "px";
      ink.style.width = btn.offsetWidth + "px";
    }
    function reveal() {
      slot.replaceChildren();
      var b = document.createElement("div");
      b.className = "reveal-block surface";
      b.innerHTML =
        '<div class="edge"></div><div class="rv-k"><svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>Revealed to you <span class="tag">SESSION 5</span></div><p>Grukk Twotooth keeps the Hollins reliquary under the bedrolls in the east chamber.</p>';
      slot.appendChild(b);
      var w = b.clientWidth;
      fill($(".edge", b), { origin: "0%", delay: 40, dur: 260 });
      comet(b, { from: 0, to: w, y: 0, delay: 40, dur: 260 });
      burst(b, { at: w, y: 0, delay: 270, w: 90 });
      wash(b, { at: w / 2, top: 0, h: b.clientHeight, delay: 180, dur: 300 });
      fadeIn(b, { delay: 60, dur: 200 });
      temp(b, "rv-flash", {}, [{ opacity: 0 }, { offset: 0.3, opacity: 0.12 }, { opacity: 0 }], { dur: 360, delay: 220, ease: "ease-out" });
    }
    function newPages() {
      badge.hidden = false;
      placeInk();
      var b = rel(pages, tabs);
      var y = tabs.clientHeight;
      comet(tabs, { from: 0, to: b.cx, y: y, delay: 0, dur: 230, thick: 3 });
      burst(tabs, { at: b.cx, y: y, delay: 200, w: 80, h: 8 });
      anim(badge, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }], { dur: 160, delay: 200, ease: EASE.out });
      var g = rel(badge, tabs);
      pop(tabs, { x: g.cx, y: g.cy, size: 54, delay: 200 });
    }
    function reset() {
      slot.replaceChildren();
      badge.hidden = true;
      placeInk();
    }
    PLAY["cx.reveal"] = reveal;
    PLAY["cx.new"] = function () {
      badge.hidden = true;
      requestAnimationFrame(newPages);
    };
    PLAY["cx.reset"] = reset;
    placeInk();
    window.addEventListener("load", placeInk);
    if (window.ResizeObserver) new ResizeObserver(placeInk).observe(tabs);
  })();

  /* ---------- 8. Character and rest ---------- */
  (function () {
    var MAX = 44;
    var LEVELS = { 7: [23000, 34000], 8: [34000, 48000] };
    var rail = $("#rs-rail");
    var left = $("#rs-left");
    var now = $("#rs-now");
    var ar = $("#rs-ar i");
    var arNote = $("#rs-ar-note");
    var insp = $("#rs-insp");
    var inspLabel = $("#rs-insp-label");
    var xpRail = $("#rs-xp-rail");
    var xpFill = $("#rs-xp-fill");
    var xpNum = $("#rs-xp-num");
    var lvlBox = $("#rs-lvl");
    var lvlNum = $("#rs-lvl-num");
    var timers = new Timers();
    var st = {};
    var TIRED = { hp: 21, slots: { 1: [1, 1, 0, 0], 2: [1, 1, 0], 3: [1, 0, 0] }, ar: true, insp: false, xp: 28400, lvl: 7 };
    function pips(level) {
      return $$('.pips.slot[data-level="' + level + '"] i');
    }
    function fmt(n) {
      return n.toLocaleString("en-US");
    }
    function frac(xp) {
      var r = LEVELS[st.lvl];
      return clamp((xp - r[0]) / (r[1] - r[0]), 0, 1);
    }
    function xpText(xp) {
      return fmt(xp) + " / " + fmt(LEVELS[st.lvl][1]);
    }
    function render() {
      left.style.setProperty("--pct", (st.hp / MAX) * 100 + "%");
      now.textContent = st.hp;
      [1, 2, 3].forEach(function (l) {
        pips(l).forEach(function (p, i) {
          p.classList.toggle("spent", !st.slots[l][i]);
        });
      });
      ar.classList.toggle("spent", !st.ar);
      arNote.textContent = st.ar ? "Once a day, short rest" : "Used today";
      insp.classList.toggle("is-on", st.insp);
      inspLabel.textContent = st.insp ? "INSPIRED" : "NONE";
      xpFill.style.setProperty("--xp", frac(st.xp));
      xpNum.textContent = xpText(st.xp);
      lvlNum.innerHTML = "<span>" + st.lvl + "</span>";
    }
    function load(s) {
      st = JSON.parse(JSON.stringify(s));
      render();
    }
    function xAt(v) {
      var w = rel($(".lb-well", rail), rail);
      return w.x + 3 + ($(".lb-well", rail).clientWidth - 4) * (v / MAX);
    }
    function relight(p, delay) {
      p.classList.remove("spent");
      warm(p, { delay: delay, dur: 160 });
      var host = p.parentElement;
      var b = rel(p, host);
      pop(host, { x: b.cx, y: b.cy, size: 34, delay: delay });
    }
    function spend() {
      timers.clear();
      var found = null;
      [1, 2, 3].some(function (l) {
        for (var i = st.slots[l].length - 1; i >= 0; i--) {
          if (st.slots[l][i]) {
            found = [l, i];
            return true;
          }
        }
        return false;
      });
      if (!found) {
        load(TIRED);
        return spend();
      }
      st.slots[found[0]][found[1]] = 0;
      var p = pips(found[0])[found[1]];
      p.classList.add("spent");
      cool(p, cssVar(p, "--party"), cssVar(p, "--pip-afterglow"));
    }
    function shortRest() {
      timers.clear();
      if (!st.ar) {
        st.ar = true;
        render();
      }
      var spent = [];
      [3, 1, 2].forEach(function (l) {
        st.slots[l].forEach(function (v, i) {
          if (!v) spent.push([l, i]);
        });
      });
      if (spent.length < 2) {
        load(TIRED);
        return shortRest();
      }
      st.ar = false;
      ar.classList.add("spent");
      arNote.textContent = "Used today";
      cool(ar, cssVar(ar, "--cyan"), cssVar(ar, "--use-afterglow"));
      // Arcane Recovery at level 7 brings back slots worth 4 levels: a 3rd and a 1st here.
      var pick = [spent.find(function (s) {
        return s[0] === 3;
      }), spent.find(function (s) {
        return s[0] === 1;
      })].filter(Boolean);
      pick.forEach(function (s, i) {
        st.slots[s[0]][s[1]] = 1;
        relight(pips(s[0])[s[1]], 160 + i * 90);
      });
    }
    function longRest() {
      timers.clear();
      var fresh = st.hp === MAX && st.ar && [1, 2, 3].every(function (l) {
        return st.slots[l].every(Boolean);
      });
      if (fresh) load(TIRED);
      var from = st.hp;
      st.hp = MAX;
      left.style.setProperty("--pct", "100%");
      anim(left, [{ clipPath: "inset(0 " + (100 - (from / MAX) * 100) + "% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { dur: 280, delay: 40, ease: EASE.travel });
      var y = rel($(".lb-well", rail), rail).y;
      comet(rail, { from: xAt(from), to: xAt(MAX), y: y, delay: 40, dur: 280, cls: "gold" });
      burst(rail, { at: xAt(MAX), y: y, delay: 300, cls: "gold" });
      countUp(now, from, MAX, { delay: 40, dur: 280 });
      var n = 0;
      [1, 2, 3].forEach(function (l) {
        st.slots[l].forEach(function (v, i) {
          if (!v) {
            st.slots[l][i] = 1;
            relight(pips(l)[i], 320 + n * 60);
            n += 1;
          }
        });
      });
      if (!st.ar) {
        st.ar = true;
        relight(ar, 320 + n * 60);
        arNote.textContent = "Once a day, short rest";
      }
    }
    function inspiration() {
      timers.clear();
      if (st.insp) {
        st.insp = false;
        drain($("#rs-insp-line"), { origin: "100%", dur: 160 });
        insp.classList.remove("is-on");
        inspLabel.textContent = "NONE";
        return;
      }
      st.insp = true;
      insp.classList.add("is-on");
      inspLabel.textContent = "INSPIRED";
      var w = insp.clientWidth;
      comet(insp, { from: 0, to: w, y: insp.clientHeight, delay: 0, dur: 230, thick: 3, cls: "gold" });
      fill($("#rs-insp-line"), { origin: "0%", delay: 40, dur: 230 });
      fadeIn(inspLabel, { delay: 200, dur: 160 });
      var dot = $(".insp-dot", insp);
      warm(dot, { delay: 200 });
      var b = rel(dot, insp);
      pop(insp, { x: b.cx, y: b.cy, size: 40, delay: 200, cls: "gold" });
    }
    function moveXP(to, o) {
      var from = st.xp;
      var f0 = frac(from);
      var f1 = frac(to);
      st.xp = to;
      xpFill.style.setProperty("--xp", f1);
      anim(xpFill, [{ transform: "scaleX(" + f0 + ")" }, { transform: "scaleX(" + f1 + ")" }], { dur: o.dur || 280, delay: o.delay || 0, ease: EASE.travel });
      var w = xpRail.clientWidth;
      comet(xpRail, { from: f0 * w, to: f1 * w, y: 0, delay: o.delay || 0, dur: o.dur || 280 });
      burst(xpRail, { at: f1 * w, y: 0, delay: (o.delay || 0) + (o.dur || 280) - 20, w: 90 });
      countUp(xpNum, from, to, { delay: o.delay || 0, dur: o.dur || 280, fmt: xpText });
    }
    function experience() {
      timers.clear();
      if (st.lvl !== 7 || st.xp > 31000) {
        st.lvl = 7;
        st.xp = 24800;
        render();
      }
      moveXP(st.xp + 2400, { delay: 40 });
    }
    function levelUp() {
      timers.clear();
      if (st.lvl !== 7) {
        st.lvl = 7;
        st.xp = 28400;
        render();
      }
      moveXP(LEVELS[7][1], { delay: 40, dur: 260 });
      timers.later(320, function () {
        st.lvl = 8;
        rollTo(lvlNum, "8");
        var b = rel(lvlBox, lvlBox);
        pop(lvlBox, { x: b.w / 2, y: b.h / 2, size: 100, cls: "gold" });
      });
      timers.later(520, function () {
        st.xp = LEVELS[8][0];
        xpFill.style.setProperty("--xp", 0);
        anim(xpFill, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { dur: 200, ease: EASE.in });
        xpNum.textContent = xpText(st.xp);
        fadeIn(xpNum, { delay: 0, dur: 160 });
      });
    }
    PLAY["rs.spend"] = spend;
    PLAY["rs.short"] = shortRest;
    PLAY["rs.long"] = longRest;
    PLAY["rs.insp"] = inspiration;
    PLAY["rs.xp"] = experience;
    PLAY["rs.level"] = levelUp;
    PLAY["rs.reset"] = function () {
      timers.clear();
      load(TIRED);
    };
    load(TIRED);
  })();

  /* ---------- 9. Connection and status ---------- */
  (function () {
    var bar = $("#st-reconnect");
    var msg = $("#st-msg");
    var line = $("#st-line");
    var loadEl = $("#st-load");
    var timers = new Timers();
    var lit = document.createElement("span");
    lit.className = "st-lit";
    line.appendChild(lit);
    var SKELETON = loadEl.innerHTML;
    function showLost(animate) {
      timers.clear();
      bar.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      bar.hidden = false;
      lit.style.transform = "scaleX(0)";
      msg.textContent = "Reconnecting to the table";
      if (animate) anim(bar, [{ opacity: 0, transform: "translateY(-100%)" }, { opacity: 1, transform: "translateY(0)" }], { dur: 220 });
    }
    function back() {
      if (bar.hidden || lit.style.transform === "scaleX(1)") showLost(false);
      timers.clear();
      var w = bar.clientWidth;
      var y = bar.clientHeight - 1;
      lit.style.transform = "scaleX(1)";
      fill(lit, { origin: "0%", delay: 40, dur: 300 });
      comet(bar, { from: 0, to: w, y: y, delay: 20, dur: 300 });
      burst(bar, { at: w, y: y, delay: 300, w: 120 });
      timers.later(240, function () {
        msg.textContent = "Back at the table";
        fadeIn(msg, { delay: 0, dur: 160 });
      });
      timers.later(2240, function () {
        drain(lit, { origin: "100%", dur: 160, fill: "forwards" });
        anim(bar, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-100%)" }], { dur: 180, delay: 120, fill: "forwards", ease: EASE.in }).finished.then(function () {
          bar.hidden = true;
          bar.getAnimations({ subtree: true }).forEach(function (x) {
            x.cancel();
          });
          lit.getAnimations().forEach(function (x) {
            x.cancel();
          });
          lit.style.transform = "scaleX(0)";
        }, function () {});
      });
    }
    function loading() {
      timers.clear();
      loadEl.innerHTML = SKELETON;
      var w = loadEl.clientWidth;
      comet(loadEl, { from: 0, to: w, y: -0.5, delay: 0, dur: 300, thick: 3 });
      burst(loadEl, { at: w, y: -0.5, delay: 280, w: 90 });
      timers.later(1000, function () {
        loadEl.innerHTML =
          '<div class="st-content"><h3>Session 5 notes</h3><p>The party reached the warren at dusk and found the east chamber barred from inside.</p><p>Borin owes Mirena a silver piece for the wager on the goblin count.</p></div>';
        fadeIn(loadEl.firstElementChild, { delay: 0, dur: 200 });
      });
    }
    PLAY["st.lost"] = function () {
      showLost(true);
    };
    PLAY["st.back"] = back;
    PLAY["st.load"] = loading;
  })();

