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
    var t = e.target.closest("button[data-play], button[data-speed], button[data-look]");
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
    }
  });
  press("look", effectiveLook());
})();
