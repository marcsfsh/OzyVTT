
  /* ---------- The player ---------- */
  (function () {
    var bar = $("#gp-bar");
    var strip = $("#gp-strip");
    var hz = $("#gp-hz");
    var note = $("#gp-note");
    var stage = $("#gp-stage");
    var moBar = $("#mo-bar");
    var moStrip = $("#mo-strip");
    var info = $("#mo-info");
    var tagEl = $("#mo-tag");
    var timeEl = $("#mo-time");
    var btns = $("#mo-btns");
    var desc = $("#mo-desc");
    var SHORT = {
      "g-dice": "Dice",
      "g-hp": "Hit points",
      "g-map": "Map",
      "g-rest": "Character",
      "g-status": "Connection",
      "g-attack": "Attacks",
      "g-init": "Initiative",
      "g-ask": "Requests",
      "g-log": "Log",
      "g-table": "Table",
      "g-prep": "Prep",
      "g-time": "Time",
      "g-media": "Sound",
      "g-controls": "Controls"
    };
    var PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>';

    // Each panel carries its moments as a list; the dock is built from it and the list goes.
    var GROUPS = $$(".gpanel", stage).map(function (p) {
      var list = $(".moments", p);
      var moments = $$(".moment", list).map(function (li) {
        var tag = $(".tag", li);
        return {
          name: $("h3", li).textContent,
          tag: tag ? tag.textContent : "",
          tagCls: tag ? tag.className : "tag",
          time: $(".m-time", li).textContent,
          desc: $("p", li).textContent,
          actions: $$("button[data-play]", li).map(function (b) {
            return { key: b.dataset.play, label: b.textContent.trim() };
          })
        };
      });
      list.remove();
      return { id: p.id, num: p.dataset.num, name: SHORT[p.id] || p.dataset.name, note: p.dataset.note, panel: p, moments: moments };
    });
    strip.innerHTML =
      GROUPS.map(function (g, i) {
        return (
          '<button type="button" role="tab" id="gt-' + g.id + '" aria-controls="' + g.id + '" data-gi="' + i + '">' + (g.num ? '<span class="n">' + g.num + "</span>" : "") + g.name + "</button>"
        );
      }).join("") + '<span class="strip-ink" aria-hidden="true"></span>';
    GROUPS.forEach(function (g) {
      g.panel.setAttribute("aria-labelledby", "gt-" + g.id);
    });
    var gInk = $(".strip-ink", strip);
    var moInk = null;
    var gi = null;
    var mi = null;

    function gbtn(i) {
      return $('[data-gi="' + i + '"]', strip);
    }
    function mbtn(j) {
      return $('[data-mi="' + j + '"]', moStrip);
    }
    // Scroll a strip just enough to show a button, before any light is measured.
    function ensureVisible(sc, btn) {
      var pad = 32;
      var l = btn.offsetLeft;
      var r = l + btn.offsetWidth;
      if (l - pad < sc.scrollLeft) sc.scrollLeft = Math.max(0, l - pad);
      else if (r + pad > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = r + pad - sc.clientWidth;
      markEnd(sc);
    }
    function markEnd(sc) {
      sc.classList.toggle("at-end", sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2);
    }
    function placeInk(ink, btn) {
      ink.style.left = btn.offsetLeft + "px";
      ink.style.width = btn.offsetWidth + "px";
    }
    // The switch itself is a Light rail tab change: the old ink drains, a comet runs along the strip's
    // line, a burst lands and the new ink fills from the side the light arrived on.
    function railSwitch(host, sc, ink, prevBtn, nextBtn, y) {
      var dir = nextBtn.offsetLeft >= prevBtn.offsetLeft ? 1 : -1;
      var p = rel(prevBtn, host);
      var n = rel(nextBtn, host);
      var w = host.clientWidth;
      temp(sc, "strip-ink", { left: px(prevBtn.offsetLeft), width: px(prevBtn.offsetWidth), transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" }, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        dur: 130,
        ease: EASE.in
      });
      comet(host, { from: clamp(p.cx, -30, w + 30), to: n.cx, y: y, dur: 230 });
      fill(ink, { origin: dir > 0 ? "0%" : "100%" });
      burst(host, { at: n.cx, y: y, delay: 210, w: 90 });
      return n.cx;
    }

    function buildMoments(g) {
      moStrip.innerHTML =
        g.moments.map(function (m, j) {
          return '<button type="button" data-mi="' + j + '" aria-pressed="false">' + m.name + "</button>";
        }).join("") + '<span class="strip-ink" aria-hidden="true"></span>';
      moInk = $(".strip-ink", moStrip);
      moStrip.scrollLeft = 0;
      mi = null;
    }
    function selectMoment(j, animate, play) {
      var g = GROUPS[gi];
      var m = g.moments[j];
      var prev = mi;
      mi = j;
      $$("button", moStrip).forEach(function (b, k) {
        b.setAttribute("aria-pressed", k === j ? "true" : "false");
      });
      ensureVisible(moStrip, mbtn(j));
      placeInk(moInk, mbtn(j));
      tagEl.textContent = m.tag;
      tagEl.className = m.tagCls;
      timeEl.textContent = m.time;
      desc.textContent = m.desc;
      btns.innerHTML = m.actions
        .map(function (a, k) {
          return '<button type="button" class="btn ' + (k === 0 ? "primary" : "ghost") + '" data-play="' + a.key + '">' + (m.actions.length === 1 ? PLAY_ICON : "") + a.label + "</button>";
        })
        .join("");
      if (animate && prev != null && prev !== j) {
        railSwitch(moBar, moStrip, moInk, mbtn(prev), mbtn(j), moBar.clientHeight + 0.5);
        fadeIn(info, { delay: 120, dur: 170 });
      }
      if (play) PLAY[m.actions[0].key]();
    }
    function showGroup(i, animate) {
      var prev = gi;
      if (prev === i) return;
      gi = i;
      var g = GROUPS[i];
      GROUPS.forEach(function (x, j) {
        x.panel.hidden = j !== i;
        var b = gbtn(j);
        b.setAttribute("aria-selected", j === i ? "true" : "false");
        b.tabIndex = j === i ? 0 : -1;
      });
      note.textContent = g.note;
      ensureVisible(strip, gbtn(i));
      placeInk(gInk, gbtn(i));
      buildMoments(g);
      selectMoment(0, false, false);
      if (!animate || prev == null) return;
      // The address names the group with its own word, so the browser never scrolls to a panel for it.
      try {
        history.replaceState(null, "", "#play-" + g.id.replace(/^g-/, ""));
      } catch (e) {}
      var at = railSwitch(bar, strip, gInk, gbtn(prev), gbtn(i), rel(hz, bar).cy);
      wash(stage, { at: at, top: 0, h: stage.clientHeight * 0.6 });
      fadeIn(g.panel, { delay: 60, dur: 200 });
      fadeIn(info, { delay: 60, dur: 200 });
    }

    strip.addEventListener("click", function (e) {
      var b = e.target.closest("[data-gi]");
      if (b) showGroup(Number(b.dataset.gi), true);
    });
    strip.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var next = clamp(gi + (e.key === "ArrowRight" ? 1 : -1), 0, GROUPS.length - 1);
      showGroup(next, true);
      gbtn(next).focus();
    });
    moStrip.addEventListener("click", function (e) {
      var b = e.target.closest("[data-mi]");
      if (!b) return;
      var j = Number(b.dataset.mi);
      selectMoment(j, j !== mi, true);
    });
    [strip, moStrip].forEach(function (sc) {
      sc.addEventListener("scroll", function () {
        markEnd(sc);
      }, { passive: true });
    });
    function replace() {
      if (gi == null) return;
      placeInk(gInk, gbtn(gi));
      if (mi != null) placeInk(moInk, mbtn(mi));
      markEnd(strip);
      markEnd(moStrip);
    }
    if (window.ResizeObserver) new ResizeObserver(replace).observe(document.getElementById("player"));
    window.addEventListener("load", replace);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(replace);

    var start = 0;
    var hash = (location.hash || "").replace(/^#play-/, "");
    GROUPS.forEach(function (g, i) {
      if (g.id.replace(/^g-/, "") === hash) start = i;
    });
    showGroup(start, false);
  })();
