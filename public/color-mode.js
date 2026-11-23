// Marks the page light or dark, and public or inside the platform, before anything is drawn, with the person's own choice (kept by src/theme/color-mode.tsx under the same key) or else the
// device's, so the first frame already has the right background and nothing flashes from light to dark (owner, 11 Nov 2026). Loaded from the page's head:
// the site's security policy allows no script written inside the page itself.
(function () {
  var v = null;
  try { v = localStorage.getItem("chakra-ui-color-mode"); } catch (e) { /* private window */ }
  var m = v === "light" || v === "dark" ? v : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  var h = document.documentElement; h.setAttribute("data-theme", m); h.style.colorScheme = m;
  // The public pages (the landing page, Features, Pricing, Contact, signing in and signing up) open as themselves, with nothing shown before them; the
  // RoleMatch loading screen belongs inside the platform only (owner, 11 Nov 2026: "the landing page just needs to be the landing page").
  if (/^\/(features|pricing|contact|login|signup|accept-invite)?\/?$/.test(location.pathname)) h.setAttribute("data-entry", "public");
})();
