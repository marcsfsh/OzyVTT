
  /* ---------- 3. Turn flow ---------- */
  (function () {
    var order = $("#tf-order");
    var tilesEl = $("#tf-tiles");
    var vcr = $("#tf-vcr");
    var stateEl = $("#tf-state");
    var rnd = $("#tf-rnd");
    var rail = $("#tf-rail");
    var actor = $("#tf-actor");
    var lampsEl = $("#tf-lamps");
    var prompt = $("#tf-prompt");
    var timers = new Timers();
    var CAST = [
      { n: "Lyra", i: "L", init: 19, you: true },
      { n: "Goblin 1", i: "G", init: 17, foe: true },
      { n: "Borin", i: "B", init: 14 },
      { n: "Goblin 2", i: "G", init: 12, foe: true },
      { n: "Mirena", i: "M", init: 9 }
    ];
    var st = { running: true, round: 3, active: 1, prompt: false };
    var VALS = { action: "READY", bonus: "READY", reaction: "READY", move: "30 FT" };
    var OFF = { action: "USED", bonus: "USED", reaction: "USED", move: "0 FT" };

    tilesEl.innerHTML = CAST.map(function (c, i) {
      return (
        '<div class="tile' + (c.foe ? " foe" : "") + '" data-i="' + i + '"><span class="tile-face">' + c.i + '</span><span>' + c.n + ' <span class="tile-init">' + c.init + "</span></span></div>"
      );
    }).join("");
    var sun = document.createElement("span");
    sun.className = "sunframe";
    sun.setAttribute("aria-hidden", "true");
    tilesEl.appendChild(sun);
    function tile(i) {
      return $('.tile[data-i="' + i + '"]', tilesEl);
    }
    function sunPos(i) {
      var f = rel($(".tile-face", tile(i)), tilesEl);
      return { x: f.x - 4, y: f.y - 4 };
    }
    function placeSun(i) {
      var p = sunPos(i);
      sun.style.transform = "translate(" + px(p.x) + ", " + px(p.y) + ")";
    }
    function pad(n) {
      return n < 10 ? "0" + n : String(n);
    }
    function lamp(name) {
      return $('[data-lamp="' + name + '"]', lampsEl);
    }
    function setLamp(name, on) {
      var l = lamp(name);
      l.classList.toggle("is-off", !on);
      $(".lamp-val", l).textContent = on ? VALS[name] : OFF[name];
    }
    function renderActor(animate, delay) {
      var c = CAST[st.active];
      if (!st.running) actor.innerHTML = '<span class="acting-line">No encounter running</span>';
      else if (c.you) actor.innerHTML = '<span class="yourturn">YOUR TURN</span>';
      else actor.innerHTML = '<span class="acting-line"><b>' + c.n + "</b> is acting</span>";
      $$(".tile", tilesEl).forEach(function (t) {
        t.classList.toggle("is-acting", st.running && Number(t.dataset.i) === st.active);
      });
      if (!animate) return;
      fadeIn(actor.firstElementChild, { delay: delay || 0, dur: 160 });
      var yt = $(".yourturn", actor);
      if (yt) sheen(yt, { delay: (delay || 0) + 60, dur: 420 });
    }
    function lightLamp(name, delay) {
      var l = lamp(name);
      setLamp(name, true);
      var bulb = $(".bulb", l);
      warm(bulb, { delay: delay });
      var b = rel(bulb, l);
      pop(l, { x: b.cx, y: b.cy, size: 38, delay: delay, color: cssVar(l, "--lamp-c") });
    }
    function coolLamp(name, delay) {
      var l = lamp(name);
      var bulb = $(".bulb", l);
      var color = cssVar(l, "--lamp-c");
      setLamp(name, false);
      if (name === "move") anim(bulb, [{ opacity: 1 }, { opacity: 0.4 }], { dur: 240, delay: delay });
      else cool(bulb, color, cssVar(l, "--lamp-afterglow"), { delay: delay });
    }
    function relightAll(delay) {
      ["action", "bonus", "reaction", "move"].forEach(function (n, i) {
        lightLamp(n, delay + i * 60);
      });
    }
    function railY() {
      return rel(rail, order).cy;
    }
    function tileX(i) {
      return rel($(".tile-face", tile(i)), order).cx;
    }
    function vcrX() {
      return rel(vcr, order).cx;
    }
    function closePrompt(animate) {
      if (!st.prompt) return;
      st.prompt = false;
      if (!animate) {
        prompt.hidden = true;
        return;
      }
      drain($(".edge", prompt), { origin: st.promptX + "px", fill: "forwards" });
      fadeOut(prompt, { delay: 60, dur: 140 }).finished.then(function () {
        if (st.prompt) return;
        prompt.hidden = true;
        prompt.getAnimations({ subtree: true }).forEach(function (x) {
          x.cancel();
        });
      });
    }
    function render() {
      stateEl.firstChild.textContent = st.running ? "PLAY" : "STOP";
      stateEl.classList.toggle("is-stop", !st.running);
      rnd.innerHTML = "<span>" + (st.running ? pad(st.round) : "--") + "</span>";
      sun.style.opacity = st.running ? "1" : "0";
      placeSun(st.active);
      ["action", "bonus", "reaction", "move"].forEach(function (n) {
        setLamp(n, st.running);
      });
      renderActor(false);
    }

    function next() {
      if (!st.running) return start();
      timers.clear();
      closePrompt(false);
      var from = st.active;
      var to = (from + 1) % CAST.length;
      if (to === 0) return newRound();
      st.active = to;
      var a = sunPos(from);
      var b = sunPos(to);
      anim(sun, [{ transform: "translate(" + px(a.x) + ", " + px(a.y) + ")" }, { transform: "translate(" + px(b.x) + ", " + px(b.y) + ")" }], { dur: 200 });
      placeSun(to);
      comet(order, { from: tileX(from), to: tileX(to), y: railY(), delay: 0, dur: 220 });
      burst(order, { at: tileX(to), y: railY(), delay: 190 });
      renderActor(true, 120);
      relightAll(200);
    }
    function newRound() {
      timers.clear();
      var from = st.active;
      st.active = 0;
      st.round += 1;
      var a = sunPos(from);
      var b = sunPos(0);
      anim(sun, [{ transform: "translate(" + px(a.x) + ", " + px(a.y) + ")" }, { transform: "translate(" + px(b.x) + ", " + px(b.y) + ")" }], { dur: 260 });
      placeSun(0);
      comet(order, { from: tileX(from), to: vcrX(), y: railY(), delay: 0, dur: 280 });
      burst(order, { at: vcrX(), y: railY(), delay: 250 });
      rollTo(rnd, pad(st.round), { delay: 230 });
      renderActor(true, 300);
      relightAll(320);
    }
    function start() {
      timers.clear();
      closePrompt(false);
      st.running = true;
      st.round = 1;
      st.active = 0;
      stateEl.firstChild.textContent = "PLAY";
      stateEl.classList.remove("is-stop");
      fadeIn(stateEl, { delay: 0, dur: 140 });
      rollTo(rnd, "01", { delay: 40 });
      comet(order, { from: vcrX(), to: tileX(0), y: railY(), delay: 80, dur: 250 });
      burst(order, { at: tileX(0), y: railY(), delay: 300 });
      placeSun(0);
      sun.style.opacity = "1";
      var p = sunPos(0);
      anim(sun, [{ opacity: 0, transform: "translate(" + px(p.x) + ", " + px(p.y) + ") scale(0.6)" }, { opacity: 1, transform: "translate(" + px(p.x) + ", " + px(p.y) + ") scale(1)" }], { dur: 160, delay: 300 });
      renderActor(true, 320);
      ["action", "bonus", "reaction", "move"].forEach(function (n) {
        setLamp(n, false);
      });
      relightAll(340);
    }
    function end() {
      if (!st.running) {
        render();
        return;
      }
      timers.clear();
      closePrompt(true);
      var from = st.active;
      ["move", "reaction", "bonus", "action"].forEach(function (n, i) {
        coolLamp(n, i * 50);
      });
      var p = sunPos(from);
      anim(sun, [{ opacity: 1, transform: "translate(" + px(p.x) + ", " + px(p.y) + ") scale(1)" }, { opacity: 0, transform: "translate(" + px(p.x) + ", " + px(p.y) + ") scale(0.6)" }], { dur: 160, delay: 200, fill: "forwards" }).finished.then(
        function () {
          sun.getAnimations().forEach(function (x) {
            x.cancel();
          });
          sun.style.opacity = st.running ? "1" : "0";
        },
        function () {}
      );
      comet(order, { from: tileX(from), to: vcrX(), y: railY(), delay: 220, dur: 260 });
      burst(order, { at: vcrX(), y: railY(), delay: 450 });
      st.running = false;
      timers.later(440, function () {
        stateEl.firstChild.textContent = "STOP";
        stateEl.classList.add("is-stop");
        fadeIn(stateEl, { delay: 0, dur: 140 });
        rollTo(rnd, "--");
        renderActor(true, 0);
      });
    }
    function useAction() {
      if (!st.running) {
        st.running = true;
        render();
      }
      var l = lamp("action");
      if (l.classList.contains("is-off")) lightLamp("action", 0);
      else coolLamp("action", 0);
    }
    function yours() {
      if (!st.running || st.active !== 0) {
        st.running = true;
        st.active = 0;
        render();
      }
      var yt = $(".yourturn", actor);
      if (yt) sheen(yt, { delay: 0, dur: 420 });
    }
    function reaction() {
      if (st.prompt) {
        closePrompt(true);
        return;
      }
      if (!st.running) {
        st.running = true;
        render();
      }
      st.prompt = true;
      setLamp("reaction", false);
      lightLamp("reaction", 0);
      prompt.hidden = false;
      prompt.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      var panel = prompt.parentElement;
      var lx = rel($(".bulb", lamp("reaction")), panel).cx;
      var px0 = rel(prompt, panel).x;
      st.promptX = clamp(lx - px0, 12, prompt.clientWidth - 12);
      fadeIn(prompt, { delay: 60, dur: 180, y: 6 });
      fill($(".edge", prompt), { origin: st.promptX + "px", delay: 100, dur: 220 });
      burst(prompt, { at: st.promptX, y: 0, delay: 100, w: 90 });
    }
    PLAY["tf.next"] = next;
    PLAY["tf.round"] = function () {
      if (!st.running) {
        st.running = true;
      }
      closePrompt(false);
      st.active = CAST.length - 1;
      render();
      requestAnimationFrame(next);
    };
    PLAY["tf.start"] = function () {
      st.running = false;
      closePrompt(false);
      render();
      requestAnimationFrame(start);
    };
    PLAY["tf.end"] = function () {
      if (!st.running) {
        st.running = true;
        render();
      }
      requestAnimationFrame(end);
    };
    PLAY["tf.use"] = useAction;
    PLAY["tf.yours"] = yours;
    PLAY["tf.reaction"] = reaction;
    render();
    if (window.ResizeObserver)
      new ResizeObserver(function () {
        placeSun(st.active);
      }).observe(tilesEl);
  })();

  /* ---------- 4. Dice and checks ---------- */
  (function () {
    var card = $("#dc-card");
    var edge = $("#dc-edge");
    var tag = $("#dc-tag");
    var d1 = $("#dc-d1");
    var d2 = $("#dc-d2");
    var total = $("#dc-total");
    var MOD = 4;
    var call = $("#dc-call");
    var callState = $("#dc-call-state");
    var timers = new Timers();
    function r(lo, hi) {
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }
    function setDie(el, v, off) {
      $(".num", el).textContent = v;
      el.classList.toggle("is-off", !!off);
    }
    function land(dieEl, value, opts) {
      opts = opts || {};
      card.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      tag.classList.add("tag-hidden");
      var dx = rel(dieEl, card).cx;
      var tx = rel(total, card).cx;
      fadeIn(dieEl, { delay: 0, dur: 120 });
      fill(edge, { origin: dx + "px", delay: opts.delay || 0, dur: 260 });
      comet(card, { from: dx, to: tx, y: 0, delay: opts.delay || 0, dur: 230 });
      burst(card, { at: tx, y: 0, delay: (opts.delay || 0) + 200, w: opts.wide ? 240 : 110, cls: opts.cls || "" });
      countUp(total, 0, value + MOD, { delay: (opts.delay || 0) + 60, dur: 300 });
      return tx;
    }
    function roll() {
      timers.clear();
      d2.hidden = true;
      var v = r(4, 18);
      setDie(d1, v);
      $("#dc-what").textContent = "Perception";
      land(d1, v);
    }
    function nat20() {
      timers.clear();
      d2.hidden = true;
      setDie(d1, 20);
      $("#dc-what").textContent = "Perception";
      var tx = land(d1, 20, { wide: true, cls: "gold" });
      tag.textContent = "NAT 20";
      timers.later(200, function () {
        tag.classList.remove("tag-hidden");
        fadeIn(tag, { delay: 0, dur: 140 });
      });
      // The two-frame flash, as the life bar's damage flash does.
      temp(card, "", { inset: "0", background: "var(--flash)", zIndex: "19" }, [{ opacity: 0.85 }, { opacity: 0.85, offset: 0.99 }, { opacity: 0 }], { dur: 34, delay: 200, ease: "linear" });
      pop(card, { x: tx, y: rel(total, card).cy, size: 150, delay: 240, dur: 280, cls: "gold" });
    }
    function nat1() {
      timers.clear();
      d2.hidden = true;
      card.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      setDie(d1, 1);
      $("#dc-what").textContent = "Perception";
      tag.textContent = "NAT 1";
      tag.classList.add("tag-hidden");
      var dx = rel(d1, card).cx;
      var tx = rel(total, card).cx;
      fadeIn(d1, { delay: 0, dur: 120 });
      // The light goes the other way: from the total back to the die, and the edge drains after it.
      comet(card, { from: tx, to: dx, y: 0, delay: 40, dur: 230, cls: "red" });
      edge.style.transformOrigin = dx + "px 50%";
      anim(edge, [{ transform: "scaleX(1)", opacity: 1 }, { offset: 0.55, transform: "scaleX(0)", opacity: 1 }, { offset: 0.56, transform: "scaleX(1)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], { dur: 480, delay: 40, ease: "linear" });
      countUp(total, 0, 1 + MOD, { delay: 40, dur: 200 });
      anim(total, [{ opacity: 1 }, { offset: 0.4, opacity: 0.3 }, { opacity: 1 }], { dur: 380, delay: 240 });
      timers.later(240, function () {
        tag.classList.remove("tag-hidden");
        fadeIn(tag, { delay: 0, dur: 140 });
      });
    }
    function adv() {
      timers.clear();
      card.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
      tag.classList.add("tag-hidden");
      $("#dc-what").textContent = "Stealth, advantage";
      d2.hidden = false;
      var a = r(2, 9);
      var b = r(11, 19);
      var keepFirst = Math.random() < 0.5;
      var keep = keepFirst ? d1 : d2;
      var drop = keepFirst ? d2 : d1;
      setDie(keep, b);
      setDie(drop, a);
      fadeIn(d1, { delay: 0, dur: 120 });
      fadeIn(d2, { delay: 40, dur: 120 });
      var kx = rel(keep, card).cx;
      var ox = rel(drop, card).cx;
      var tx = rel(total, card).cx;
      fill(edge, { origin: ox + "px", delay: 140, dur: 220 });
      comet(card, { from: ox, to: kx, y: 0, delay: 160, dur: 200 });
      anim(drop, [{ opacity: 1 }, { opacity: 0.4 }], { dur: 200, delay: 160 });
      timers.later(360, function () {
        drop.classList.add("is-off");
      });
      burst(card, { at: kx, y: 0, delay: 330, w: 90 });
      countUp(total, 0, b + MOD, { delay: 300, dur: 260 });
      pop(card, { x: tx, y: rel(total, card).cy, size: 90, delay: 420 });
    }
    function rollCall() {
      timers.clear();
      var rows = $$("li", call);
      rows.forEach(function (li) {
        var v = $(".call-val", li);
        v.textContent = "";
        v.className = "call-val num";
      });
      callState.textContent = "Waiting on 4";
      callState.classList.remove("is-done");
      var saved = 0;
      var results = [r(6, 20), r(6, 20), r(6, 20), r(6, 20)];
      results.forEach(function (raw, i) {
        timers.later(250 + i * 380, function () {
          var li = rows[i];
          var v = $(".call-val", li);
          var tot = raw + 2;
          var ok = tot >= 13;
          if (ok) saved += 1;
          v.textContent = tot;
          v.classList.add(ok ? "ok" : "bad");
          fadeIn(v, { delay: 0, dur: 160, y: -6 });
          var b = rel(v, call);
          pop(call, { x: b.cx, y: b.cy, size: 40, cls: ok ? "cyan" : "red" });
          var left = rows.length - i - 1;
          if (left > 0) callState.textContent = "Waiting on " + left;
          else {
            var last = rel(li, call);
            comet(call, { from: last.x, to: last.r, y: last.b, delay: 80, dur: 260 });
            burst(call, { at: last.r, y: last.b, delay: 300, w: 90 });
            timers.later(300, function () {
              callState.textContent = "ALL IN, " + saved + " OF 4 SAVED";
              callState.classList.add("is-done");
              fadeIn(callState, { delay: 0, dur: 140 });
            });
          }
        });
      });
    }
    PLAY["dc.roll"] = roll;
    PLAY["dc.nat20"] = nat20;
    PLAY["dc.nat1"] = nat1;
    PLAY["dc.adv"] = adv;
    PLAY["dc.call"] = rollCall;
  })();

  /* ---------- 5. Hit points and conditions ---------- */
  (function () {
    var MAX = 44;
    var bar = $("#hp-bar");
    var railEl = $("#hp-rail");
    var left = $("#hp-left");
    var now = $("#hp-now");
    var tempTag = $("#hp-temp");
    var templine = $("#hp-templine");
    var portrait = $("#hp-portrait");
    var saves = $("#hp-saves");
    var stable = $("#hp-stable");
    var chips = $("#hp-chips");
    var timers = new Timers();
    var st = { hp: 38, temp: 0, down: false };
    function well() {
      return $(".lb-well", bar);
    }
    function xAt(v) {
      var w = rel(well(), railEl);
      return w.x + 3 + (well().clientWidth - 4) * (v / MAX);
    }
    function wellY() {
      return rel(well(), railEl).y;
    }
    function clipFor(v) {
      return "inset(0 " + (100 - (v / MAX) * 100) + "% 0 0)";
    }
    function setHP(v) {
      st.hp = v;
      left.style.setProperty("--pct", (v / MAX) * 100 + "%");
      now.textContent = v;
    }
    function moveHP(to, o) {
      var from = st.hp;
      setHP(to);
      anim(left, [{ clipPath: clipFor(from) }, { clipPath: clipFor(to) }], { dur: o.dur || 230, delay: o.delay || 0, ease: EASE.travel });
      comet(railEl, { from: xAt(from), to: xAt(to), y: wellY(), delay: o.delay || 0, dur: o.dur || 230, cls: o.cls });
      burst(railEl, { at: xAt(to), y: wellY(), delay: (o.delay || 0) + (o.dur || 230) - 20, cls: o.cls });
      countUp(now, from, to, { delay: o.delay || 0, dur: o.dur || 230 });
    }
    function resetSaves() {
      $$(".pips i", saves).forEach(function (i) {
        i.classList.remove("on");
      });
      stable.classList.add("tag-hidden");
    }
    function standUp() {
      st.down = false;
      portrait.classList.remove("is-down");
      saves.hidden = true;
      resetSaves();
    }
    function damage() {
      timers.clear();
      if (st.down || st.hp < 12) {
        standUp();
        setHP(38);
      }
      var to = Math.max(1, st.hp - 9);
      bar.classList.add("is-hit");
      timers.later(34, function () {
        bar.classList.remove("is-hit");
      });
      moveHP(to, { delay: 40, cls: "red" });
    }
    function heal() {
      timers.clear();
      if (st.down) standUp();
      if (st.hp > MAX - 7) setHP(26);
      moveHP(Math.min(MAX, st.hp + 7), { delay: 40, cls: "gold" });
    }
    function tempHP() {
      timers.clear();
      st.temp = 5;
      var w = Math.max(40, xAt(st.temp) - xAt(0));
      templine.style.width = w + "px";
      templine.style.left = xAt(0) + "px";
      fill(templine, { origin: "0%", delay: 40, dur: 230 });
      comet(railEl, { from: xAt(0), to: xAt(0) + w, y: 1.5, delay: 40, dur: 230, thick: 3, cls: "cyan" });
      burst(railEl, { at: xAt(0) + w, y: 1.5, delay: 240, w: 70, cls: "cyan" });
      tempTag.hidden = false;
      fadeIn(tempTag, { delay: 200, dur: 160 });
    }
    function down() {
      timers.clear();
      if (st.down) {
        standUp();
        setHP(14);
      }
      if (st.hp === 0) setHP(14);
      st.down = true;
      moveHP(0, { delay: 40, dur: 300, cls: "red" });
      portrait.classList.add("is-down");
      anim(portrait, [{ filter: "grayscale(0)", opacity: 1 }, { filter: "grayscale(1)", opacity: 0.45 }], { dur: 260, delay: 140 });
      saves.hidden = false;
      resetSaves();
      fadeIn(saves, { delay: 300, dur: 220, y: -4 });
    }
    function save(kind) {
      timers.clear();
      if (!st.down) {
        st.down = true;
        setHP(0);
        portrait.classList.add("is-down");
        saves.hidden = false;
      }
      var row = $('.pips[data-kind="' + kind + '"]', saves);
      var pip = $("i:not(.on)", row);
      var okRow = $('.pips[data-kind="ok"]', saves);
      var badRow = $('.pips[data-kind="bad"]', saves);
      if (!pip || $$("i.on", okRow).length === 3 || $$("i.on", badRow).length === 3) {
        resetSaves();
        pip = $("i", row);
      }
      pip.classList.add("on");
      warm(pip, { dur: 160 });
      var b = rel(pip, saves);
      pop(saves, { x: b.cx, y: b.cy, size: 40, cls: kind === "ok" ? "cyan" : "red" });
      if (kind === "ok" && $$("i.on", okRow).length === 3) {
        timers.later(160, function () {
          stable.classList.remove("tag-hidden");
          fadeIn(stable, { delay: 0, dur: 160 });
          var t = rel(stable, saves);
          burst(saves, { at: t.cx, y: t.b, delay: 0, w: 90, cls: "cyan" });
        });
      }
    }
    function condition() {
      var old = $(".chip-poison", chips);
      if (old) old.remove();
      var c = document.createElement("span");
      c.className = "chip chip-poison";
      c.textContent = "Poisoned";
      chips.appendChild(c);
      splitIn(c, { dur: 200 });
    }
    function breakConc() {
      var c = $("#hp-conc");
      if (!c || c.dataset.gone) {
        if (c) c.remove();
        c = document.createElement("span");
        c.className = "chip chip-conc";
        c.id = "hp-conc";
        c.innerHTML = 'Concentrating: Hold Person<i class="chip-line"></i>';
        chips.insertBefore(c, chips.firstChild);
        fadeIn(c, { delay: 0, dur: 120 });
        return;
      }
      c.dataset.gone = "1";
      drain($(".chip-line", c), { origin: "0%", dur: 160, fill: "forwards" });
      splitOut(c, { delay: 100, dur: 220 }).finished.then(function () {
        if (c.dataset.gone) c.remove();
      });
    }
    function reset() {
      timers.clear();
      standUp();
      setHP(38);
      st.temp = 0;
      tempTag.hidden = true;
      templine.style.width = "0";
      var p = $(".chip-poison", chips);
      if (p) p.remove();
      var c = $("#hp-conc");
      if (c) c.remove();
      c = document.createElement("span");
      c.className = "chip chip-conc";
      c.id = "hp-conc";
      c.innerHTML = 'Concentrating: Hold Person<i class="chip-line"></i>';
      chips.insertBefore(c, chips.firstChild);
    }
    PLAY["hp.damage"] = damage;
    PLAY["hp.heal"] = heal;
    PLAY["hp.temp"] = tempHP;
    PLAY["hp.down"] = down;
    PLAY["hp.saveok"] = function () {
      save("ok");
    };
    PLAY["hp.savebad"] = function () {
      save("bad");
    };
    PLAY["hp.cond"] = condition;
    PLAY["hp.conc"] = breakConc;
    PLAY["hp.reset"] = reset;
    setHP(38);
  })();
