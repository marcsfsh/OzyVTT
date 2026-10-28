  /* ---------- Page controls ---------- */
  var page = $("#page");
  function press(attr, value) {
    $$("button[data-" + attr + "]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset[attr] === value ? "true" : "false");
    });
  }
  function effectiveLook() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "light") return "dawn";
    if (t === "dark") return "dusk";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "dawn" : "dusk";
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button[data-play], button[data-speed], button[data-look], button[data-tone]");
    if (!t) return;
    if (t.dataset.play) {
      var fn = PLAY[t.dataset.play];
      if (!fn) return;
      fn();
      var m = t.closest(".moment");
      if (m) {
        m.classList.add("is-playing");
        clearTimeout(m._t);
        m._t = setTimeout(function () {
          m.classList.remove("is-playing");
        }, T(900));
      }
    } else if (t.dataset.speed) {
      S.k = Number(t.dataset.speed);
      press("speed", t.dataset.speed);
    } else if (t.dataset.look) {
      page.dataset.look = t.dataset.look;
      press("look", t.dataset.look);
    } else if (t.dataset.tone) {
      page.dataset.tone = t.dataset.tone;
      press("tone", t.dataset.tone);
    }
  });
  press("look", effectiveLook());

  // Horizon tone: an ink that lies on a line already painted as the horizon shows that line's own colours at that
  // place, brightened, so lighting it reads as the rail glowing there and not a second horizon laid over it. An ink
  // on a plain line (a sub-tab strip, the phone's bottom tabs) keeps a horizon of its own.
  function seatWindows() {
    $$(".ana-bar, .app").forEach(function (root) {
      var rail = $(".ana-bar > .hz, .app-hz", root.parentElement || root);
      if (!rail || !root.contains(rail)) return;
      var r = rail.getBoundingClientRect();
      if (!r.width) return;
      $$(".ul", root).forEach(function (ul) {
        var host = ul.parentElement.getBoundingClientRect();
        var u = ul.getBoundingClientRect();
        var onRail = Math.abs(u.bottom - r.bottom) < 4 && host.left >= r.left - 1 && host.right <= r.right + 1;
        ul.classList.toggle("on-rail", onRail);
        if (onRail) {
          ul.style.setProperty("--win-w", px(r.width));
          ul.style.setProperty("--win-x", px(r.left - host.left));
        }
      });
    });
  }
  if (window.ResizeObserver) {
    var seatRO = new ResizeObserver(seatWindows);
    var watchSeats = function () {
      $$(".ana-bar, .app").forEach(function (el) {
        if (!el._seated) {
          el._seated = true;
          seatRO.observe(el);
        }
      });
    };
    watchSeats();
    new MutationObserver(watchSeats).observe(document.body, { childList: true, subtree: true });
  }
  seatWindows();
})();
