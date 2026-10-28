(function () {
  "use strict";

  /* ---------- Core: timing, geometry and the five parts of the light ---------- */
  var S = { k: 1 };
  var EASE = {
    settle: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    travel: "cubic-bezier(0.45, 0, 0.25, 1)",
    out: "cubic-bezier(0.2, 0.7, 0.3, 1)",
    in: "cubic-bezier(0.5, 0, 0.75, 0)"
  };
  function T(ms) {
    return ms * S.k;
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function clone(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function cssVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }
  // An element's box relative to a positioned host's padding box, scroll included.
  function rel(el, host) {
    var a = host.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    var x = b.left - a.left - host.clientLeft + host.scrollLeft;
    var y = b.top - a.top - host.clientTop + host.scrollTop;
    return { x: x, y: y, w: b.width, h: b.height, cx: x + b.width / 2, cy: y + b.height / 2, r: x + b.width, b: y + b.height };
  }
  function anim(el, frames, o) {
    return el.animate(frames, {
      duration: T(o.dur),
      delay: T(o.delay || 0),
      easing: o.ease || EASE.settle,
      fill: o.fill || "backwards"
    });
  }
  function spawn(host, cls, css) {
    var e = document.createElement("span");
    e.className = "fx " + cls;
    e.setAttribute("aria-hidden", "true");
    Object.keys(css || {}).forEach(function (k) {
      if (k.indexOf("--") === 0) e.style.setProperty(k, css[k]);
      else e.style[k] = css[k];
    });
    host.appendChild(e);
    return e;
  }
  // A throwaway element that plays once and removes itself.
  function temp(host, cls, css, frames, o) {
    var e = spawn(host, cls, css);
    var a = anim(e, frames, Object.assign({ fill: "both" }, o));
    function rm() {
      e.remove();
    }
    a.finished.then(rm, rm);
    return a;
  }
  function px(n) {
    return Math.round(n * 10) / 10 + "px";
  }

  // Horizon tone: a point's colour is the horizon's colour at that fraction of the line it sits on.
  var HZ = {
    dusk: [[0, [79, 227, 255]], [0.3, [154, 92, 255]], [0.6, [255, 47, 146]], [0.85, [255, 138, 31]], [1, [255, 225, 77]]],
    dawn: [[0, [29, 106, 128]], [0.3, [106, 70, 176]], [0.6, [176, 48, 110]], [0.85, [196, 97, 15]], [1, [138, 86, 18]]]
  };
  function horizonTone() {
    var pg = document.getElementById("page");
    return pg && pg.dataset.tone === "horizon";
  }
  function isDawn() {
    var pg = document.getElementById("page");
    if (pg && pg.dataset.look) return pg.dataset.look === "dawn";
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t === "light";
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
  }
  function hz(t) {
    var stops = HZ[isDawn() ? "dawn" : "dusk"];
    t = clamp(t, 0, 1);
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1];
        var b = stops[i];
        var k = (t - a[0]) / (b[0] - a[0]);
        return "rgb(" + [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * k); }).join(", ") + ")";
      }
    }
    return "rgb(" + stops[stops.length - 1][1].join(", ") + ")";
  }
  function lineWidth(host) {
    return Math.max(1, host.clientWidth || host.getBoundingClientRect().width);
  }

  // Comet: travels from `from` to `to` along a horizontal line at `y`. Its tail stretches mid-trip and
  // shrinks into the head on arrival.
  function comet(host, o) {
    var d = o.to - o.from;
    var dir = d >= 0 ? 1 : -1;
    var len = Math.max(24, Math.min(o.maxLen || 260, Math.abs(d)));
    var th = o.thick || 4;
    var mid = o.from + d * 0.85;
    var css = { top: px(o.y - th / 2), height: px(th), width: px(len), left: px(dir > 0 ? -len : 0) };
    var hzOn = !o.cls && horizonTone();
    if (hzOn) {
      var w = lineWidth(host);
      css["--tail-a"] = hz(o.from / w);
      css["--tail-b"] = hz(o.to / w);
    }
    return temp(
      host,
      "comet " + (dir > 0 ? "face-r" : "face-l") + " " + (o.cls || "") + (hzOn ? " lr-hz" : ""),
      css,
      [
        { transform: "translateX(" + px(o.from) + ") scaleX(0)", opacity: 1 },
        { offset: 0.65, transform: "translateX(" + px(mid) + ") scaleX(1)", opacity: 1 },
        { transform: "translateX(" + px(o.to) + ") scaleX(0)", opacity: 1 }
      ],
      { dur: o.dur || 230, delay: o.delay == null ? 40 : o.delay, ease: EASE.travel }
    );
  }
  // Burst: one short flash on a line at `at`.
  function burst(host, o) {
    var w = o.w || 110;
    var h = o.h || 10;
    var css = { left: px(-w / 2), top: px(o.y - h / 2), width: px(w), height: px(h) };
    var hzOn = !o.cls && horizonTone();
    if (hzOn) css["--burst-ring"] = hz(o.at / lineWidth(host));
    return temp(
      host,
      "burst " + (o.cls || "") + (hzOn ? " lr-hz" : ""),
      css,
      [
        { opacity: 0, transform: "translateX(" + px(o.at) + ") scaleX(0.3)" },
        { offset: 0.25, opacity: 1, transform: "translateX(" + px(o.at) + ") scaleX(0.8)" },
        { opacity: 0, transform: "translateX(" + px(o.at) + ") scaleX(1.5)" }
      ],
      { dur: o.dur || 200, delay: o.delay || 0, ease: "ease-out" }
    );
  }
  // Pop: the round burst, for points that aren't on a line.
  function pop(host, o) {
    var s = o.size || 40;
    var css = { left: px(o.x - s / 2), top: px(o.y - s / 2), width: px(s), height: px(s) };
    if (o.color) css["--burst-c"] = o.color;
    var hzOn = !o.cls && !o.color && horizonTone();
    if (hzOn) css["--burst-ring"] = hz(o.x / lineWidth(host));
    return temp(host, "pop " + (o.cls || "") + (hzOn ? " lr-hz" : ""), css, [{ opacity: 0, transform: "scale(0.3)" }, { offset: 0.25, opacity: 1 }, { opacity: 0, transform: "scale(1.4)" }], {
      dur: o.dur || 220,
      delay: o.delay || 0,
      ease: "ease-out"
    });
  }
  // Wash: the line's colours falling from `top`, strongest under `at`.
  function wash(host, o) {
    var strength = parseFloat(cssVar(host, "--wash-strength")) || 0.2;
    return temp(
      host,
      "wash",
      { left: "0", right: "0", top: px(o.top || 0), height: px(o.h || 160), "--at": px(o.at) },
      [{ opacity: strength }, { opacity: 0 }],
      { dur: o.dur || 260, delay: o.delay == null ? 200 : o.delay, ease: "ease-out" }
    );
  }
  // Fill and drain work on an element that is already there, along its width.
  function fill(el, o) {
    el.style.transformOrigin = (o.origin || "50%") + " 50%";
    return anim(el, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      dur: o.dur || 140,
      delay: o.delay == null ? 170 : o.delay,
      ease: EASE.settle
    });
  }
  function drain(el, o) {
    el.style.transformOrigin = (o.origin || "50%") + " 50%";
    return anim(el, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      dur: o.dur || 130,
      delay: o.delay || 0,
      ease: EASE.in,
      fill: o.fill || "backwards"
    });
  }
  function fadeIn(el, o) {
    o = o || {};
    var from = { opacity: 0 };
    if (o.y) from.transform = "translateY(" + o.y + "px)";
    var to = { opacity: 1 };
    if (o.y) to.transform = "translateY(0)";
    return anim(el, [from, to], { dur: o.dur || 200, delay: o.delay == null ? 60 : o.delay });
  }
  function fadeOut(el, o) {
    o = o || {};
    var to = { opacity: 0 };
    if (o.y) to.transform = "translateY(" + o.y + "px)";
    return anim(el, [{ opacity: 1, transform: "translateY(0)" }, to], { dur: o.dur || 160, delay: o.delay || 0, fill: "forwards", ease: EASE.in });
  }
  function countUp(el, from, to, o) {
    o = o || {};
    var fmt = o.fmt || String;
    var token = {};
    el._count = token;
    var dur = T(o.dur || 300);
    var t0 = performance.now() + T(o.delay || 0);
    el.textContent = fmt(from);
    function step(now) {
      if (el._count !== token) return;
      if (now < t0) {
        requestAnimationFrame(step);
        return;
      }
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  // A tape counter: the old value leaves upward and the new one arrives from below.
  function rollTo(rollEl, text, o) {
    o = o || {};
    $$(".out", rollEl).forEach(function (n) {
      n.remove();
    });
    var old = rollEl.querySelector("span");
    var nu = document.createElement("span");
    nu.textContent = text;
    if (old) {
      old.classList.add("out");
      var a = anim(old, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], {
        dur: o.dur || 180,
        delay: o.delay || 0,
        ease: EASE.in,
        fill: "forwards"
      });
      a.finished.then(
        function () {
          old.remove();
        },
        function () {
          old.remove();
        }
      );
    }
    rollEl.appendChild(nu);
    anim(nu, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], {
      dur: o.dur || 180,
      delay: (o.delay || 0) + 50,
      ease: EASE.out
    });
  }
  // One sweep of the horizon's colours across an element's letters, laid over its own lettering.
  function sheen(el, o) {
    o = o || {};
    $$(".sheen-ov", el).forEach(function (n) {
      n.remove();
    });
    var text = el.textContent;
    var ov = spawn(el, "sheen-ov", {});
    ov.textContent = text;
    var a = anim(ov, [{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], { dur: o.dur || 420, delay: o.delay || 0, fill: "both" });
    function rm() {
      ov.remove();
    }
    a.finished.then(rm, rm);
  }
  // Pink and cyan split settling into register, from round one's Chroma settle.
  function splitIn(el, o) {
    o = o || {};
    var c = cssVar(el, "--split-cyan");
    var p = cssVar(el, "--split-pink");
    var c0 = cssVar(el, "--split-cyan-0");
    var p0 = cssVar(el, "--split-pink-0");
    return anim(
      el,
      [
        { opacity: 0, textShadow: "-5px 0 " + c + ", 5px 0 " + p, boxShadow: "-4px 0 0 " + c + ", 4px 0 0 " + p },
        { opacity: 1, textShadow: "0 0 " + c0 + ", 0 0 " + p0, boxShadow: "0 0 0 " + c0 + ", 0 0 0 " + p0 }
      ],
      { dur: o.dur || 200, delay: o.delay || 0 }
    );
  }
  function splitOut(el, o) {
    o = o || {};
    var c = cssVar(el, "--split-cyan");
    var p = cssVar(el, "--split-pink");
    var c0 = cssVar(el, "--split-cyan-0");
    var p0 = cssVar(el, "--split-pink-0");
    return anim(
      el,
      [
        { opacity: 1, textShadow: "0 0 " + c0 + ", 0 0 " + p0, boxShadow: "0 0 0 " + c0 + ", 0 0 0 " + p0 },
        { opacity: 0, textShadow: "-5px 0 " + c + ", 5px 0 " + p, boxShadow: "-4px 0 0 " + c + ", 4px 0 0 " + p }
      ],
      { dur: o.dur || 220, delay: o.delay || 0, fill: "forwards", ease: EASE.in }
    );
  }
  // A lamp or pip switching off: it holds its colour with a glow for a moment, then cools.
  function cool(el, color, glow, o) {
    o = o || {};
    return anim(
      el,
      [
        { backgroundColor: color, borderColor: color, boxShadow: glow },
        { offset: 0.2, backgroundColor: color, borderColor: color, boxShadow: glow },
        { backgroundColor: "rgba(0, 0, 0, 0)", boxShadow: "0 0 0 0 rgba(0, 0, 0, 0)" }
      ],
      { dur: o.dur || 320, delay: o.delay || 0, ease: "ease-out" }
    );
  }
  function warm(el, o) {
    o = o || {};
    return anim(el, [{ opacity: 0.2, transform: "scale(0.5)" }, { opacity: 1, transform: "scale(1)" }], { dur: o.dur || 150, delay: o.delay || 0, ease: EASE.out });
  }

  // Timers belong to a group so a replay can cancel the last run's pending steps.
  function Timers() {
    this.ids = [];
  }
  Timers.prototype.later = function (ms, fn) {
    var id = setTimeout(fn, T(ms));
    this.ids.push(id);
    return id;
  };
  Timers.prototype.clear = function () {
    this.ids.forEach(clearTimeout);
    this.ids = [];
  };

  var PLAY = {};
