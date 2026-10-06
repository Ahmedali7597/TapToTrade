// Runs before the page paints (linked from index.html; a separate file because the CSP blocks inline scripts).
// Sets <html data-theme="light|dark"> from the player's choice (header button or Settings): "light", "dark", or "system"
// (the default), which follows the device and keeps following it if the device switches.
(function () {
  var KEY = "ttt-theme";
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system"; // storage blocked (private mode): just follow the device
    }
  }

  function apply(choice) {
    var theme = choice === "system" ? (media.matches ? "dark" : "light") : choice;
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0c1614" : "#eaf0ed");
  }

  apply(stored());
  media.addEventListener("change", function () {
    if (stored() !== "system") return;
    apply("system");
    window.dispatchEvent(new CustomEvent("ttt:display"));
  });

  // Used by the header's light/dark button and the Settings card.
  // Display and accessibility choices from Settings: text size, reduced motion, higher contrast and
  // underlined links. Saved on this device and applied here, so the first paint already uses them.
  // Each one becomes data-<name> on <html> (absent = the default); index.css does the rest.
  var DISPLAY = "ttt-display";
  // Keep in step with DEFAULTS in src/lib/display.js.
  var DEFAULTS = { text: "default", motion: "device", contrast: "default", links: "default" };

  function display() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(DISPLAY) || "{}") || {};
    } catch (e) {
      /* storage blocked or garbled: use the defaults */
    }
    var out = {};
    for (var k in DEFAULTS) out[k] = typeof saved[k] === "string" ? saved[k] : DEFAULTS[k];
    return out;
  }

  function applyDisplay(d) {
    var root = document.documentElement;
    for (var k in DEFAULTS) {
      if (d[k] === DEFAULTS[k]) root.removeAttribute("data-" + k);
      else root.setAttribute("data-" + k, d[k]);
    }
  }

  applyDisplay(display());

  window.tttDisplay = {
    get: display,
    set: function (key, value) {
      var d = display();
      d[key] = value;
      try {
        localStorage.setItem(DISPLAY, JSON.stringify(d));
      } catch (e) {
        /* not saved, but still applied for this visit */
      }
      applyDisplay(d);
      window.dispatchEvent(new CustomEvent("ttt:display", { detail: d }));
    },
  };

  window.tttTheme = {
    get: stored,
    set: function (choice) {
      try {
        if (choice === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
      } catch (e) {
        /* not saved, but still applied for this visit */
      }
      apply(choice);
      window.dispatchEvent(new CustomEvent("ttt:display"));
    },
  };
})();
