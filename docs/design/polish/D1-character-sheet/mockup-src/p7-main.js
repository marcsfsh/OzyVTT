(function () {
  "use strict";
  var S = window.SHEET;
  var D = S.D, I = S.I, P = S.P, Q = S.Q, esc = S.esc;
  var uid = 0;
  function gid(p) { uid += 1; return p + uid; }
  function panels(g, on, list) { return list.map(function (p) { return P.panel(g, p[0], on, p[1]); }).join(""); }
  function who() { return '<div class="who3"><h2 class="sh-name">' + esc(D.name) + '</h2><p class="sh-sub">' + esc(D.sub) + "</p></div>"; }

  /* The narrow form every layout shares: the pinned band, the tabs pinned under it, then the chosen tab. */
  function narrowL(tabs, on, list, band) {
    var g = gid("n");
    return {
      html: '<div class="ln">' + (band || Q.vitals()) + '<div class="mt3">' + P.tabs(g, tabs, on) + '</div><div class="mc3">' + panels(g, on, list) + "</div></div>"
    };
  }

  /* ---------- Last round's Beyond, for comparison ---------- */
  function beyondL(narrow) {
    if (narrow) {
      var main = Q.card("", Q.abil("grid")) +
        '<div class="sts3 c3">' + Q.cell("Proficiency", Q.num(D.prof)) + Q.cell("Heroic Inspiration", Q.insp()) + Q.cell("Hit dice", Q.num("5/7", "d6")) + "</div>" +
        Q.card("Conditions and effects", Q.effects()) +
        Q.card("Saving throws", Q.saves()) + Q.card("Skills", Q.skills(1)) + Q.card("Senses", Q.senses()) + Q.card("Proficiencies and training", Q.profs());
      return narrowL([["main", "Main"], ["actions", "Actions"], ["spells", "Spells"], ["gear", "Gear"], ["features", "Features"], ["notes", "Notes"]], "main", [
        ["main", main], ["actions", Q.actions(true)], ["spells", Q.spells(true)], ["gear", Q.gear(true)], ["features", Q.features()], ["notes", Q.bio()]
      ]);
    }
    var g = gid("b");
    var top = '<div class="lb-top">' + P.port() + who() + '<div class="end">' + Q.rest() + P.more() + "</div></div>";
    var stats = '<div class="lb-stats"><div class="c3">' + Q.abil("row") + "</div>" +
      '<div class="sts3 c3">' + Q.cell("Proficiency bonus", Q.num(D.prof)) + Q.cell("Walking speed", Q.num(D.speed, "ft")) + Q.cell("Heroic Inspiration", Q.insp()) + "</div>" +
      '<div class="c3">' + Q.hpBox() + "</div></div>";
    var col1 = '<div class="lb-col">' + Q.card("Saving throws", Q.saves()) + Q.card("Senses", Q.senses()) + Q.card("Proficiencies and training", Q.profs()) + "</div>";
    var col2 = '<div class="lb-col">' + Q.card("Skills", Q.skills(1)) + "</div>";
    var def = '<div class="lb-def c3"><div><span class="sh-eb">AC</span><span class="v">' + D.ac + '</span></div><div><span class="sh-eb">Initiative</span>' + Q.rb("Initiative", D.init) + "</div>" +
      '<div><span class="sh-eb">Defenses</span><span class="t">Advantage on saves against Charmed</span></div><div><span class="sh-eb">Conditions and effects</span>' + Q.effects() + "</div></div>";
    var box = '<div class="lb-box c3">' + P.tabs(g, [["actions", "Actions"], ["spells", "Spells"], ["gear", "Gear"], ["features", "Features"], ["notes", "Notes"]], "actions") +
      '<div class="lb-tp" data-tpscroll>' + panels(g, "actions", [["actions", Q.actions(false)], ["spells", Q.spells(false)], ["gear", Q.gear(false)], ["features", Q.features()], ["notes", Q.bio()]]) + "</div></div>";
    return { cols: true, html: '<div class="lb">' + top + stats + '<div class="lb-body">' + col1 + col2 + '<div class="lb-main">' + def + box + "</div></div></div>" };
  }

  /* ---------- The three refinements share the band, the tabbed box and the phone's tabs ---------- */
  var WIDE_TABS = [["actions", "Actions"], ["spells", "Spells"], ["gear", "Gear"], ["features", "Features"], ["notes", "Notes"]];
  var PHONE_TABS = [["main", "Main"]].concat(WIDE_TABS);
  function tabPanels(narrow) { return [["actions", Q.actions(narrow)], ["spells", Q.spells(narrow)], ["gear", Q.gear(narrow)], ["features", Q.features2()], ["notes", Q.bio()]]; }
  function box() {
    var g = gid("x");
    return '<div class="lb-box c3">' + P.tabs(g, WIDE_TABS, "actions") + '<div class="lb-tp" data-tpscroll>' + panels(g, "actions", tabPanels(false)) + "</div></div>";
  }
  function phoneL(main) {
    return narrowL(PHONE_TABS, "main", [["main", Q.card("Conditions and effects", Q.effects()) + Q.trio() + main]].concat(tabPanels(true)), Q.band2());
  }
  function wide(cls, html) { return { cols: true, html: '<div class="rf">' + Q.band() + '<div class="rf-b ' + cls + '">' + html + "</div></div>" }; }

  /* Strip: abilities across the top with their saves; skills and senses on the left; the box on the right */
  function stripL(narrow) {
    if (narrow) return phoneL(Q.abStrip(true) + Q.card("Skills", Q.skills(1)) + Q.card("Senses", Q.passives()));
    return wide("rs", Q.abStrip() + '<div class="rs-body"><div class="rf-col">' + Q.card("Skills", Q.skills(2)) + Q.card("Senses", Q.passives()) + "</div>" + box() + "</div>");
  }
  /* Grouped: each ability a block with its save and skills, physical abilities left, mental right */
  function groupedL(narrow) {
    var all = [0, 1, 2, 3, 4, 5].map(Q.abGroup);
    if (narrow) return phoneL(all.join("") + Q.card("Senses", Q.senses()));
    return wide("rg", '<div class="rf-col">' + all.slice(0, 3).join("") + Q.card("Senses", Q.senses()) + '</div><div class="rf-col">' + all.slice(3).join("") + "</div>" + box());
  }
  /* Ledger: abilities as rows down the first column, skills in the second, the box full height in the third */
  function ledgerL(narrow) {
    // Senses is only read, so it is an open group; the cards you roll from are Cradle boxes (the theme spec)
    if (narrow) return phoneL(Q.card("Abilities", Q.abLedger()) + Q.card("Skills", Q.skills(1)) + Q.card("Senses", Q.senses(), { cls: "read" }));
    return wide("rl", '<div class="rf-col">' + Q.card("Abilities", Q.abLedger()) + Q.card("Senses", Q.senses(), { cls: "read" }) + '</div><div class="rf-col">' + Q.card("Skills", Q.skills(1)) + "</div>" + box());
  }

  var LAYOUTS = { last: beyondL, strip: stripL, grouped: groupedL, ledger: ledgerL };

  /* ---------- Frames ---------- */
  var toast = '<div class="rt3" data-toast hidden aria-live="polite"><span class="w"></span><span class="d"></span><span class="t sh-num"></span></div>';
  function laptop(L) {
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap">' +
      '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' +
      '<nav class="ap-nav" aria-hidden="true"><span>Table</span><span class="on" data-seat>Sheet</span><span>Codex</span></nav>' +
      '<div class="ap-end"><span class="ap-who">' + P.port() + "Playing Lyra</span>" + '<span class="ico">' + I.search + '</span><span class="ico">' + I.screen + '</span><span class="ico">' + I.gear + "</span></div></header>" +
      '<div class="ap-pane' + (L.cols ? " is-cols" : "") + '">' + L.html + "</div>" + toast + "</div></div>";
  }
  function phone(L) {
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone">' +
      '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span><div class="ap-end"><span class="ico">' + I.search + '</span><span class="ico">' + I.screen + '</span><span class="ico">' + I.gear + "</span></div></header>" +
      '<div class="ap-pane">' + L.html + "</div>" +
      '<nav class="ap-bottom" aria-hidden="true"><span>' + I.die + "Table</span><span class=\"on\">" + I.person + "Sheet</span><span>" + I.doc + "Codex</span><span>" + I.lines + "Log</span></nav>" + toast + "</div></div>";
  }
  function panel(L) {
    var g = gid("pt");
    return '<div class="frame" style="width:392px;height:800px"><div class="ap is-panel">' +
      '<div class="ap-paneltabs">' + P.tabs(g, [["me", "Me"], ["log", "Log"], ["party", "Party"]], "me") + "</div>" +
      '<div class="ap-pane">' + L.html + "</div>" + toast + "</div></div>";
  }

  /* ---------- What each option is ---------- */
  var IDEAS = {
    last: {
      name: "Beyond, last round",
      text: "Last round's Beyond, for comparison. It follows D&D Beyond block for block.",
      lists: [
        ["Why it reads as a copy", ["The stat row: six ability boxes, then proficiency, speed and inspiration, then the hit point box", "Heal over the amount over Damage, stacked the way D&D Beyond stacks them", "An AC, initiative, defenses and conditions strip on top of the tabbed box", "Three columns, with the tabbed box squeezed into the last"]]
      ],
      elsewhere: "",
      watch: ""
    },
    strip: {
      name: "Strip",
      text: "The closest to D&D Beyond. The six abilities still run across the top, and each now carries its save underneath, so the saves box is gone. Above them, one vitals band holds what you watch in a fight: AC and hit points with their controls, then initiative, speed, proficiency and inspiration. Skills sit in two columns on the left with your passive senses under them, and the tabbed box fills the right.",
      lists: [
        ["Still familiar", ["Abilities across the top and skills in a block of their own, where D&D Beyond players look first", "The same five tabs, and Actions and spells keep D&D Beyond's table columns"]],
        ["No longer a copy", ["One vitals band replaces D&D Beyond's stat row and its hit point box, and the AC strip above the tabs is gone. The phone pins the same band", "Hit points use the app's segmented life bar, with Damage, Heal and Temp beside the number", "Saves sit under their abilities, and proficiencies and defenses moved to the Features tab", "You roll by tapping the number itself. Abilities, saves and skills have no boxes drawn around them"]],
        ["Getting around", ["Under the band, checks are on the left and everything you do is on the right", "One row of tabs, the same on every screen", "On a phone, Main holds the abilities and skills under the pinned band"]]
      ],
      elsewhere: "The phone pins the same band: AC, hit points, initiative and speed, with Change opening Damage, Heal and Temp. Main starts with the abilities in a three by two grid, each with its save.",
      watch: "The tabbed box is the shortest of the three, because the abilities take a full row across the top."
    },
    grouped: {
      name: "Grouped",
      text: "Skills move under the ability they use, as on the 2024 printed character sheet. Each ability is a block that holds its save and then its skills under the modifier. Strength, Dexterity and Constitution share the first column with your senses, and Intelligence, Wisdom and Charisma fill the second. The band and the tabbed box are the same as in Strip.",
      lists: [
        ["Still familiar", ["The grouping is the official 2024 sheet's, so players know it from paper as well as from VTTs", "The band and the tabbed box sit where D&D Beyond players expect them"]],
        ["No longer a copy", ["Saves and skills are no longer separate lists: each check sits with its ability", "Six blocks replace D&D Beyond's stat row", "Proficiency marks line up down each block, so your strong abilities stand out at a glance"]],
        ["Getting around", ["To roll Stealth, look under Dexterity", "The tabbed box runs the full height under the band", "On a phone, Main shows the six blocks one after another"]]
      ],
      elsewhere: "The phone pins the same band. Main shows the six ability blocks one after another, so a skill is always under its ability.",
      watch: "Players who know the skills alphabetically will hunt for them the first few times. Constitution has no skills, so its block is short."
    },
    ledger: {
      name: "Ledger",
      text: "Abilities run down the first column as rows, with the score beside each name and the modifier and save to the right, like the left edge of a paper sheet. Skills take the second column and the tabbed box the third. It keeps D&D Beyond's three columns but drops the stat row, so the box starts right under the band and gets the most room of the three.",
      lists: [
        ["Still familiar", ["D&D Beyond's three columns, in its order, with the tabbed box last", "The ability rows read like the printed sheet's left edge"]],
        ["No longer a copy", ["No stat row: abilities and their saves share one list", "The vitals band replaces the hit point box and the AC strip", "Senses are a short list under the abilities"]],
        ["Getting around", ["Every check is in the first two columns and nothing in them scrolls", "The tabbed box is the tallest of the three", "On a phone, Main lists the abilities as rows, then the skills"]]
      ],
      elsewhere: "The phone pins the same band. Main lists the abilities as rows with their saves, then the skills.",
      watch: "Three columns need about 1200 px, as last round's Beyond did."
    }
  };

  /* ---------- Page ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var state = { opt: "ledger", show: "all" };

  function renderIdea() {
    var d = IDEAS[state.opt];
    $("#idea-name").textContent = d.name;
    $("#idea-text").textContent = d.text;
    $("#idea-lists").innerHTML = d.lists.map(function (l) {
      return '<p class="eyebrow">' + S.esc(l[0]) + "</p><ul>" + l[1].map(function (k) { return "<li>" + S.esc(k) + "</li>"; }).join("") + "</ul>";
    }).join("");
    $("#idea-elsewhere").textContent = d.elsewhere;
    $("#idea-elsewhere-eb").hidden = !d.elsewhere;
    $("#idea-watch").textContent = d.watch;
    $("#idea-watch-eb").hidden = !d.watch;
  }

  function renderStage() {
    var lap = $("#v-laptop .fit"), ph = $("#v-phone .fit"), pn = $("#v-panel .fit");
    $("#v-panel .view-cap .eyebrow").textContent = "Table panel";
    $("#v-panel .view-cap p:last-child").textContent = "The 392 px column beside the map, on its Me tab";
    var L = LAYOUTS[state.opt];
    lap.innerHTML = laptop(L(false));
    ph.innerHTML = phone(L(true));
    pn.innerHTML = panel(L(true));
    fit();
  }

  function fit() {
    $$(".fit").forEach(function (box) {
      var fr = box.querySelector(".frame");
      if (!fr) return;
      var fw = parseFloat(fr.style.width), fh = parseFloat(fr.style.height);
      var k = Math.min(1, box.parentElement.clientWidth / fw);
      fr.style.transform = "scale(" + k + ")";
      box.style.width = fw * k + "px";
      box.style.height = fh * k + "px";
    });
    $$(".ap-nav [data-seat]").forEach(function (el) {
      el.style.setProperty("--win-w", el.closest(".ap-bar").offsetWidth + "px");
      el.style.setProperty("--win-x", -el.offsetLeft + "px");
    });
    $$("[data-vitals]").forEach(pinTabs);
    $$(".sh-tabs").forEach(placeInk);
  }
  // The tabs pin directly under the bar, whatever its height (it grows while the hit point row is open)
  function pinTabs(v) { v.closest(".ap-pane").style.setProperty("--mv-h", v.offsetHeight + "px"); }

  /* ---------- Light ---------- */
  function canMove() { return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) && !!document.body.animate; }
  function placeInk(strip) {
    var on = strip.querySelector(".sh-tab.on"), ink = strip.querySelector(".sh-ink");
    if (!on || !ink) return;
    ink.style.left = on.offsetLeft + "px";
    ink.style.width = on.offsetWidth + "px";
  }
  function switchTab(strip, tab) {
    var before = strip.querySelector(".sh-tab.on");
    if (before === tab) return;
    $$(".sh-tab", strip).forEach(function (t) { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
    var ink = strip.querySelector(".sh-ink");
    placeInk(strip);
    if (!canMove() || !before) return;
    var from = before.offsetLeft + before.offsetWidth / 2, to = tab.offsetLeft + tab.offsetWidth / 2, dir = to > from ? 1 : -1;
    ink.style.transformOrigin = dir > 0 ? "0 50%" : "100% 50%";
    ink.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 140, delay: 170, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", fill: "backwards" });
    var len = Math.min(120, Math.abs(to - from));
    var c = document.createElement("span");
    c.className = "sh-comet" + (dir < 0 ? " l" : "");
    c.style.width = len + "px";
    c.style.left = (dir > 0 ? from - len : from) + "px";
    strip.appendChild(c);
    var a = c.animate([{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(" + (to - from) + "px)", opacity: 1, offset: 0.85 }, { transform: "translateX(" + (to - from) + "px)", opacity: 0 }], { duration: 230, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });
    var rm = function () { c.remove(); };
    a.finished.then(rm, rm);
  }
  function countUp(el, from, to, dur) {
    if (!canMove()) { el.textContent = to; return; }
    var t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- Each frame keeps its own character ---------- */
  var FS = new WeakMap();
  function fstate(ap) {
    var s = FS.get(ap);
    if (!s) { s = { hp: D.hp, max: D.hpMax, temp: D.temp }; FS.set(ap, s); }
    return s;
  }
  function lifeHtml(s) {
    var n = Math.max(1, Math.min(22, Math.ceil(s.max / 2)));
    var lit = Math.round((s.hp / s.max) * n);
    var out = "";
    for (var i = 0; i < n; i++) out += i < lit ? "<i></i>" : '<i class="lost"></i>';
    return out;
  }
  function setHp(ap, s, next) {
    var old = s.hp;
    s.hp = Math.max(0, Math.min(s.max, next));
    $$("[data-hpcur]", ap).forEach(function (el) { countUp(el, old, s.hp, 300); });
    $$(".sh-life", ap).forEach(function (bar) {
      bar.innerHTML = lifeHtml(s);
      bar.setAttribute("aria-label", s.hp + " of " + s.max + " hit points");
      if (canMove() && old !== s.hp) bar.animate([{ boxShadow: "0 0 0 1px " + (s.hp < old ? "var(--hostile)" : "var(--hp)") }, { boxShadow: "0 0 0 1px transparent" }], { duration: 400, easing: "ease-out" });
    });
  }
  function setTemp(ap, s) { $$("[data-hptemp]", ap).forEach(function (el) { el.textContent = s.temp; }); }

  /* Dice for the toast */
  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function rollExpr(expr) {
    var m = /^(?:(\d+) × )?(\d+)d(\d+)(?: ([+−]) (\d+))?$/.exec(expr);
    if (!m) return null;
    var times = +(m[1] || 1), total = 0, faces = [];
    for (var t = 0; t < times; t++) {
      for (var i = 0; i < +m[2]; i++) { var r = d(+m[3]); faces.push(r); total += r; }
      if (m[4]) total += (m[4] === "+" ? 1 : -1) * +m[5];
    }
    return { total: total, faces: faces };
  }
  var timers = new WeakMap();
  function showToast(ap, what, detail, total, crit) {
    var t = ap.querySelector("[data-toast]");
    t.querySelector(".w").textContent = what;
    t.querySelector(".d").textContent = detail;
    t.classList.toggle("is-crit", !!crit);
    var wasHidden = t.hidden;
    t.hidden = false;
    countUp(t.querySelector(".t"), 0, total, 260);
    if (wasHidden && canMove()) t.animate([{ opacity: 0, transform: "translate(-50%, 10px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 180, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" });
    clearTimeout(timers.get(t));
    timers.set(t, setTimeout(function () { t.hidden = true; }, 3200));
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var ap = t.closest(".ap");
    var tab = t.closest(".sh-tab");
    if (tab) {
      var strip = tab.closest(".sh-tabs");
      switchTab(strip, tab);
      var shown = null;
      $$('.tp[data-group="' + strip.dataset.tabs + '"]').forEach(function (p) { p.hidden = p.dataset.panel !== tab.dataset.tab; if (!p.hidden) shown = p; });
      if (!shown) return;
      // A new tab starts at its top. On a phone the pinned tabs stay where they are.
      var sc = shown.closest("[data-tpscroll]");
      if (sc) { sc.scrollTop = 0; return; }
      var pane = shown.closest(".ap-pane"), pin = strip.closest(".mt3, .lp-tabs");
      if (pane && pin) {
        // A pinned element reports where it is stuck, so measure from the panel under it instead
        var target = shown.offsetTop - pin.offsetHeight - (parseFloat(getComputedStyle(pin).top) || 0) - 12;
        if (pane.scrollTop > target) pane.scrollTop = Math.max(0, target);
      }
      return;
    }
    if (!ap) return;
    var s;
    var hp = t.closest("[data-hpdo]");
    if (hp) {
      s = fstate(ap);
      var box = hp.closest("[data-hpedit]");
      var amt = Math.max(0, parseInt(box.querySelector("[data-amt]").value, 10) || 0);
      if (hp.dataset.hpdo === "dmg") {
        var soak = Math.min(s.temp, amt);
        s.temp -= soak;
        setTemp(ap, s);
        setHp(ap, s, s.hp - (amt - soak));
      } else if (hp.dataset.hpdo === "heal") setHp(ap, s, s.hp + amt);
      else { s.temp = Math.max(s.temp, amt); setTemp(ap, s); }
      return;
    }
    var tog = t.closest("[data-hptoggle]");
    if (tog) {
      var v = tog.closest("[data-vitals]"), ed = v.querySelector(".mv3-ed");
      ed.hidden = !ed.hidden;
      tog.setAttribute("aria-expanded", String(!ed.hidden));
      tog.querySelector(".chg").textContent = ed.hidden ? "Change" : "Done";
      pinTabs(v);
      return;
    }
    var roll = t.closest("[data-roll]");
    if (roll) {
      var parts = roll.dataset.roll.split("|");
      var mod = parseInt(parts[1].replace("−", "-"), 10), r = d(20);
      showToast(ap, parts[0], "d20 (" + r + ") " + (mod < 0 ? "− " + -mod : "+ " + mod), r + mod, r === 20);
      return;
    }
    var dmg = t.closest("[data-dmg]");
    if (dmg) {
      var dp = dmg.dataset.dmg.split("|"), res = rollExpr(dp[1]);
      if (res) showToast(ap, dp[0] + " · " + dp[2] + " damage", dp[1] + " (" + res.faces.join(", ") + ")", res.total);
      return;
    }
    var slot = t.closest(".sl3 button");
    if (slot) {
      // Tapping a lit box spends one and tapping a spent box gets one back; lit boxes always stay on the left
      var key = slot.parentElement.dataset.slot, all = $$("button", slot.parentElement);
      var left = all.filter(function (b) { return !b.classList.contains("used"); }).length + (slot.classList.contains("used") ? 1 : -1);
      $$('.sl3[data-slot="' + key + '"]', ap).forEach(function (row) {
        $$("button", row).forEach(function (b, n) {
          var used = n >= left, was = b.classList.contains("used");
          b.classList.toggle("used", used);
          b.setAttribute("aria-label", used ? "Used" : "Available");
          if (used !== was && canMove()) b.querySelector("i").animate([{ transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 200, easing: "ease-out" });
        });
      });
      return;
    }
    var insp = t.closest("[data-insp]");
    if (insp) {
      var on = !insp.classList.contains("on");
      $$("[data-insp]", ap).forEach(function (b) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    }
  });

  function setOpt(k, fromHash) {
    if (!IDEAS[k]) return;
    state.opt = k;
    $$("#opt-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.opt === k)); });
    renderIdea();
    renderStage();
    if (!fromHash) { try { history.replaceState(null, "", "#" + k); } catch (e) { /* the frame may refuse it */ } }
  }
  function setShow(v) {
    state.show = v;
    $("#stage").dataset.show = v;
    $$("#view-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.show === v)); });
    fit();
  }
  $$("#opt-seg button").forEach(function (b) { b.addEventListener("click", function () { setOpt(b.dataset.opt); }); });
  $$("#view-seg button").forEach(function (b) { b.addEventListener("click", function () { setShow(b.dataset.show); }); });

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function paintTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $$("#theme-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.th === eff)); });
  }
  $$("#theme-seg button").forEach(function (b) {
    b.addEventListener("click", function () { document.documentElement.setAttribute("data-theme", b.dataset.th); paintTheme(); });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);

  var lastW = 0;
  if (window.ResizeObserver) new ResizeObserver(function (entries) {
    var w = Math.round(entries[0].contentRect.width);
    if (w !== lastW) { lastW = w; fit(); }
  }).observe($("#stage"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

  window.addEventListener("hashchange", function () {
    var h = location.hash.slice(1);
    if (IDEAS[h] && h !== state.opt) setOpt(h, true);
  });
  var h0 = location.hash.slice(1);
  setShow(window.matchMedia && window.matchMedia("(max-width: 650px)").matches ? "phone" : "all");
  setOpt(IDEAS[h0] ? h0 : "ledger", true);
  paintTheme();
})();
