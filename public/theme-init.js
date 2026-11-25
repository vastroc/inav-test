(function () {
  try {
    var saved = localStorage.getItem("iNav-theme");
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = saved || (dark ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#131313" : "#f5f5f3");
  } catch (e) {}
})();
