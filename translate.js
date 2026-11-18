/* Wayfarer automatic translation (no Google widget, no banner).
 * - Uses the language chosen with the 🌐 button (saved on the device),
 *   or else the phone/browser language. English is the fallback.
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

  // Languages of the 🌐 menu (same list as the Play Console listing),
  // each one written in its own language.
  var LANGS = [
    ['en','English'],['es','Español'],['pt','Português'],['fr','Français'],['de','Deutsch'],['it','Italiano'],
    ['nl','Nederlands'],['ru','Русский'],['uk','Українська'],['pl','Polski'],['cs','Čeština'],['sk','Slovenčina'],
    ['sl','Slovenščina'],['hr','Hrvatski'],['sr','Српски'],['bg','Български'],['mk','Македонски'],['ro','Română'],
    ['hu','Magyar'],['el','Ελληνικά'],['tr','Türkçe'],['ar','العربية'],['iw','עברית'],['fa','فارسی'],
    ['ur','اردو'],['hi','हिन्दी'],['bn','বাংলা'],['pa','ਪੰਜਾਬੀ'],['gu','ગુજરાતી'],['mr','मराठी'],
    ['ta','தமிழ்'],['te','తెలుగు'],['kn','ಕನ್ನಡ'],['ml','മലയാളം'],['si','සිංහල'],['ne','नेपाली'],
    ['zh-CN','简体中文'],['zh-TW','繁體中文'],['ja','日本語'],['ko','한국어'],['th','ไทย'],['vi','Tiếng Việt'],
    ['id','Bahasa Indonesia'],['ms','Bahasa Melayu'],['tl','Filipino'],['km','ខ្មែរ'],['lo','ລາວ'],['my','မြန်မာ'],
    ['mn','Монгол'],['kk','Қазақ тілі'],['ky','Кыргызча'],['uz',"O'zbek"],['az','Azərbaycan'],['ka','ქართული'],
    ['hy','Հայերեն'],['sq','Shqip'],['et','Eesti'],['lv','Latviešu'],['lt','Lietuvių'],['fi','Suomi'],
    ['sv','Svenska'],['no','Norsk'],['da','Dansk'],['is','Íslenska'],['ca','Català'],['eu','Euskara'],
    ['gl','Galego'],['af','Afrikaans'],['sw','Kiswahili'],['zu','isiZulu'],['am','አማርኛ'],['be','Беларуская']
  ];
  var RTL = { ar: 1, iw: 1, fa: 1, ur: 1 };

  function normalize(code) {
    code = String(code || 'en').toLowerCase().replace('_', '-');
    if (code.indexOf('zh') === 0) return /(tw|hk|mo|hant)/.test(code) ? 'zh-TW' : 'zh-CN';
    var base = code.split('-')[0];
    var map = { he: 'iw', fil: 'tl', nb: 'no', nn: 'no', jv: 'jw', 'in': 'id', ji: 'yi' };
    return map[base] || base || 'en';
  }
  function storedLang() { try { return localStorage.getItem('wf_lang'); } catch (e) { return null; } }
  function storeLang(v) { try { localStorage.setItem('wf_lang', v); } catch (e) {} }

  // 1) the language chosen with the 🌐 button, 2) the phone language, 3) English.
  var LANG = normalize(storedLang() ||
    (navigator.languages && navigator.languages[0]) || navigator.language || navigator.userLanguage || 'en');

  setupLanguageButton();
  if (LANG === SOURCE) return;

  // Brand names: never translated (exact match, case-insensitive).
  var BRANDS = [
    'Wayfarer', 'KAYAK', 'Aviasales', 'Booking.com', 'WeGoTrip', 'Airalo',
    'SafetyWing', 'EmbassyPages', 'Stay22', 'Kiwi.com', 'Airpaz', 'Tiket.com',
    'Cheapvuelos', 'Etihad Airways', 'Singapore Airlines', 'Eurowings',
    'ASAP Tickets', 'Compensair', 'ZenHotels', 'Zen Hotels', 'ALL Accor+',
    'Accor', 'Klook', 'KKday', 'Tiqets', 'Rayna Tours', 'RaynaTours',
    'AvitoVIP', 'Hungry Hub', 'Sitpack', 'ItaliaRail', 'DiscoverCars',
    'Punta Cana'
  ];

  // Place names the translator writes wrong (it gave "Punta-cana").
  function fixNames(t) {
    return String(t).replace(/Punta[\s\u2010-\u2015-]*cana/gi, 'Punta Cana');
  }
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
      if (node.nodeValue === original) node.nodeValue = lead + fixNames(fixCapital(text, t)) + tail;
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
    document.documentElement.setAttribute('lang', LANG === 'iw' ? 'he' : LANG);
    if (RTL[LANG]) document.documentElement.setAttribute('dir', 'rtl');
    translateTree(document.body);
    if (document.title && !brandSet[document.title.trim().toLowerCase()]) {
      var t0 = document.title;
      translateText(t0, function (t) { if (document.title === t0) document.title = fixNames(fixCapital(t0, t)); });
    }
    // Content added later (partner lists, quick book buttons).
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(translateTree); });
    }).observe(document.body, { childList: true, subtree: true });
  }


  // 🌐 button: shown where the page has an element with data-lang-slot.
  // The menu is never translated (translate="no"): each language keeps its own name.
  function setupLanguageButton() {
    function build() {
      var slot = document.querySelector('[data-lang-slot]');
      if (!slot || document.getElementById('wfLangBtn')) return;
      var css = document.createElement('style');
      css.textContent =
        '.wf-langbtn{font-family:inherit;font-weight:600;font-size:14px;line-height:1;color:#FFB238;background:rgba(14,34,51,.6);' +
        'border:1px solid rgba(255,178,56,.6);border-radius:999px;padding:8px 13px;cursor:pointer;white-space:nowrap}' +
        '.wf-langbtn:focus-visible{outline:2px solid #FFB238;outline-offset:2px}' +
        '.wf-lm{position:fixed;inset:0;z-index:100;background:rgba(4,12,20,.65);display:none;align-items:flex-end;justify-content:center}' +
        '.wf-lm.show{display:flex}' +
        '.wf-lm .box{background:#0E2233;color:#EDE6D6;width:100%;max-width:480px;max-height:80vh;border-radius:18px 18px 0 0;' +
        'display:flex;flex-direction:column;border:1px solid rgba(255,178,56,.35);border-bottom:0}' +
        '.wf-lm .hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;' +
        'border-bottom:1px solid rgba(237,230,214,.15);font-weight:700;color:#FFB238;font-size:16px}' +
        '.wf-lm .hd button{border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:#EDE6D6}' +
        '.wf-lm ul{list-style:none;margin:0;padding:6px 0;overflow-y:auto}' +
        '.wf-lm li button{width:100%;text-align:start;border:0;background:none;padding:12px 18px;font-size:16px;' +
        'cursor:pointer;color:#EDE6D6;font-family:inherit}' +
        '.wf-lm li button.cur{background:rgba(255,178,56,.18);color:#FFB238;font-weight:700}';
      document.head.appendChild(css);

      var code = LANG === 'iw' ? 'HE' : LANG.split('-')[0].toUpperCase();
      if (LANG === 'zh-TW') code = 'ZH-TW';
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'wfLangBtn'; b.className = 'wf-langbtn notranslate';
      b.setAttribute('translate', 'no');
      b.setAttribute('aria-label', 'Language');
      b.textContent = '🌐 ' + code;
      slot.appendChild(b);

      var lm = document.createElement('div');
      lm.className = 'wf-lm notranslate'; lm.setAttribute('translate', 'no');
      lm.setAttribute('role', 'dialog'); lm.setAttribute('aria-modal', 'true');
      lm.innerHTML = '<div class="box"><div class="hd"><span>🌐 Language</span>' +
        '<button type="button" aria-label="Close">×</button></div><ul></ul></div>';
      var ul = lm.querySelector('ul');
      LANGS.forEach(function (l) {
        var li = document.createElement('li');
        var item = document.createElement('button');
        item.type = 'button';
        item.textContent = l[1];
        item.setAttribute('lang', l[0] === 'iw' ? 'he' : l[0]);
        if (RTL[l[0]]) item.setAttribute('dir', 'rtl');
        if (l[0] === LANG) item.className = 'cur';
        item.addEventListener('click', function () {
          storeLang(l[0]);
          if (l[0] === LANG) { close(); return; }
          location.reload();
        });
        li.appendChild(item);
        ul.appendChild(li);
      });
      document.body.appendChild(lm);
      function close() { lm.classList.remove('show'); }
      b.addEventListener('click', function () {
        lm.classList.add('show');
        var cur = ul.querySelector('.cur');
        if (cur) cur.scrollIntoView({ block: 'center' });
      });
      lm.querySelector('.hd button').addEventListener('click', close);
      lm.addEventListener('click', function (e) { if (e.target === lm) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
