// === stacknav.js — one-click switching between RECALL / HOOKLAB / BLAST / PULSE ===
// Injects a slim switcher bar at the very top of the page so you can jump
// between the four live apps without going through the marketing site.
// Plain classic script, vendored byte-identical in each app directory
// (same pattern as stackdata.js). Loads at the end of <body>.
(function () {
  "use strict";

  var APPS = [
    { key: "recall",  name: "RECALL",  url: "https://mjmorrison10.github.io/recall/",      color: "#22d3ee", tint: "rgba(34,211,238,.14)" },
    { key: "hooklab", name: "HOOKLAB", url: "https://mjmorrison10.github.io/Hooklabs/",    color: "#a78bfa", tint: "rgba(167,139,250,.14)" },
    { key: "blast",   name: "BLAST",   url: "https://mjmorrison10.github.io/blast/",       color: "#fb923c", tint: "rgba(251,146,60,.14)" },
    { key: "pulse",   name: "PULSE",   url: "https://mjmorrison10.github.io/pulse/", color: "#f472b6", tint: "rgba(244,114,182,.14)" },
  ];

  // Which app is this page? Each app lives at its own path (/recall/, /Hooklabs/,
  // /blast/, /pulse/); match on the path segment.
  function currentKey() {
    var p = location.pathname.toLowerCase();
    if (p.indexOf("pulse") !== -1) return "pulse";
    if (p.indexOf("blast") !== -1) return "blast";
    if (p.indexOf("hooklab") !== -1) return "hooklab";
    if (p.indexOf("recall") !== -1) return "recall";
    return "";
  }

  function build() {
    if (document.querySelector(".mjm-stacknav")) return;

    var css = "" +
      ".mjm-stacknav{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;" +
      "padding:7px 10px;font:700 10px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.08em;" +
      "background:rgba(128,128,128,.07);border-bottom:1px solid rgba(128,128,128,.16)}" +
      ".mjm-stacknav .mjm-sn-label{opacity:.55;font-weight:600;letter-spacing:.14em;margin-right:2px}" +
      ".mjm-stacknav a,.mjm-stacknav span.mjm-sn-here{display:inline-block;padding:4px 11px;border-radius:999px;" +
      "text-decoration:none;letter-spacing:.08em}" +
      ".mjm-stacknav a{opacity:.92}" +
      ".mjm-stacknav a:hover{opacity:1;filter:brightness(1.15)}" +
      ".mjm-stacknav span.mjm-sn-here{color:#fff;cursor:default}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var here = currentKey();
    var nav = document.createElement("nav");
    nav.className = "mjm-stacknav";
    nav.setAttribute("aria-label", "Switch app: the MJM creator stack");

    var label = document.createElement("span");
    label.className = "mjm-sn-label";
    label.textContent = "THE STACK";
    nav.appendChild(label);

    APPS.forEach(function (app) {
      var el;
      if (app.key === here) {
        el = document.createElement("span");
        el.className = "mjm-sn-here";
        el.style.background = app.color;
        el.setAttribute("aria-current", "page");
      } else {
        el = document.createElement("a");
        el.href = app.url;
        el.style.color = app.color;
        el.style.background = app.tint;
        el.title = "Switch to " + app.name + " (your data and keys come with you)";
      }
      el.textContent = app.name;
      nav.appendChild(el);
    });

    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
