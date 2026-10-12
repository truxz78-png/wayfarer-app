/* Wayfarer automatic translation (no Google widget, no banner).
 * - Detects the phone/browser language (navigator.language).
 * - Translates every visible text node of <body> with Google's public
 *   translate endpoint, one node at a time, and replaces node.nodeValue.
 * - Never translates brand names (exact match, case-insensitive), nor
 *   elements marked translate="no" or class "notranslate".
 * - Keeps the original leading capital letter and surrounding spaces.
 * - Also translates content added later (partner lists from links.json).
 * - Saves translations on the device so each text is requested only once.
 * - If anything fails, the page simply stays in English.
 */
(function () {
  'use strict';

  var SOURCE = 'en';
  var raw = (navigator.language || navigator.userLanguage || 'en');
  var LANG = String(raw).split('-')[0].toLowerCase();
  if (!LANG || LANG === SOURCE) return;

  // Brand names: never translated (exact match, case-insensitive).
  var BRANDS = [
    'Wayfarer', 'KAYAK', 'Aviasales', 'Booking.com', 'WeGoTrip', 'Airalo',
    'SafetyWing', 'EmbassyPages', 'Stay22', 'Kiwi.com', 'Airpaz', 'Tiket.com',
    'Cheapvuelos', 'Etihad Airways', 'Singapore Airlines', 'Eurowings',
    'ASAP Tickets', 'Compensair', 'ZenHotels', 'Zen Hotels', 'ALL Accor+',
    'Accor', 'Klook', 'KKday', 'Tiqets', 'Rayna Tours', 'RaynaTours',
    'AvitoVIP', 'Hungry Hub', 'Sitpack', 'ItaliaRail', 'DiscoverCars'
  ];
  var brandSet = {};
  function addBrand(name) { if (name) brandSet[String(name).trim().toLowerCase()] = true; }
  BRANDS.forEach(addBrand);
  // Partner names from links.json are added by the page when it loads them.
  window.wayfarerAddBrands = function (names) { (names || []).forEach(addBrand); };

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  var HAS_LETTER = /\p{L}/u;
  var CACHE_KEY = 'wf_tr_' + LANG;
  var MAX_PARALLEL = 4;

  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cache = {}; }
  var saveTimer = null;
  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
    }, 800);
  }

  function skipped(node) {
    for (var el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.getAttribute('translate') === 'no') return true;
      if (el.classList && el.classList.contains('notranslate')) return true;
    }
    return false;
  }

  function fixCapital(original, translated) {
    var o = original.trim(), t = translated;
    if (!o || !t) return t;
    var first = o.charAt(0);
    if (first !== first.toLowerCase() && first === first.toUpperCase()) {
      var i = t.search(/\p{L}/u);
      if (i >= 0) {
        var c = t.charAt(i);
        if (c === c.toLowerCase() && c !== c.toUpperCase()) {
          t = t.slice(0, i) + c.toLocaleUpperCase(LANG) + t.slice(i + 1);
        }
      }
    }
    return t;
  }

  function requestTranslation(text) {
    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
      SOURCE + '&tl=' + encodeURIComponent(LANG) + '&dt=t&q=' + encodeURIComponent(text);
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return (data && data[0] || []).map(function (part) { return part[0] || ''; }).join('');
      });
  }

  // Simple queue so we never send too many requests at once.
  var queue = [], running = 0;
  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      (function (job) {
        running++;
        requestTranslation(job.text)
          .then(function (t) { if (t) { cache[job.text] = t; saveCache(); job.done(t); } })
          .catch(function () { /* stay in English for this text */ })
          .then(function () { running--; pump(); });
      })(queue.shift());
    }
  }
  var pending = {};
  function translateText(text, apply) {
    if (cache[text]) { apply(cache[text]); return; }
    if (pending[text]) { pending[text].push(apply); return; }
    pending[text] = [apply];
    queue.push({ text: text, done: function (t) {
      (pending[text] || []).forEach(function (fn) { fn(t); });
      delete pending[text];
    } });
    pump();
  }

  var done = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function translateNode(node) {
    if (done && done.has(node)) return;
    var original = node.nodeValue;
    if (!original) return;
    var text = original.trim();
    if (!text || !HAS_LETTER.test(text)) return;
    if (brandSet[text.toLowerCase()]) return;
    if (skipped(node)) return;
    if (done) done.add(node);
    var lead = original.match(/^\s*/)[0], tail = original.match(/\s*$/)[0];
    translateText(text, function (t) {
      if (node.nodeValue === original) node.nodeValue = lead + fixCapital(text, t) + tail;
    });
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType !== 1 || SKIP_TAGS[root.tagName]) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n, nodes = [];
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(translateNode);
  }

  function start() {
    document.documentElement.setAttribute('lang', LANG);
    translateTree(document.body);
    if (document.title && !brandSet[document.title.trim().toLowerCase()]) {
      var t0 = document.title;
      translateText(t0, function (t) { if (document.title === t0) document.title = fixCapital(t0, t); });
    }
    // Content added later (partner lists, quick book buttons).
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(translateTree); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
