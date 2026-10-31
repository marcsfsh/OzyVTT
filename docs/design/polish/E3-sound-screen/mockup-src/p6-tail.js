  // One primary in view (T rule 2): when the page shows its own Cup, the section bar's New steps down to a Base line
  // button; when it shows two, the step's or the open panel's keeps the Cup and the title row's steps down. A dialog's
  // Cup sits over a scrim and doesn't count.
  function oneCup(root) {
    var cups = Array.prototype.filter.call(root.querySelectorAll(".cup"), function (c) { return !c.closest(".e-dlg, .q-dlg, .d-dlg, .u-dlg, .i-dlg"); });
    var bar = root.querySelector(".sb-end .cup"), own = cups.filter(function (c) { return c !== bar; });
    var down = function (c, icon) { c.outerHTML = '<span class="e-btn">' + (icon || "") + c.innerHTML + "</span>"; };
    if (bar && own.length) down(bar, IC.plus);
    if (own.length > 1) own.filter(function (c) { return c.closest(".acts"); }).forEach(function (c) { down(c); });
  }
  /* ---------- Page ---------- */
  var DOFP = { board: "s1", now: "s2", add: "s3", enc: "s4", seeas: "s5" };
  var PGNAME = { board: "the sound board", now: "the sound board, what is playing", add: "putting Crowd murmur in the ambience", enc: "each encounter's sound", seeas: "Ambush on the old road seen as the table screen" };
  var RENDER = { board: boardPage, now: nowPage, add: addPage, enc: encPage, seeas: seeasPage };
  function renderStage() {
    $("#cap-laptop").textContent = "Laptop · " + PGNAME[S.pg];
    $("#cap-phone").textContent = "Phone · " + PGNAME[S.pg];
    $("#v-laptop .fit").innerHTML = RENDER[S.pg](false) + '<i class="snap a"></i><i class="snap b"></i><i class="snap c"></i>';
    oneCup($("#v-laptop .fit"));
    $("#v-phone .fit").innerHTML = RENDER[S.pg](true);
    fit();
  }
  /* On a phone the laptop frame has three sizes: Close up (readable, swiped sideways between three stops), Whole
     (all of it, small) and Turned (all of it on its side, for a phone held sideways with rotation locked). */
  var NARROW = window.matchMedia ? window.matchMedia("(max-width: 700px)") : null;
  var CLOSE = 0.72;
  function fit() {
    var narrow = !!(NARROW && NARROW.matches);
    $$(".fit").forEach(function (box) {
      var fr = box.querySelector(".frame");
      if (!fr) return;
      var fw = parseFloat(fr.style.width), fh = parseFloat(fr.style.height);
      var lap = box.parentElement.id === "lap-pan";
      var mode = lap && narrow ? S.lz : "whole";
      if (lap) box.parentElement.className = "pan" + (mode === "close" ? " close" : "");
      var W = box.parentElement.clientWidth;
      if (mode === "turned") {
        var kt = W / fh;
        fr.style.transform = "translateX(" + fh * kt + "px) rotate(90deg) scale(" + kt + ")";
        box.style.width = fh * kt + "px";
        box.style.height = fw * kt + "px";
        return;
      }
      var k = mode === "close" ? CLOSE : Math.min(1, W / fw);
      fr.style.transform = "scale(" + k + ")";
      box.style.width = fw * k + "px";
      box.style.height = fh * k + "px";
    });
    hint();
    $$(".ap-nav [data-seat]").forEach(function (el) {
      el.style.setProperty("--win-w", el.closest(".ap-bar").offsetWidth + "px");
      el.style.setProperty("--win-x", -el.offsetLeft + "px");
    });
  }
  var HINT = { close: "Swipe sideways for the rest of the laptop screen.", whole: "The whole laptop screen, shown small.", turned: "On its side: lock rotation and turn your phone to the left to read it." };
  function hint() {
    var h = $("#lz-hint");
    if (!h) return;
    $("#lz-text").textContent = HINT[S.lz];
    h.classList.toggle("no-dots", S.lz !== "close");
    var pan = $("#lap-pan"), max = pan.scrollWidth - pan.clientWidth;
    var i = max > 0 ? Math.round((pan.scrollLeft / max) * 2) : 0;
    $$("#lz-dots button").forEach(function (b, j) { b.classList.toggle("on", j === i); });
  }
  $("#lap-pan").addEventListener("scroll", function () { if (S.lz === "close") hint(); }, { passive: true });
  $$("#lz-dots button").forEach(function (b, j) {
    b.addEventListener("click", function () { var pan = $("#lap-pan"); pan.scrollTo({ left: ((pan.scrollWidth - pan.clientWidth) * j) / 2, behavior: "smooth" }); });
  });
  $$("#lz-seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      S.lz = b.getAttribute("data-v");
      $$("#lz-seg button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      fit();
    });
  });

  var PAGES_BAR = [["board", "Board"], ["now", "Playing"], ["add", "Adding"], ["enc", "Encounters"], ["seeas", "See as"]];
  function centreChip(row) {
    var on = row.querySelector('[aria-pressed="true"]');
    if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }
  function renderMbar() {
    var k = DOFP[S.pg], d = DEC[k];
    $("#mb-pages").innerHTML = PAGES_BAR.map(function (p) { return '<button type="button" data-pg="' + p[0] + '" aria-pressed="' + (S.pg === p[0]) + '">' + p[1] + "</button>"; }).join("");
    $("#mb-k").textContent = d.n;
    $("#mb-opts").setAttribute("aria-label", d.name);
    $("#mb-opts").innerHTML = VALID[k].map(function (v) { return '<button type="button" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (S[k] === v) + '">' + d.opts[v][0] + "</button>"; }).join("");
    centreChip($("#mb-pages"));
    centreChip($("#mb-opts"));
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $("#mb-theme").textContent = eff === "light" ? "Dawn" : "Dusk";
  }
  $("#mbar").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.id === "mb-theme") {
      var t = document.documentElement.getAttribute("data-theme");
      var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", eff === "light" ? "dark" : "light");
      paintTheme();
      renderMbar();
      return;
    }
    if (b.dataset.pg) S.pg = b.dataset.pg;
    else if (b.dataset.k) S[b.dataset.k] = b.dataset.v;
    else return;
    sync();
    renderIdea();
    renderStage();
    renderMbar();
    writeHash();
  });

  /* Inside a frame: the writer's Preview switch and the story's tabs work. */
  $("#stage").addEventListener("click", function (e) {
    var p = e.target.closest("[data-prev]"), t = e.target.closest("[data-d4]");
    if (p) S.prev = p.getAttribute("data-prev") === "1" && !(p.getAttribute("role") === "switch" && S.prev);
    else if (t) { S.d4 = t.getAttribute("data-d4"); S.pg = "story"; }
    else return;
    sync(); renderIdea(); renderStage(); renderMbar(); writeHash();
  });

  var SEGS = { s1: "s1-seg", s2: "s2-seg", s3: "s3-seg", s4: "s4-seg", s5: "s5-seg", pg: "pg-seg", show: "view-seg" };
  function sync() {
    Object.keys(SEGS).forEach(function (k) {
      $$("#" + SEGS[k] + " button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === S[k])); });
    });
    $("#stage").dataset.show = S.show;
  }
  function writeHash() { try { history.replaceState(null, "", "#" + KEYS.map(function (k) { return S[k]; }).join(".")); } catch (e) { /* the frame may refuse it */ } }
  function readHash() {
    var h = location.hash.slice(1).split(".");
    KEYS.forEach(function (k, i) { if (VALID[k].indexOf(h[i]) >= 0) S[k] = h[i]; });
  }
  Object.keys(SEGS).forEach(function (k) {
    $$("#" + SEGS[k] + " button").forEach(function (b) {
      b.addEventListener("click", function () {
        S[k] = b.getAttribute("data-v");
        if (DEC[k] && !(k === "d2" && S.pg === "setup")) S.pg = DEC[k].page;
        sync();
        if (k === "show") { fit(); return; }
        renderIdea();
        renderStage();
        renderMbar();
        writeHash();
      });
    });
  });

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function paintTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $$("#theme-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.th === eff)); });
  }
  $$("#theme-seg button").forEach(function (b) {
    b.addEventListener("click", function () { document.documentElement.setAttribute("data-theme", b.dataset.th); paintTheme(); renderMbar(); });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);

  var lastW = 0;
  if (window.ResizeObserver) new ResizeObserver(function (entries) {
    var w = Math.round(entries[0].contentRect.width);
    if (w !== lastW) { lastW = w; fit(); }
  }).observe($("#stage"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("hashchange", function () { readHash(); sync(); renderIdea(); renderStage(); renderMbar(); });
  if (NARROW && NARROW.addEventListener) NARROW.addEventListener("change", fit);

  readHash();
  sync();
  renderIdea();
  renderStatic();
  renderStage();
  renderMbar();
  paintTheme();
  // On a wider screen the full set of switches scrolls away; the compact bar is pinned once it is out of view.
  if (window.IntersectionObserver) new IntersectionObserver(function (entries) {
    document.documentElement.classList.toggle("bar-away", !entries[0].isIntersecting);
  }).observe($(".switch-bar"));
  // Close up opens on the middle of the laptop screen, where most of each page sits.
  if (NARROW && NARROW.matches) { var pan0 = $("#lap-pan"); pan0.scrollLeft = (pan0.scrollWidth - pan0.clientWidth) / 2; hint(); }
})();
