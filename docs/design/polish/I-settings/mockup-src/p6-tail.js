  /* ---------- Page ---------- */
  var DOFP = { home: "d1", search: "d1", device: "d2", characters: "d2", fights: "d3", access: "d4", cred: "d4" };
  var PGNAME = { home: "opening Settings", search: "searching for roll", device: "Device", characters: "Characters", fights: "Encounters", access: "Access", cred: "a new credential" };
  var RENDER = { home: homePage, search: searchPage, device: device, characters: characters, fights: fights, access: access, cred: cred };
  function renderStage() {
    $("#cap-laptop").textContent = "Laptop · " + PGNAME[S.pg];
    $("#cap-phone").textContent = "Phone · " + PGNAME[S.pg];
    $("#v-laptop .fit").innerHTML = RENDER[S.pg](false) + '<i class="snap a"></i><i class="snap b"></i><i class="snap c"></i>';
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

  var PAGES_BAR = [["home", "Opening"], ["search", "Search"], ["device", "Device"], ["characters", "Characters"], ["fights", "Encounters"], ["access", "Access"], ["cred", "New credential"]];
  function centreChip(row) {
    var on = row.querySelector('[aria-pressed="true"]');
    if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }
  function renderMbar() {
    var k = DOFP[S.pg], d = DEC[k];
    $("#mb-pages").innerHTML = PAGES_BAR.map(function (p) { return '<button type="button" data-pg="' + p[0] + '" aria-pressed="' + (S.pg === p[0]) + '">' + p[1] + "</button>"; }).join("");
    $("#mb-k").textContent = d.n;
    $("#mb-opts").setAttribute("aria-label", d.name);
    $("#mb-opts").innerHTML = VALID[k].map(function (v, i) { return (d.fams && i % 3 === 0 ? '<span class="mb-sep">' + d.fams[i / 3] + "</span>" : "") + '<button type="button" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (S[k] === v) + '">' + (d.fams ? d.opts[v][0].replace(d.fams[Math.floor(i / 3)] + ", refined", "Refined") : d.opts[v][0]) + "</button>"; }).join("");
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

  var SEGS = { d1: "d1-seg", d2: "d2-seg", d3: "d3-seg", d4: "d4-seg", pg: "pg-seg", show: "view-seg" };
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
        if (DEC[k] && DOFP[S.pg] !== k) S.pg = DEC[k].page;
        sync();
        if (k === "show") { fit(); return; }
        renderIdea();
        renderStage();
        renderMbar();
        writeHash();
      });
    });
  });

  $("#stage").addEventListener("click", function (e) {
    var g = e.target.closest("[data-go]");
    if (!g || VALID.pg.indexOf(g.getAttribute("data-go")) < 0) return;
    S.pg = g.getAttribute("data-go");
    sync();
    renderIdea();
    renderStage();
    renderMbar();
    writeHash();
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
  // Close up opens on the middle of the laptop screen, where most of each page sits.
  if (NARROW && NARROW.matches) { var pan0 = $("#lap-pan"); pan0.scrollLeft = (pan0.scrollWidth - pan0.clientWidth) / 2; hint(); }
})();
