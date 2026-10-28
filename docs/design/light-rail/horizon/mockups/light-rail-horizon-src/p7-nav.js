
  /* ---------- Anatomy ---------- */
  (function () {
    var stage = $("#ana-stage");
    var a = $("#ana-a");
    var b = $("#ana-b");
    var hz = $("#ana-hz");
    var area = $("#ana-area");
    var content = $("#ana-content");
    var head = $("#tl-head");
    var rows = $$(".tl-row");
    var timers = new Timers();
    var PHASES = { drain: [0, 130], comet: [40, 270], fill: [170, 310], burst: [210, 410], wash: [200, 460], content: [60, 260] };
    a.classList.add("is-on");

    PLAY["anatomy.play"] = function () {
      timers.clear();
      var from = a.classList.contains("is-on") ? a : b;
      var to = from === a ? b : a;
      var fx = rel(from, stage).cx;
      var tx = rel(to, stage).cx;
      var dir = tx > fx ? 1 : -1;
      var y = rel(hz, stage).cy;
      from.classList.remove("is-on");
      to.classList.add("is-on");
      drain(from.querySelector(".ul"), { origin: dir > 0 ? "100%" : "0%" });
      comet(stage, { from: fx, to: tx, y: y });
      fill(to.querySelector(".ul"), { origin: dir > 0 ? "0%" : "100%" });
      burst(stage, { at: tx, y: y, delay: 210 });
      wash(area, { at: tx, top: 0, h: area.clientHeight });
      // New content: the placeholder lines reshuffle so the fade has something to show.
      var widths = ["w40", "w60", "w75", "w90"];
      $$(".sk", content).forEach(function (s) {
        s.className = "sk " + widths[Math.floor(Math.random() * widths.length)];
      });
      fadeIn(content, { delay: 60, dur: 200 });

      // The playhead runs across the timing diagram in step with the stage.
      var track = $(".tl-track");
      var span = rel(track, $("#tl-rows")).w;
      anim(head, [{ opacity: 1, transform: "translateX(0)" }, { opacity: 1, transform: "translateX(" + span + "px)" }], { dur: 500, ease: "linear", fill: "none" });
      rows.forEach(function (r) {
        var p = PHASES[r.dataset.phase];
        timers.later(p[0], function () {
          r.classList.add("is-live");
        });
        timers.later(p[1], function () {
          r.classList.remove("is-live");
        });
      });
    };
  })();

  /* ---------- 1. Navigation ---------- */
  (function () {
    var holder = $("#nav-holder");
    var PAGES = ["sheet", "codex", "compendium"];
    var GROUPS = { sheet: ["spells", "gear", "features", "notes"], compendium: ["monsters", "spells", "items"] };
    var st = { page: "sheet", tabs: { sheet: "spells", compendium: "monsters" }, record: false, search: false };
    var root = clone("tpl-nav-app");
    holder.appendChild(root);
    var app = $(".app", root);
    var pane = $(".pane", app);
    var hz = $(".app-hz", app);
    var scrim = $(".scrim", app);
    var launcher = $(".launcher", app);
    $$(".sections button", app).forEach(function (b) {
      var ul = document.createElement("i");
      ul.className = "ul";
      b.appendChild(ul);
    });

    function view() {
      return $(".view", pane);
    }
    function placeInk(strip) {
      var ink = $(".ink", strip);
      var btn = $('[aria-selected="true"]', strip);
      if (!ink || !btn) return;
      ink.style.left = btn.offsetLeft + "px";
      ink.style.width = btn.offsetWidth + "px";
    }
    function placeInks() {
      $$(".tabs", pane).forEach(placeInk);
    }
    function fillGroup(v, group, id) {
      var host = $('.host[data-group="' + group + '"]', v);
      var strip = $('.tabs[data-group="' + group + '"]', v);
      if (!host || !strip) return null;
      var panel = group === "compendium" && id === "monsters" && st.record ? clone("tpl-record-goblin") : clone("tpl-" + group + "-" + id);
      panel.setAttribute("role", "tabpanel");
      host.replaceChildren(panel);
      $$("[role=tab]", strip).forEach(function (b) {
        var on = b.dataset.tab === id;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      return panel;
    }

    function showPage(next, animate) {
      var prev = st.page;
      var dir = PAGES.indexOf(next) >= PAGES.indexOf(prev) ? 1 : -1;
      st.page = next;
      st.record = false;
      var v = document.createElement("div");
      v.className = "view";
      v.appendChild(clone("tpl-" + next));
      var old = view();
      if (old) old.remove();
      pane.appendChild(v);
      Object.keys(GROUPS).forEach(function (g) {
        fillGroup(v, g, st.tabs[g]);
      });
      placeInks();
      var nextBtn = $('[data-page="' + next + '"]', app);
      var prevBtn = $('[data-page="' + prev + '"]', app);
      $$("[data-page]", app).forEach(function (b) {
        if (b === nextBtn) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      if (!animate || prev === next) return;
      var gx = rel(nextBtn, app).cx;
      var fx = rel(prevBtn, app).cx;
      var y = rel(hz, app).cy;
      drain($(".ul", prevBtn), { origin: dir > 0 ? "100%" : "0%" });
      comet(app, { from: fx, to: gx, y: y });
      fill($(".ul", nextBtn), { origin: dir > 0 ? "0%" : "100%" });
      burst(app, { at: gx, y: y, delay: 210 });
      wash(pane, { at: gx, top: 0, h: pane.clientHeight * 0.6 });
      fadeIn(v, { delay: 60, dur: 200 });
    }

    function showTab(group, next) {
      var v = view();
      var strip = v && $('.tabs[data-group="' + group + '"]', v);
      var prev = st.tabs[group];
      if (!strip || next === prev) return;
      var dir = GROUPS[group].indexOf(next) >= GROUPS[group].indexOf(prev) ? 1 : -1;
      var prevBtn = $('[data-tab="' + prev + '"]', strip);
      var nextBtn = $('[data-tab="' + next + '"]', strip);
      st.tabs[group] = next;
      if (group === "compendium") st.record = false;
      var p = rel(prevBtn, strip);
      var n = rel(nextBtn, strip);
      var y = strip.clientHeight;
      var panel = fillGroup(v, group, next);
      placeInk(strip);
      // The old underline drains toward the trip, as a stand-in that leaves with it.
      temp(strip, "ink", { left: px(p.x), width: px(p.w), transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" }, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        dur: 130,
        ease: EASE.in
      });
      comet(strip, { from: p.cx, to: n.cx, y: y, thick: 3, dur: 220 });
      fill($(".ink", strip), { origin: dir > 0 ? "0%" : "100%" });
      burst(strip, { at: n.cx, y: y, delay: 200, w: 70, h: 8 });
      if (panel) fadeIn(panel, { delay: 120, dur: 170 });
    }

    function openRecord(animate) {
      if (st.page !== "compendium") showPage("compendium", false);
      if (st.tabs.compendium !== "monsters") {
        st.tabs.compendium = "monsters";
        fillGroup(view(), "compendium", "monsters");
        placeInks();
      }
      if (st.record) return;
      var v = view();
      var row = $("tr.openable", v);
      var r = rel(row, v);
      st.record = true;
      if (!animate) {
        fillGroup(v, "compendium", "monsters");
        return;
      }
      comet(v, { from: r.x, to: r.r, y: r.b - 1, thick: 3, dur: 220, delay: 0 });
      burst(v, { at: r.r - 20, y: r.b - 1, delay: 170, w: 80, h: 8 });
      var host = $('.host[data-group="compendium"]', v);
      setTimeout(function () {
        var panel = fillGroup(v, "compendium", "monsters");
        wash(v, { at: v.clientWidth / 2, top: rel(host, v).y, h: 220, delay: 0, dur: 280 });
        fadeIn(panel, { delay: 0, dur: 200 });
      }, T(150));
    }
    function goBack() {
      if (!st.record) openRecord(false);
      var v = view();
      st.record = false;
      var panel = fillGroup(v, "compendium", "monsters");
      fadeIn(panel, { delay: 0, dur: 200 });
      var row = $("tr.openable", v);
      var r = rel(row, v);
      comet(v, { from: r.r, to: r.x, y: r.b - 1, thick: 3, dur: 220, delay: 100 });
      burst(v, { at: r.x + 20, y: r.b - 1, delay: 280, w: 80, h: 8 });
    }

    function openSearch() {
      if (st.search) return closeSearch();
      st.search = true;
      scrim.hidden = false;
      launcher.hidden = false;
      fadeIn(scrim, { delay: 0, dur: 160 });
      fadeIn(launcher, { delay: 0, dur: 200, y: 8 });
      var btn = $("[data-search]", app);
      var lw = launcher.clientWidth;
      var ox = clamp(rel(btn, app).cx - rel(launcher, app).x, 12, lw - 12);
      st.origin = ox;
      fill($(".edge", launcher), { origin: ox + "px", delay: 40, dur: 220 });
      burst(launcher, { at: ox, y: 0, delay: 40, w: 90 });
    }
    function closeSearch() {
      if (!st.search) return;
      st.search = false;
      drain($(".edge", launcher), { origin: st.origin + "px", fill: "forwards" });
      var a = fadeOut(launcher, { delay: 60, dur: 140 });
      var b = fadeOut(scrim, { delay: 60, dur: 140 });
      a.finished.then(function () {
        launcher.hidden = true;
        scrim.hidden = true;
        launcher.getAnimations({ subtree: true }).forEach(function (x) {
          x.cancel();
        });
        b.cancel();
      });
    }

    app.addEventListener("click", function (e) {
      var t = e.target.closest("button, tr.openable, .scrim, a");
      if (!t) return;
      if (t.tagName === "A") {
        e.preventDefault();
        return;
      }
      if (t.classList.contains("scrim")) closeSearch();
      else if (t.dataset.page) showPage(t.dataset.page, true);
      else if (t.dataset.tab) showTab(t.closest(".tabs").dataset.group, t.dataset.tab);
      else if (t.dataset.record) openRecord(true);
      else if (t.hasAttribute("data-back")) goBack();
      else if (t.hasAttribute("data-search")) openSearch();
    });
    app.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSearch();
      var row = e.target.closest && e.target.closest("tr.openable");
      if (row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openRecord(true);
      }
    });
    $$("[data-frame]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-frame]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        holder.classList.toggle("is-phone", b.dataset.frame === "phone");
        requestAnimationFrame(placeInks);
      });
    });
    if (window.ResizeObserver) new ResizeObserver(placeInks).observe(root);

    PLAY["nav.page"] = function () {
      closeSearch();
      showPage(PAGES[(PAGES.indexOf(st.page) + 1) % PAGES.length], true);
    };
    PLAY["nav.tab"] = function () {
      closeSearch();
      if (!GROUPS[st.page]) showPage("sheet", false);
      var g = st.page;
      var list = GROUPS[g];
      var next = list[(list.indexOf(st.tabs[g]) + 1) % list.length];
      requestAnimationFrame(function () {
        showTab(g, next);
      });
    };
    PLAY["nav.open"] = function () {
      closeSearch();
      if (st.page !== "compendium") showPage("compendium", false);
      if (st.tabs.compendium !== "monsters" || st.record) {
        st.tabs.compendium = "monsters";
        st.record = false;
        fillGroup(view(), "compendium", "monsters");
        placeInks();
      }
      requestAnimationFrame(function () {
        openRecord(true);
      });
    };
    PLAY["nav.back"] = function () {
      closeSearch();
      goBack();
    };
    PLAY["nav.search"] = function () {
      openSearch();
    };
    showPage("sheet", false);
    requestAnimationFrame(placeInks);
    window.addEventListener("load", placeInks);
  })();

  /* ---------- 2. Overlays ---------- */
  (function () {
    var stage = $("#ov-stage");
    var scrim = $("#ov-scrim");
    var S2 = { open: null, origin: 0, timers: new Timers() };
    var SURF = {
      dialog: { el: $("#ov-dialog"), btn: $("#ov-btn-dialog"), scrim: true },
      menu: { el: $("#ov-menu"), btn: $("#ov-btn-menu"), scrim: false },
      drawer: { el: $("#ov-drawer"), btn: $("#ov-btn-drawer"), scrim: true },
      sheet: { el: $("#ov-sheet"), btn: $("#ov-btn-sheet"), scrim: true },
      toast: { el: $("#ov-toast"), btn: null, scrim: false }
    };
    function reset(el) {
      el.getAnimations({ subtree: true }).forEach(function (x) {
        x.cancel();
      });
    }
    function hideNow() {
      S2.timers.clear();
      Object.keys(SURF).forEach(function (k) {
        SURF[k].el.hidden = true;
        reset(SURF[k].el);
      });
      scrim.hidden = true;
      reset(scrim);
      S2.open = null;
    }
    function open(kind) {
      hideNow();
      var s = SURF[kind];
      var el = s.el;
      var edge = $(".edge", el);
      S2.open = kind;
      if (s.scrim) {
        scrim.hidden = false;
        fadeIn(scrim, { delay: 0, dur: 160 });
      }
      if (kind === "menu") {
        var b = rel(s.btn, stage);
        el.hidden = false;
        var left = clamp(b.x, 8, stage.clientWidth - el.offsetWidth - 8);
        el.style.left = left + "px";
        el.style.top = b.b + 6 + "px";
      }
      el.hidden = false;
      var w = el.offsetWidth;
      var box = rel(el, stage);
      if (kind === "dialog" || kind === "menu" || kind === "sheet") {
        var ox = clamp(rel(s.btn, stage).cx - box.x, 12, w - 12);
        S2.origin = ox;
        if (kind === "sheet") anim(el, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { dur: 220 });
        else fadeIn(el, { delay: 0, dur: kind === "menu" ? 150 : 200, y: kind === "menu" ? 4 : 8 });
        fill(edge, { origin: ox + "px", delay: kind === "menu" ? 20 : 40, dur: kind === "menu" ? 160 : 220 });
        burst(el, { at: ox, y: 0, delay: kind === "menu" ? 20 : 40, w: kind === "menu" ? 70 : 100 });
      } else if (kind === "drawer") {
        S2.origin = w;
        anim(el, [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], { dur: 220 });
        comet(el, { from: w, to: 0, y: 0, delay: 40, dur: 230 });
        fill(edge, { origin: "100%", delay: 60, dur: 220 });
        burst(el, { at: 0, y: 0, delay: 240, w: 80 });
      } else if (kind === "toast") {
        S2.origin = w;
        anim(el, [{ opacity: 0, transform: "translate(-50%, 12px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { dur: 200, delay: 0 });
        comet(el, { from: 0, to: w, y: 0, delay: 40, dur: 230 });
        fill(edge, { origin: "0%", delay: 60, dur: 230 });
        burst(el, { at: w, y: 0, delay: 240, w: 70 });
        S2.timers.later(2400, function () {
          close();
        });
      }
    }
    function close() {
      var kind = S2.open;
      if (!kind) return;
      S2.timers.clear();
      var s = SURF[kind];
      var el = s.el;
      S2.open = null;
      drain($(".edge", el), { origin: S2.origin + "px", fill: "forwards", dur: 130 });
      var a;
      if (kind === "drawer") a = anim(el, [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], { dur: 180, delay: 60, fill: "forwards", ease: EASE.in });
      else if (kind === "sheet") a = anim(el, [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { dur: 180, delay: 60, fill: "forwards", ease: EASE.in });
      else if (kind === "toast") a = anim(el, [{ opacity: 1, transform: "translate(-50%, 0)" }, { opacity: 0, transform: "translate(-50%, 8px)" }], { dur: 160, delay: 120, fill: "forwards", ease: EASE.in });
      else a = fadeOut(el, { delay: 60, dur: 140 });
      if (s.scrim) fadeOut(scrim, { delay: 60, dur: 160 });
      a.finished.then(function () {
        if (S2.open) return;
        hideNow();
      });
    }
    stage.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("#ov-btn-dialog")) open("dialog");
      else if (t.closest("#ov-btn-menu")) S2.open === "menu" ? close() : open("menu");
      else if (t.closest("#ov-btn-drawer")) open("drawer");
      else if (t.closest("#ov-btn-sheet")) open("sheet");
      else if (t.closest("[data-close]") || t === scrim) close();
      else if (S2.open === "menu" && !t.closest("#ov-menu")) close();
    });
    stage.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    PLAY["ov.dialog"] = function () {
      open("dialog");
    };
    PLAY["ov.menu"] = function () {
      open("menu");
    };
    PLAY["ov.drawer"] = function () {
      open("drawer");
    };
    PLAY["ov.sheet"] = function () {
      open("sheet");
    };
    PLAY["ov.toast"] = function () {
      open("toast");
    };
    PLAY["ov.close"] = function () {
      if (S2.open) {
        close();
        return;
      }
      open("dialog");
      S2.timers.later(700, close);
    };
  })();
