
  /* ---------- Shared by groups 10 to 18 ---------- */
  // Moves elements to new places and slides each from where it was, so a reorder reads as motion.
  function flip(els, mutate, o) {
    o = o || {};
    var before = els.map(function (e) {
      return e.getBoundingClientRect();
    });
    mutate();
    els.forEach(function (e, i) {
      if (!e.isConnected) return;
      var r = e.getBoundingClientRect();
      var dx = before[i].left - r.left;
      var dy = before[i].top - r.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      anim(e, [{ transform: "translate(" + px(dx) + ", " + px(dy) + ")" }, { transform: "translate(0, 0)" }], { dur: o.dur || 240, delay: o.delay || 0, ease: EASE.settle });
    });
  }
  // Text that rises from a point and fades: damage numbers and MISS.
  function floatText(host, text, cls, x, y, o) {
    o = o || {};
    var w = o.w || 90;
    var e = spawn(host, cls, { left: px(x - w / 2), top: px(y), width: px(w) });
    e.textContent = text;
    var a = anim(
      e,
      [
        { opacity: 0, transform: "translateY(6px) scale(0.8)" },
        { offset: 0.2, opacity: 1, transform: "translateY(-6px) scale(1)" },
        { offset: 0.75, opacity: 1, transform: "translateY(-18px)" },
        { opacity: 0, transform: "translateY(-26px)" }
      ],
      { dur: o.dur || 900, delay: o.delay || 0, ease: "ease-out", fill: "both" }
    );
    function rm() {
      e.remove();
    }
    a.finished.then(rm, rm);
  }
  // A line that waits unlit lights from the left with a comet along it.
  function lightLine(host, line, o) {
    o = o || {};
    var lit = $(".wlit", line);
    line.classList.add("is-lit");
    var w = host.clientWidth;
    comet(host, { from: 0, to: w, y: 0, delay: o.delay || 0, dur: o.dur || 260 });
    fill(lit, { origin: "0%", delay: (o.delay || 0) + 20, dur: o.dur || 260 });
    burst(host, { at: w, y: 0, delay: (o.delay || 0) + (o.dur || 260) - 10, w: 90 });
  }
  // A strip switch: the old ink drains, a comet runs along the strip's line, the new ink fills.
  function stripSwitch(host, ink, prevBtn, nextBtn, y) {
    var dir = nextBtn.offsetLeft >= prevBtn.offsetLeft ? 1 : -1;
    var p = rel(prevBtn, host);
    var n = rel(nextBtn, host);
    temp(host, "strip-ink", { left: px(p.x), width: px(p.w), top: px(y - 1), bottom: "auto", transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" }, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      dur: 130,
      ease: EASE.in
    });
    comet(host, { from: p.cx, to: n.cx, y: y, dur: 230 });
    fill(ink, { origin: dir > 0 ? "0%" : "100%" });
    burst(host, { at: n.cx, y: y, delay: 210, w: 80, h: 8 });
  }
  function cancelAll(el) {
    el.getAnimations({ subtree: true }).forEach(function (a) {
      a.cancel();
    });
  }

  /* ---------- 10. Attacks and damage ---------- */
  (function () {
    var map = $("#atk-map");
    var line = $("#atk-line");
    var range = $("#atk-range");
    var from = $("#atk-from");
    var to = $("#atk-to");
    var reticle = $("#atk-reticle");
    var barLeft = $("#atk-bar-left");
    var card = $("#atk-card");
    var edge = $("#atk-edge");
    var tag = $("#atk-tag");
    var rollN = $("#atk-roll");
    var dmgN = $("#atk-dmg");
    var wait = $("#atk-wait");
    var timers = new Timers();
    var MAX = 27;
    var st = { aimed: false, held: false };
    function pts() {
      var a = rel(from, map);
      var b = rel(to, map);
      return { ax: a.cx, bx: b.cx, y: a.cy, b: b };
    }
    function layout() {
      var p = pts();
      line.style.left = px(p.ax);
      line.style.width = px(p.bx - p.ax);
      line.style.top = px(p.y);
      range.style.left = px((p.ax + p.bx) / 2);
      range.style.top = px(p.y - 30);
    }
    function aimNow() {
      st.aimed = true;
      layout();
      line.hidden = false;
      range.hidden = false;
      reticle.hidden = false;
    }
    function setTag(text, cls) {
      tag.textContent = text;
      tag.className = "tag " + (cls || "");
    }
    function clearLight() {
      $$(".fx", map).forEach(function (n) {
        n.remove();
      });
    }
    function reset() {
      timers.clear();
      cancelAll(card);
      clearLight();
      st.aimed = false;
      st.held = false;
      line.hidden = true;
      range.hidden = true;
      reticle.hidden = true;
      barLeft.style.width = "100%";
      setTag("HIT", "tag-hidden");
      rollN.textContent = "--";
      dmgN.textContent = "--";
      dmgN.classList.remove("is-held");
      wait.hidden = true;
      card.classList.remove("is-held");
    }
    function aim() {
      reset();
      aimNow();
      var p = pts();
      fill(line, { origin: "0%", delay: 0, dur: 240 });
      comet(map, { from: p.ax, to: p.bx, y: p.y, delay: 0, dur: 240, thick: 3, cls: "cyan" });
      anim(reticle, [{ opacity: 0, transform: "scale(1.7) rotate(45deg)" }, { opacity: 1, transform: "scale(1) rotate(0deg)" }], { dur: 200, delay: 170 });
      fadeIn(range, { delay: 120, dur: 160 });
    }
    // Damage arriving at the target: the burst, the number and the bar.
    function land(dmg, big, delay) {
      var p = pts();
      var b = p.b;
      pop(map, { x: b.cx, y: b.cy, size: b.w * (big ? 3.2 : 2.2), delay: delay, cls: big ? "gold" : "" });
      if (big) pop(map, { x: b.cx, y: b.cy, size: b.w * 4.4, delay: delay + 50, dur: 300, cls: "gold" });
      anim(to, [{ boxShadow: "0 0 0 6px rgba(255, 255, 255, 0.9)" }, { boxShadow: "0 0 0 0 rgba(255, 255, 255, 0)" }], { dur: 280, delay: delay });
      floatText(map, String(dmg), "atk-dmgnum" + (big ? " big" : ""), b.cx, b.y - 8, { delay: delay + 20 });
      var left = Math.max(0, MAX - dmg);
      barLeft.style.width = (left / MAX) * 100 + "%";
      anim(barLeft, [{ width: "100%" }, { width: (left / MAX) * 100 + "%" }], { dur: 260, delay: delay + 40, ease: EASE.travel });
    }
    function strike(kind) {
      timers.clear();
      cancelAll(card);
      clearLight();
      if (!st.aimed) aimNow();
      st.held = false;
      wait.hidden = true;
      card.classList.remove("is-held");
      dmgN.classList.remove("is-held");
      barLeft.style.width = "100%";
      var p = pts();
      var roll = kind === "crit" ? 27 : kind === "hit" ? 19 : 9;
      countUp(rollN, 0, roll, { dur: 220 });
      setTag("HIT", "tag-hidden");
      if (kind === "miss") {
        comet(map, { from: p.ax, to: p.ax + (p.bx - p.ax) * 0.7, y: p.y, delay: 0, dur: 220, thick: 3 });
        floatText(map, "MISS", "atk-miss", p.b.cx, p.b.y - 30, { delay: 200, dur: 1000 });
        dmgN.textContent = "--";
        edge.style.transformOrigin = "0% 50%";
        anim(edge, [{ transform: "scaleX(1)", opacity: 1 }, { offset: 0.5, transform: "scaleX(0)", opacity: 1 }, { offset: 0.51, transform: "scaleX(1)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], {
          dur: 520,
          delay: 120,
          ease: "linear"
        });
        timers.later(200, function () {
          setTag("MISS", "");
          fadeIn(tag, { delay: 0, dur: 140 });
        });
        return;
      }
      var crit = kind === "crit";
      var dmg = crit ? 22 : 11;
      comet(map, { from: p.ax, to: p.bx, y: p.y, delay: 0, dur: 230, cls: crit ? "gold" : "" });
      fill(edge, { origin: "0%", delay: 0, dur: 260 });
      land(dmg, crit, 210);
      countUp(dmgN, 0, dmg, { delay: 240, dur: 260 });
      if (crit) {
        temp(card, "", { inset: "0", background: "var(--flash)", zIndex: "19" }, [{ opacity: 0.85 }, { opacity: 0.85, offset: 0.99 }, { opacity: 0 }], { dur: 34, delay: 220, ease: "linear" });
      }
      timers.later(200, function () {
        setTag(crit ? "CRIT" : "HIT", crit ? "tag-gold" : "tag-on");
        fadeIn(tag, { delay: 0, dur: 140 });
      });
    }
    function hold() {
      timers.clear();
      if (!st.held) {
        cancelAll(card);
        clearLight();
        if (!st.aimed) aimNow();
        st.held = true;
        barLeft.style.width = "100%";
        card.classList.add("is-held");
        rollN.textContent = "19";
        dmgN.textContent = "11";
        dmgN.classList.add("is-held");
        setTag("WAIT", "tag-wait");
        fadeIn(tag, { delay: 0, dur: 140 });
        wait.hidden = false;
        fadeIn(wait, { delay: 0, dur: 160 });
        return;
      }
      st.held = false;
      card.classList.remove("is-held");
      dmgN.classList.remove("is-held");
      var w = card.clientWidth;
      comet(card, { from: 0, to: w, y: 0, delay: 0, dur: 260 });
      fill(edge, { origin: "0%", delay: 20, dur: 260 });
      burst(card, { at: w, y: 0, delay: 250, w: 90 });
      timers.later(220, function () {
        setTag("HIT", "tag-on");
        fadeIn(tag, { delay: 0, dur: 140 });
        wait.hidden = true;
      });
      var p = pts();
      comet(map, { from: p.ax, to: p.bx, y: p.y, delay: 200, dur: 230 });
      land(11, false, 410);
    }
    PLAY["atk.aim"] = aim;
    PLAY["atk.hit"] = function () {
      strike("hit");
    };
    PLAY["atk.crit"] = function () {
      strike("crit");
    };
    PLAY["atk.miss"] = function () {
      strike("miss");
    };
    PLAY["atk.hold"] = hold;
    PLAY["atk.reset"] = reset;
    if (window.ResizeObserver)
      new ResizeObserver(function () {
        if (st.aimed) layout();
      }).observe(map);
  })();

  /* ---------- 11. Initiative and the turn order ---------- */
  (function () {
    var order = $("#ini-order");
    var tilesEl = $("#ini-tiles");
    var rail = $("#ini-rail");
    var note = $("#ini-note");
    var timers = new Timers();
    var CAST = {
      lyra: { n: "Lyra", i: "L", roll: 19 },
      borin: { n: "Borin", i: "B", roll: 14 },
      mirena: { n: "Mirena", i: "M", roll: 9 },
      dragon: { n: "Red Dragon", i: "D", roll: 21, foe: true, legend: 3 },
      kobold1: { n: "Kobold 1", i: "K", roll: 12, foe: true },
      kobold2: { n: "Kobold 2", i: "K", roll: 16, foe: true }
    };
    var ROSTER = ["lyra", "borin", "mirena", "dragon", "kobold1"];
    var st = { ids: ROSTER.slice(), rolled: false };
    var sun = document.createElement("span");
    sun.className = "sunframe";
    sun.setAttribute("aria-hidden", "true");
    function tileHTML(id) {
      var c = CAST[id];
      var legend = c.legend ? '<span class="legend">' + new Array(c.legend + 1).join("<i></i>") + "</span>" : "";
      return '<div class="tile' + (c.foe ? " foe" : "") + '" data-id="' + id + '"><span class="tile-face">' + c.i + "</span><span>" + c.n + ' <span class="tile-init">' + (st.rolled ? c.roll : "--") + "</span></span>" + legend + "</div>";
    }
    function sorted(ids) {
      return ids.slice().sort(function (a, b) {
        return CAST[b].roll - CAST[a].roll;
      });
    }
    function tile(id) {
      return $('.tile[data-id="' + id + '"]', tilesEl);
    }
    function placeSun(show) {
      if (!st.rolled || !show) {
        sun.style.opacity = "0";
        return;
      }
      var f = rel($(".tile-face", tile(st.ids[0])), tilesEl);
      sun.style.opacity = "1";
      sun.style.transform = "translate(" + px(f.x - 4) + ", " + px(f.y - 4) + ")";
    }
    function render() {
      tilesEl.innerHTML = st.ids.map(tileHTML).join("");
      tilesEl.appendChild(sun);
      placeSun(true);
      note.textContent = st.rolled ? "Round 1. " + CAST[st.ids[0]].n + " goes first." : "Initiative isn't rolled yet.";
    }
    function railY() {
      return rel(rail, order).cy;
    }
    function cx(id) {
      return rel($(".tile-face", tile(id)), order).cx;
    }
    function base() {
      timers.clear();
      cancelAll(order);
      st.ids = sorted(ROSTER);
      st.rolled = true;
      render();
    }
    function roll() {
      timers.clear();
      cancelAll(order);
      st.ids = ROSTER.slice();
      st.rolled = false;
      render();
      st.ids.forEach(function (id, i) {
        timers.later(60 + i * 90, function () {
          var t = tile(id);
          var n = $(".tile-init", t);
          countUp(n, 0, CAST[id].roll, { dur: 200 });
          var b = rel(n, order);
          pop(order, { x: b.cx, y: b.cy, size: 30 });
        });
      });
      var at = 60 + st.ids.length * 90 + 160;
      timers.later(at, function () {
        st.rolled = true;
        var tiles = $$(".tile", tilesEl);
        var next = sorted(st.ids);
        flip(tiles, function () {
          next.forEach(function (id) {
            tilesEl.insertBefore(tile(id), sun);
          });
        }, { dur: 280 });
        st.ids = next;
        var first = cx(next[0]);
        var last = cx(next[next.length - 1]);
        comet(order, { from: first, to: last, y: railY(), delay: 60, dur: 300 });
        timers.later(300, function () {
          placeSun(true);
          var f = rel($(".tile-face", tile(next[0])), tilesEl);
          anim(sun, [{ opacity: 0, transform: "translate(" + px(f.x - 4) + ", " + px(f.y - 4) + ") scale(0.6)" }, { opacity: 1, transform: "translate(" + px(f.x - 4) + ", " + px(f.y - 4) + ") scale(1)" }], { dur: 160 });
          pop(order, { x: cx(next[0]), y: railY(), size: 60 });
          note.textContent = "Round 1. " + CAST[next[0]].n + " goes first.";
          fadeIn(note, { delay: 0, dur: 160 });
        });
      });
    }
    function join() {
      if (!st.rolled || st.ids.indexOf("kobold2") >= 0) base();
      var tiles = $$(".tile", tilesEl);
      var next = sorted(st.ids.concat("kobold2"));
      var holder = document.createElement("div");
      holder.innerHTML = tileHTML("kobold2");
      var nt = holder.firstChild;
      sun.style.opacity = "0";
      flip(tiles, function () {
        var after = next[next.indexOf("kobold2") + 1];
        tilesEl.insertBefore(nt, after ? tile(after) : sun);
      }, { dur: 240 });
      st.ids = next;
      anim(nt, [{ opacity: 0, transform: "scale(0.7)" }, { opacity: 1, transform: "scale(1)" }], { dur: 200, delay: 120, ease: EASE.out });
      var b = rel(nt, order);
      temp(order, "lit-line", { left: px(b.x + 6), width: px(b.w - 12), top: px(railY() - 1), transformOrigin: "50% 50%" }, [{ transform: "scaleX(0)", opacity: 1 }, { offset: 0.6, transform: "scaleX(1)", opacity: 1 }, { transform: "scaleX(1)", opacity: 0 }], {
        dur: 420,
        delay: 160
      });
      burst(order, { at: b.cx, y: railY(), delay: 300, w: 90 });
      timers.later(260, function () {
        placeSun(true);
      });
    }
    function fall() {
      if (!st.rolled || st.ids.indexOf("kobold1") < 0) base();
      var t = tile("kobold1");
      t.classList.add("is-down");
      anim($(".tile-face", t), [{ filter: "grayscale(0)", opacity: 1 }, { filter: "grayscale(1)", opacity: 0.4 }], { dur: 180 });
      var b = rel(t, order);
      temp(order, "lit-line", { left: px(b.x + 6), width: px(b.w - 12), top: px(railY() - 1), transformOrigin: "50% 50%" }, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { dur: 200, delay: 120, ease: EASE.in });
      anim(t, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.8)" }], { dur: 160, delay: 200, ease: EASE.in, fill: "forwards" });
      timers.later(360, function () {
        var rest = $$(".tile", tilesEl).filter(function (x) {
          return x !== t;
        });
        sun.style.opacity = "0";
        flip(rest, function () {
          t.remove();
        }, { dur: 240 });
        st.ids = st.ids.filter(function (id) {
          return id !== "kobold1";
        });
        timers.later(240, function () {
          placeSun(true);
        });
      });
    }
    function swap() {
      if (!st.rolled) base();
      var i = Math.max(0, st.ids.indexOf("borin"));
      if (i >= st.ids.length - 1) i = st.ids.length - 2;
      var a = st.ids[i];
      var b = st.ids[i + 1];
      var ax = cx(a);
      var bx = cx(b);
      var tiles = $$(".tile", tilesEl);
      sun.style.opacity = "0";
      flip(tiles, function () {
        tilesEl.insertBefore(tile(b), tile(a));
      }, { dur: 260 });
      st.ids[i] = b;
      st.ids[i + 1] = a;
      comet(order, { from: ax, to: bx, y: railY(), delay: 20, dur: 240 });
      comet(order, { from: bx, to: ax, y: railY(), delay: 20, dur: 240 });
      burst(order, { at: ax, y: railY(), delay: 240, w: 70 });
      burst(order, { at: bx, y: railY(), delay: 240, w: 70 });
      timers.later(270, function () {
        placeSun(true);
      });
    }
    function legend() {
      if (!st.rolled) base();
      var pips = $$(".legend i", tilesEl);
      var lit = pips.filter(function (p) {
        return !p.classList.contains("spent");
      });
      if (!lit.length) {
        pips.forEach(function (p, k) {
          p.classList.remove("spent");
          warm(p, { delay: k * 70 });
          var b = rel(p, order);
          pop(order, { x: b.cx, y: b.cy, size: 24, delay: k * 70, cls: "red" });
        });
        return;
      }
      var p = lit[0];
      p.classList.add("spent");
      cool(p, cssVar(p, "--hostile"), "0 0 12px 3px " + cssVar(p, "--red-tail"));
    }
    PLAY["ini.roll"] = roll;
    PLAY["ini.join"] = join;
    PLAY["ini.fall"] = fall;
    PLAY["ini.swap"] = swap;
    PLAY["ini.legend"] = legend;
    PLAY["ini.reset"] = function () {
      timers.clear();
      cancelAll(order);
      st.ids = ROSTER.slice();
      st.rolled = false;
      render();
    };
    render();
    if (window.ResizeObserver)
      new ResizeObserver(function () {
        placeSun(true);
      }).observe(tilesEl);
  })();

  /* ---------- 12. Requests to players ---------- */
  (function () {
    var phone = $("#ask-phone");
    var hz = $("#ask-hz");
    var sheet = $("#ask-sheet");
    var sheetEdge = $("#ask-sheet-edge");
    var total = $("#ask-total");
    var sent = $("#ask-sent");
    var rules = $("#ask-rules");
    var rulesLine = $("#ask-rules-line");
    var rulesWait = $("#ask-rules-wait");
    var rulesAnswer = $("#ask-rules-answer");
    var hold = $("#ask-hold");
    var holdLine = $("#ask-hold-line");
    var holdTag = $("#ask-hold-tag");
    var holdText = $("#ask-hold-text");
    var timers = new Timers();
    var WAITING = "Sent. The GM is holding the hit until your Shield is applied.";
    var DONE = "Applied. Your AC is 20 until the start of your next turn.";
    function closeSheet() {
      cancelAll(sheet);
      sheet.hidden = true;
      total.textContent = "--";
    }
    function save() {
      timers.clear();
      closeSheet();
      sent.hidden = true;
      var w = phone.clientWidth;
      var y = rel(hz, phone).cy;
      comet(phone, { from: 0, to: w, y: y, delay: 0, dur: 260 });
      burst(phone, { at: w, y: y, delay: 240, w: 90 });
      sheet.hidden = false;
      anim(sheet, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { dur: 220, delay: 140 });
      fill(sheetEdge, { origin: "0%", delay: 200, dur: 240 });
    }
    function answer() {
      timers.clear();
      if (sheet.hidden) {
        sheet.hidden = false;
        cancelAll(sheet);
      }
      sent.hidden = true;
      countUp(total, 0, 15, { dur: 300 });
      var b = rel(total, sheet);
      pop(sheet, { x: b.cx, y: b.cy, size: 70, delay: 260 });
      var w = sheet.clientWidth;
      comet(sheet, { from: w, to: 0, y: 0, delay: 420, dur: 230 });
      drain(sheetEdge, { origin: "0%", delay: 440, dur: 200, fill: "forwards" });
      var a = anim(sheet, [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { dur: 200, delay: 600, ease: EASE.in, fill: "forwards" });
      a.finished.then(function () {
        sheet.hidden = true;
        cancelAll(sheet);
        total.textContent = "--";
      }, function () {});
      timers.later(640, function () {
        sent.hidden = false;
        fadeIn(sent, { delay: 0, dur: 160 });
      });
      timers.later(2200, function () {
        fadeOut(sent, { dur: 200 }).finished.then(function () {
          sent.hidden = true;
          cancelAll(sent);
        }, function () {});
      });
    }
    function setWaiting() {
      holdLine.classList.remove("is-lit");
      cancelAll(hold);
      holdTag.textContent = "WAIT";
      holdTag.className = "tag tag-wait";
      holdText.textContent = WAITING;
    }
    function settle() {
      lightLine(hold, holdLine, { dur: 260 });
      timers.later(220, function () {
        holdTag.textContent = "DONE";
        holdTag.className = "tag tag-on";
        holdText.textContent = DONE;
        fadeIn(holdTag, { delay: 0, dur: 140 });
        fadeIn(holdText, { delay: 0, dur: 180 });
      });
    }
    function waitThenDone() {
      timers.clear();
      if (holdLine.classList.contains("is-lit")) {
        setWaiting();
        timers.later(500, settle);
      } else settle();
    }
    function setAsked() {
      rulesLine.classList.remove("is-lit");
      cancelAll(rules);
      rulesWait.hidden = false;
      rulesAnswer.hidden = true;
    }
    function rulesAnswered() {
      timers.clear();
      if (rulesLine.classList.contains("is-lit")) {
        setAsked();
        timers.later(500, rulesAnswered);
        return;
      }
      lightLine(rules, rulesLine, { dur: 260 });
      timers.later(200, function () {
        rulesWait.hidden = true;
        rulesAnswer.hidden = false;
        fadeIn(rulesAnswer, { delay: 0, dur: 200, y: 4 });
      });
    }
    PLAY["ask.save"] = save;
    PLAY["ask.answer"] = answer;
    PLAY["ask.wait"] = waitThenDone;
    PLAY["ask.rules"] = rulesAnswered;
    PLAY["ask.reset"] = function () {
      timers.clear();
      closeSheet();
      sent.hidden = true;
      setWaiting();
      setAsked();
    };
  })();

  /* ---------- 13. Log and chat ---------- */
  (function () {
    var tabs = $("#log-tabs");
    var ink = $("#log-ink");
    var badge = $("#log-badge");
    var list = $("#log-list");
    var input = $("#log-input");
    var timers = new Timers();
    var ENTRIES = [
      ["<b>Lyra</b> hits the bugbear with Fire Bolt", "11"],
      ["<b>Bugbear</b> misses Borin", "MISS"],
      ["<b>Borin</b> hits the bugbear with his warhammer", "9"],
      ["<b>Mirena</b> heals Lyra", "+7"],
      ["<b>Bugbear</b> hits Borin with its morningstar", "12"]
    ];
    var START = [
      ["<b>Mirena</b> casts Bless on the party", ""],
      ["<b>Kobold 1</b> misses Mirena", "MISS"],
      ["<b>Borin</b> hits Kobold 1 with his warhammer", "8"]
    ];
    var st = { n: 0, count: 2 };
    function row(e) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + e[0] + "</span>" + (e[1] ? '<span class="lg-n' + (e[1] === "MISS" ? " quiet" : "") + '">' + e[1] + "</span>" : "");
      return li;
    }
    function select(name) {
      $$("button", tabs).forEach(function (b) {
        b.setAttribute("aria-selected", b.dataset.lt === name ? "true" : "false");
      });
      var b = $('[data-lt="' + name + '"]', tabs);
      ink.style.left = b.offsetLeft + "px";
      ink.style.width = b.offsetWidth + "px";
    }
    function addTop(li, dir) {
      var old = $$("li", list);
      flip(old, function () {
        list.insertBefore(li, list.firstChild);
        var all = $$("li", list);
        if (all.length > 6) all[all.length - 1].remove();
      }, { dur: 220 });
      fadeIn(li, { delay: 80, dur: 180 });
      var r = rel(li, list);
      var a = dir > 0 ? r.x : r.r;
      var b = dir > 0 ? r.r : r.x;
      comet(list, { from: a, to: b, y: r.b, delay: 100, dur: 240, thick: 3 });
      burst(list, { at: b, y: r.b, delay: 320, w: 70, h: 8 });
    }
    function entry() {
      timers.clear();
      select("log");
      addTop(row(ENTRIES[st.n % ENTRIES.length]), 1);
      st.n += 1;
    }
    function count() {
      timers.clear();
      select("fight");
      var f = rel($('[data-lt="fight"]', tabs), tabs);
      var l = rel($('[data-lt="log"]', tabs), tabs);
      var y = tabs.clientHeight;
      comet(tabs, { from: f.cx, to: l.cx, y: y, delay: 0, dur: 230, thick: 3 });
      burst(tabs, { at: l.cx, y: y, delay: 210, w: 80, h: 8 });
      st.count += 1;
      rollTo(badge, String(st.count), { delay: 200 });
      var g = rel(badge, tabs);
      pop(tabs, { x: g.cx, y: g.cy, size: 44, delay: 220 });
    }
    function send() {
      timers.clear();
      select("log");
      input.textContent = "Borin, hold the door";
      input.classList.remove("is-empty");
      fadeOut(input, { dur: 120 }).finished.then(function () {
        cancelAll(input);
        input.textContent = "Message the table";
        input.classList.add("is-empty");
      }, function () {});
      addTop(row(["<b>You</b>: Borin, hold the door", ""]), -1);
      timers.later(1600, function () {
        input.textContent = "Borin, hold the door";
        input.classList.remove("is-empty");
      });
    }
    function reset() {
      timers.clear();
      cancelAll(list);
      list.innerHTML = "";
      START.forEach(function (e) {
        list.appendChild(row(e));
      });
      st.count = 2;
      badge.innerHTML = "<span>2</span>";
      input.textContent = "Borin, hold the door";
      input.classList.remove("is-empty");
      select("log");
    }
    PLAY["log.entry"] = entry;
    PLAY["log.count"] = count;
    PLAY["log.send"] = send;
    PLAY["log.reset"] = reset;
    reset();
    if (window.ResizeObserver)
      new ResizeObserver(function () {
        var b = $('[aria-selected="true"]', tabs);
        if (b) select(b.dataset.lt);
      }).observe(tabs);
  })();

  /* ---------- 14. The table and its people ---------- */
  (function () {
    var people = $("#tbl-people");
    var screen = $(".tbl-screen");
    var lamp = $("#tbl-lamp");
    var state = $("#tbl-state");
    var preview = $("#tbl-preview");
    var view = $("#tbl-view");
    var hz = $("#tbl-hz");
    var claim = $("#tbl-claim");
    var st = { on: true, spot: 0 };
    var SPOTS = ["translate(0%, 0%)", "translate(-34%, -30%)"];
    function pres(p) {
      return $('[data-p="' + p + '"]', people);
    }
    function lightUp(el) {
      el.classList.remove("is-off");
      anim(el, [{ opacity: 0.35 }, { opacity: 1 }], { dur: 200 });
      fill($(".pres-line", el), { origin: "50%", delay: 40, dur: 200 });
      var b = rel(el, people);
      pop(people, { x: b.cx, y: b.b + 5, size: 44, delay: 120 });
    }
    function coolDown(el) {
      el.classList.add("is-off");
      cool(el, cssVar(el, "--void"), "0 0 14px 3px " + cssVar(el, "--cyan-tail"), { dur: 320 });
      anim(el, [{ opacity: 1 }, { offset: 0.3, opacity: 1 }, { opacity: 0.35 }], { dur: 320 });
      drain($(".pres-line", el), { origin: "50%", dur: 200 });
    }
    function join() {
      var m = pres("mirena");
      if (!m.classList.contains("is-off")) {
        m.classList.add("is-off");
        cancelAll(m);
      }
      lightUp(m);
    }
    function drop() {
      var b = pres("borin");
      if (b.classList.contains("is-off")) {
        b.classList.remove("is-off");
        cancelAll(b);
      }
      coolDown(b);
      setTimeout(function () {
        if (b.classList.contains("is-off")) {
          b.classList.remove("is-off");
          lightUp(b);
        }
      }, T(2400));
    }
    function toggleScreen() {
      st.on = !st.on;
      cancelAll(preview);
      if (st.on) {
        screen.classList.remove("is-off");
        preview.classList.remove("is-off");
        warm(lamp, {});
        var l = rel(lamp, screen);
        pop(screen, { x: l.cx, y: l.cy, size: 40, color: cssVar(lamp, "--cyan") });
        rollTo(state, "ON");
        var w = preview.clientWidth;
        comet(preview, { from: 0, to: w, y: 1, delay: 40, dur: 260 });
        fill(hz, { origin: "0%", delay: 60, dur: 260 });
        anim(view, [{ opacity: 0.15 }, { opacity: 1 }], { dur: 220, delay: 120 });
      } else {
        screen.classList.add("is-off");
        cool(lamp, cssVar(lamp, "--cyan"), cssVar(lamp, "--glow-lamp-reaction"));
        rollTo(state, "OFF");
        drain(hz, { origin: "100%", dur: 200 });
        anim(view, [{ opacity: 1 }, { opacity: 0.15 }], { dur: 220 });
        preview.classList.add("is-off");
      }
    }
    function follow() {
      if (!st.on) toggleScreen();
      var from = SPOTS[st.spot];
      st.spot = 1 - st.spot;
      var to = SPOTS[st.spot];
      view.style.transform = to;
      anim(view, [{ transform: from }, { transform: to }], { dur: 320, ease: EASE.travel });
      wash(preview, { at: preview.clientWidth / 2, top: 0, h: preview.clientHeight, delay: 300, dur: 280 });
    }
    function claimLyra() {
      var cards = $$(".claim-card", claim);
      cards.forEach(function (c) {
        c.classList.remove("is-claimed", "is-dim");
        cancelAll(c);
      });
      requestAnimationFrame(function () {
        var c = cards[0];
        c.classList.add("is-claimed");
        var w = c.clientWidth;
        fill($(".edge", c), { origin: "50%", delay: 0, dur: 220 });
        burst(c, { at: w / 2, y: 0, delay: 40, w: 90 });
        cards.slice(1).forEach(function (o) {
          o.classList.add("is-dim");
        });
      });
    }
    PLAY["tbl.join"] = join;
    PLAY["tbl.drop"] = drop;
    PLAY["tbl.screen"] = toggleScreen;
    PLAY["tbl.follow"] = follow;
    PLAY["tbl.claim"] = claimLyra;
  })();

  /* ---------- 15. Prep and building ---------- */
  (function () {
    var steps = $("#prp-steps");
    var noteEl = $("#prp-note");
    var abil = $("#prp-abil");
    var band = $("#prp-band");
    var railEl = $("#prp-rail");
    var fillEl = $("#prp-fill");
    var cells = $("#prp-cells");
    var stage = steps.parentElement;
    var timers = new Timers();
    var NAMES = ["Class", "Background", "Species", "Abilities", "Gear", "Review"];
    var ABIL = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
    var ROLLS = [8, 14, 13, 16, 12, 10];
    var st = { step: 3, f: 0.48 };
    steps.innerHTML =
      NAMES.map(function (n, i) {
        return '<button type="button" role="tab" data-s="' + i + '"><span class="tick" aria-hidden="true"></span><span class="n">' + (i + 1) + '</span><span class="lbl">' + n + "</span></button>";
      }).join("") + '<span class="ink"></span>';
    var ink = $(".ink", steps);
    abil.innerHTML = ABIL.map(function (a) {
      return '<div class="box"><dt>' + a + "</dt><dd>--</dd></div>";
    }).join("");
    function btn(i) {
      return $('[data-s="' + i + '"]', steps);
    }
    function renderSteps() {
      $$("button", steps).forEach(function (b, i) {
        b.classList.toggle("done", i < st.step);
        b.setAttribute("aria-selected", i === st.step ? "true" : "false");
      });
      ink.style.left = btn(st.step).offsetLeft + "px";
      ink.style.width = btn(st.step).offsetWidth + "px";
      noteEl.textContent = "Step " + (st.step + 1) + " of 6: " + NAMES[st.step];
    }
    function next() {
      timers.clear();
      if (st.step === NAMES.length - 1) {
        st.step = 0;
        renderSteps();
      }
      var prev = btn(st.step);
      st.step += 1;
      renderSteps();
      var y = rel(steps, stage).b - 1;
      stripSwitch(stage, ink, btn(st.step - 1), btn(st.step), y);
      var t = $(".tick", prev);
      if (t) {
        warm(t, { delay: 120 });
        var b = rel(t, stage);
        pop(stage, { x: b.cx, y: b.cy, size: 26, delay: 120, cls: "cyan" });
      }
      fadeIn(noteEl, { delay: 120, dur: 170 });
    }
    function roll() {
      timers.clear();
      var boxes = $$(".box", abil);
      boxes.forEach(function (b) {
        $("dd", b).textContent = "--";
      });
      boxes.forEach(function (b, i) {
        timers.later(i * 90, function () {
          countUp($("dd", b), 0, ROLLS[i], { dur: 200 });
          var r = rel(b, stage);
          pop(stage, { x: r.cx, y: r.cy, size: 48, delay: 120 });
        });
      });
    }
    function bandName(f) {
      return f < 0.35 ? "LOW" : f < 0.7 ? "MODERATE" : "HIGH";
    }
    function meter() {
      timers.clear();
      if (st.f > 0.7) {
        st.f = 0.48;
        fillEl.style.setProperty("--f", st.f);
        band.innerHTML = "<span>" + bandName(st.f) + "</span>";
      }
      var from = st.f;
      var to = 0.78;
      st.f = to;
      fillEl.style.setProperty("--f", to);
      anim(fillEl, [{ transform: "scaleX(" + from + ")" }, { transform: "scaleX(" + to + ")" }], { dur: 280, delay: 40, ease: EASE.travel });
      var r = rel(railEl, stage);
      var w = railEl.clientWidth;
      comet(stage, { from: r.x + from * w, to: r.x + to * w, y: r.y, delay: 40, dur: 280 });
      burst(stage, { at: r.x + 0.7 * w, y: r.y, delay: 200, w: 90, cls: "red" });
      if (bandName(from) !== bandName(to)) rollTo(band, bandName(to), { delay: 180 });
    }
    function place() {
      timers.clear();
      $$(".prp-placed", cells).forEach(function (p) {
        p.remove();
      });
      var target = $(".is-target", cells);
      var t = document.createElement("span");
      t.className = "prp-placed";
      t.textContent = "K";
      target.appendChild(t);
      anim(t, [{ opacity: 0, transform: "scale(1.35)" }, { opacity: 1, transform: "scale(1)" }], { dur: 200, ease: EASE.out });
      var b = rel(target, stage);
      pop(stage, { x: b.cx, y: b.cy, size: b.w * 1.8, delay: 120, cls: "red" });
    }
    PLAY["prp.step"] = next;
    PLAY["prp.roll"] = roll;
    PLAY["prp.meter"] = meter;
    PLAY["prp.place"] = place;
    PLAY["prp.reset"] = function () {
      timers.clear();
      cancelAll(stage);
      st.step = 3;
      st.f = 0.48;
      renderSteps();
      $$("dd", abil).forEach(function (d) {
        d.textContent = "--";
      });
      fillEl.style.setProperty("--f", st.f);
      band.innerHTML = "<span>" + bandName(st.f) + "</span>";
      $$(".prp-placed", cells).forEach(function (p) {
        p.remove();
      });
    };
    renderSteps();
    if (window.ResizeObserver) new ResizeObserver(renderSteps).observe(steps);
  })();

  /* ---------- 16. Time and survival ---------- */
  (function () {
    var effects = $("#tim-effects");
    var railEl = $("#tim-rail");
    var left = $("#tim-left");
    var now = $("#tim-now");
    var hd = $("#tim-hd");
    var exh = $("#tim-exh");
    var exhNote = $("#tim-exh-note");
    var breath = $("#tim-breath");
    var blit = $("#tim-blit");
    var timers = new Timers();
    var MAX = 44;
    var st = {};
    function load() {
      st = { hp: 21, breath: 3, exh: 0, effects: [["Mage Armor", 6], ["Longstrider", 1]] };
      effects.innerHTML = st.effects
        .map(function (e) {
          return '<span class="chip tim-eff">' + e[0] + ' <span class="roll"><span>' + e[1] + ' H</span></span></span>';
        })
        .join("");
      left.style.setProperty("--pct", (st.hp / MAX) * 100 + "%");
      now.textContent = st.hp;
      $$("i", hd).forEach(function (p) {
        p.classList.remove("spent");
      });
      $$("i", exh).forEach(function (p) {
        p.classList.remove("on");
      });
      exhNote.textContent = "None";
      breath.innerHTML = "<span>3 ROUNDS</span>";
      breath.classList.remove("is-out");
      blit.style.setProperty("--b", 1);
    }
    function pass() {
      timers.clear();
      if (!$$(".tim-eff", effects).length) load();
      $$(".tim-eff", effects).forEach(function (chip, i) {
        var e = st.effects[i];
        e[1] -= 1;
        if (e[1] <= 0) {
          splitOut(chip, { delay: 160, dur: 240 }).finished.then(function () {
            chip.remove();
          }, function () {});
        } else rollTo($(".roll", chip), e[1] + " H", { delay: 60 + i * 50 });
      });
      st.effects = st.effects.filter(function (e) {
        return e[1] > 0;
      });
    }
    function xAt(v) {
      var w = rel($(".lb-well", railEl), railEl);
      return w.x + 3 + ($(".lb-well", railEl).clientWidth - 4) * (v / MAX);
    }
    function hitDie() {
      timers.clear();
      var lit = $$("i:not(.spent)", hd);
      if (!lit.length || st.hp >= MAX - 6) {
        load();
        lit = $$("i:not(.spent)", hd);
      }
      var p = lit[lit.length - 1];
      p.classList.add("spent");
      cool(p, cssVar(p, "--cyan"), cssVar(p, "--use-afterglow"));
      var from = st.hp;
      st.hp = Math.min(MAX, st.hp + 6);
      left.style.setProperty("--pct", (st.hp / MAX) * 100 + "%");
      anim(left, [{ clipPath: "inset(0 " + (100 - (from / MAX) * 100) + "% 0 0)" }, { clipPath: "inset(0 " + (100 - (st.hp / MAX) * 100) + "% 0 0)" }], { dur: 240, delay: 120, ease: EASE.travel });
      var y = rel($(".lb-well", railEl), railEl).y;
      comet(railEl, { from: xAt(from), to: xAt(st.hp), y: y, delay: 120, dur: 240, cls: "gold" });
      burst(railEl, { at: xAt(st.hp), y: y, delay: 340, cls: "gold" });
      countUp(now, from, st.hp, { delay: 120, dur: 240 });
    }
    function exhaustion() {
      timers.clear();
      if (st.exh >= 6) {
        st.exh = 0;
        $$("i", exh).forEach(function (p) {
          p.classList.remove("on");
        });
      }
      var p = $$("i", exh)[st.exh];
      st.exh += 1;
      p.classList.add("on");
      warm(p, { dur: 160 });
      var b = rel(p, exh);
      pop(exh, { x: b.cx, y: b.cy, size: 36, cls: "red" });
      exhNote.textContent = st.exh === 6 ? "Level 6: death" : "Level " + st.exh + ": -" + st.exh * 2 + " to d20 tests, speed -" + st.exh * 5 + " ft";
      fadeIn(exhNote, { delay: 80, dur: 160 });
    }
    function holdBreath() {
      timers.clear();
      if (st.breath <= 0) {
        st.breath = 3;
        breath.classList.remove("is-out");
        breath.innerHTML = "<span>3 ROUNDS</span>";
        blit.style.setProperty("--b", 1);
        cancelAll(blit);
      }
      var from = st.breath / 3;
      st.breath -= 1;
      var to = st.breath / 3;
      blit.style.setProperty("--b", to);
      anim(blit, [{ transform: "scaleX(" + from + ")" }, { transform: "scaleX(" + to + ")" }], { dur: 220, ease: EASE.in });
      if (st.breath > 0) rollTo(breath, st.breath + (st.breath === 1 ? " ROUND" : " ROUNDS"));
      else {
        rollTo(breath, "CHOKING");
        breath.classList.add("is-out");
      }
    }
    PLAY["tim.pass"] = pass;
    PLAY["tim.hd"] = hitDie;
    PLAY["tim.exh"] = exhaustion;
    PLAY["tim.breath"] = holdBreath;
    PLAY["tim.reset"] = function () {
      timers.clear();
      load();
    };
    load();
  })();

  /* ---------- 17. Sound and replay ---------- */
  (function () {
    var state = $("#med-state");
    var title = $("#med-title");
    var lineEl = $("#med-line");
    var lit = $("#med-lit");
    var rnd = $("#med-rnd");
    var scrub = $("#med-scrub");
    var head = $("#med-playhead");
    var TRACKS = ["Goblin warren, low drums", "Thornwood at night", "The Hollins farm fire", "Victory, short"];
    var st = { track: 0, playing: true, round: 1, p: 0.62 };
    function headX(r) {
      return ((r - 1) / 4) * scrub.clientWidth;
    }
    function placeHead() {
      head.style.transform = "translateX(" + px(headX(st.round)) + ")";
    }
    function next() {
      st.track = (st.track + 1) % TRACKS.length;
      var w = lineEl.clientWidth;
      var from = st.p;
      st.p = 0.03;
      lit.style.setProperty("--p", st.p);
      anim(lit, [{ transform: "scaleX(" + from + ")" }, { transform: "scaleX(" + st.p + ")" }], { dur: 220, ease: EASE.in });
      comet(lineEl, { from: from * w, to: 0, y: 1.5, delay: 0, dur: 220, thick: 3 });
      burst(lineEl, { at: 0, y: 1.5, delay: 200, w: 80 });
      rollTo(title, TRACKS[st.track], { delay: 120 });
      if (!st.playing) pause();
    }
    function pause() {
      st.playing = !st.playing;
      rollTo(state, st.playing ? "PLAY" : "PAUSE");
      lineEl.classList.toggle("is-paused", !st.playing);
      anim(lit, [{ opacity: st.playing ? 0.35 : 1 }, { opacity: st.playing ? 1 : 0.35 }], { dur: 200 });
    }
    function moveHead(to, o) {
      var a = headX(st.round);
      st.round = to;
      var b = headX(to);
      placeHead();
      anim(head, [{ transform: "translateX(" + px(a) + ")" }, { transform: "translateX(" + px(b) + ")" }], { dur: o.dur || 240, delay: o.delay || 0, ease: EASE.travel });
      if (Math.abs(b - a) > 4) comet(scrub, { from: a, to: b, y: 12, delay: o.delay || 0, dur: o.dur || 240, thick: 3 });
      burst(scrub, { at: b, y: 12, delay: (o.delay || 0) + (o.dur || 240) - 20, w: 70 });
      rollTo(rnd, "0" + to, { delay: o.delay || 0 });
    }
    function round() {
      moveHead(st.round >= 5 ? 1 : st.round + 1, {});
    }
    function scrubTo() {
      // A drag that ends between rounds: the playhead starts where the finger let go, then settles.
      var target = st.round >= 4 ? 2 : st.round + 2;
      var dragX = headX(target) - scrub.clientWidth * 0.09;
      head.style.transform = "translateX(" + px(dragX) + ")";
      var a = dragX;
      st.round = target;
      var b = headX(target);
      anim(head, [{ transform: "translateX(" + px(a) + ")" }, { transform: "translateX(" + px(b) + ")" }], { dur: 260, delay: 160, ease: EASE.settle });
      setTimeout(placeHead, T(430));
      burst(scrub, { at: b, y: 12, delay: 380, w: 70 });
      rollTo(rnd, "0" + target, { delay: 300 });
    }
    PLAY["med.next"] = next;
    PLAY["med.pause"] = pause;
    PLAY["med.round"] = round;
    PLAY["med.scrub"] = scrubTo;
    placeHead();
    if (window.ResizeObserver) new ResizeObserver(placeHead).observe(scrub);
  })();

  /* ---------- 18. Controls ---------- */
  (function () {
    var sw = $("#ctl-switch");
    var swFill = $("#ctl-sw-fill");
    var thumb = $("#ctl-sw-thumb");
    var checks = $("#ctl-checks");
    var field = $("#ctl-field");
    var fline = $("#ctl-fline");
    var copyLbl = $("#ctl-copy");
    var list = $("#ctl-list");
    var timers = new Timers();
    function toggleSwitch() {
      var on = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", on ? "true" : "false");
      anim(thumb, [{ transform: "translateX(" + (on ? 0 : 24) + "px)" }, { transform: "translateX(" + (on ? 24 : 0) + "px)" }], { dur: 180 });
      if (on) fill(swFill, { origin: "0%", delay: 0, dur: 180 });
      else drain(swFill, { origin: "0%", dur: 180 });
      var t = rel(sw, sw);
      pop(sw, { x: on ? t.w - 14 : 14, y: t.h / 2 - 1, size: 34, delay: 150, cls: on ? "cyan" : "" });
    }
    function check() {
      var rows = $$("li", checks);
      var next = rows.filter(function (r) {
        return !r.classList.contains("is-on");
      })[0];
      if (!next) {
        rows.forEach(function (r) {
          r.classList.remove("is-on");
        });
        next = rows[0];
      }
      next.classList.add("is-on");
      var box = $(".cbox", next);
      warm(box, { dur: 160 });
      var b = rel(box, next);
      pop(next, { x: b.cx, y: b.cy, size: 36, cls: "cyan" });
      var w = next.clientWidth;
      fill($(".row-line", next), { origin: "0%", delay: 40, dur: 220 });
      comet(next, { from: 0, to: w, y: next.clientHeight, delay: 40, dur: 220, thick: 3 });
    }
    function copy() {
      timers.clear();
      var w = field.clientWidth;
      fline.style.transform = "scaleX(1)";
      fill(fline, { origin: "0%", delay: 0, dur: 260 });
      comet(field, { from: 0, to: w, y: field.clientHeight - 1, delay: 0, dur: 260, thick: 3 });
      rollTo(copyLbl, "Copied", { delay: 120 });
      timers.later(2000, function () {
        rollTo(copyLbl, "Copy");
        drain(fline, { origin: "100%", dur: 200, fill: "forwards" }).finished.then(function () {
          fline.style.transform = "";
          cancelAll(fline);
        }, function () {});
      });
    }
    function reorder() {
      var rows = $$("li", list);
      var moved = rows[0];
      flip(rows, function () {
        list.insertBefore(moved, rows[2] ? rows[2] : null);
      }, { dur: 240 });
      anim(moved, [{ boxShadow: "0 8px 18px rgba(0, 0, 0, 0.35)" }, { boxShadow: "0 0 0 rgba(0, 0, 0, 0)" }], { dur: 260 });
      var w = moved.clientWidth;
      var lineEl = $(".row-line", moved);
      anim(lineEl, [{ transform: "scaleX(0)" }, { offset: 0.6, transform: "scaleX(1)" }, { transform: "scaleX(1)", opacity: 0 }], { dur: 520, delay: 160 });
      var g = rel($(".grip", moved), moved);
      pop(moved, { x: g.cx, y: g.cy, size: 34, delay: 200, cls: "cyan" });
      comet(moved, { from: 0, to: w, y: moved.clientHeight, delay: 160, dur: 230, thick: 3 });
    }
    sw.addEventListener("click", toggleSwitch);
    PLAY["ctl.switch"] = toggleSwitch;
    PLAY["ctl.check"] = check;
    PLAY["ctl.copy"] = copy;
    PLAY["ctl.reorder"] = reorder;
  })();
