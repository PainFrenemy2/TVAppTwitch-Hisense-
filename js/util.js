/* Общие утилиты. Код намеренно без optional chaining / ?? — браузер VIDAA бывает старым. */
(function () {
  'use strict';

  var U = {};

  // Node.isConnected появился в Chromium 54 — на старых прошивках VIDAA подставляем свой
  if (window.Node && !('isConnected' in Node.prototype)) {
    Object.defineProperty(Node.prototype, 'isConnected', {
      get: function () { return document.documentElement.contains(this); }
    });
  }

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // h('div.card.focusable', {attrs}, [children]) — маленький конструктор DOM
  U.h = function (tag, attrs, children) {
    var parts = tag.split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') el['_' + k] = v;
        else if (k === 'data') { for (var d in v) el.dataset[d] = v[d]; }
        else el.setAttribute(k, v);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return el;
  };

  U.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // --- хранилище ---
  // Основное — localStorage. Каждая запись дублируется в IndexedDB: некоторые прошивки VIDAA
  // при выходе из приложения теряют localStorage (или не успевают сбросить его на диск),
  // и тогда при следующем запуске мы восстанавливаем данные (вход, настройки, место) из копии.
  var PREFIX = 'ttv.';
  var mem = {};
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] === undefined ? null : mem[k]; } }
  function lsSet(k, v) { mem[k] = v; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  var Backup = { db: null, waiting: [], failed: false, ready: false };
  Backup.open = function (cb) {
    if (Backup.db) return cb(Backup.db);
    if (Backup.failed || !window.indexedDB) return cb(null);
    Backup.waiting.push(cb);
    if (Backup.waiting.length > 1) return;
    var done = function (db) { Backup.db = db; Backup.failed = !db; var w = Backup.waiting; Backup.waiting = []; w.forEach(function (f) { f(db); }); };
    try {
      var req = indexedDB.open('ttv-backup', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { done(req.result); };
      req.onerror = req.onblocked = function () { done(null); };
    } catch (e) { done(null); }
  };
  // запись пачкой: несколько set подряд — одна транзакция
  var pending = {}, flushTimer = null;
  Backup.put = function (k, v) {
    pending[k] = v;
    if (flushTimer) return;
    flushTimer = setTimeout(Backup.flush, 50);
  };
  Backup.flush = function () {
    clearTimeout(flushTimer); flushTimer = null;
    // пока не проверили, не стёр ли ТВ данные, копию не трогаем — иначе свежий пустой запуск затрёт её
    if (!Backup.ready) return;
    var batch = pending; pending = {};
    if (!Object.keys(batch).length) return;
    Backup.open(function (db) {
      if (!db) return;
      try {
        var st = db.transaction('kv', 'readwrite').objectStore('kv');
        Object.keys(batch).forEach(function (k) { st.put(batch[k], k); });
      } catch (e) { /* нет места */ }
    });
  };
  Backup.all = function (cb) {
    Backup.open(function (db) {
      if (!db) return cb({});
      var out = {};
      try {
        var req = db.transaction('kv', 'readonly').objectStore('kv').openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (c) { out[c.key] = c.value; c.continue(); } else cb(out);
        };
        req.onerror = function () { cb(out); };
      } catch (e) { cb(out); }
    });
  };

  // Какие ключи были в localStorage при запуске — до того, как модули ниже что-то запишут
  var initialKeys = {};
  try { for (var i = 0; i < localStorage.length; i++) initialKeys[localStorage.key(i)] = 1; } catch (e) { /* нет доступа */ }

  U.store = {
    get: function (key, def) {
      var v = lsGet(PREFIX + key);
      if (v === null) return def;
      try { return JSON.parse(v); } catch (e) { return def; }
    },
    set: function (key, val) {
      var s = JSON.stringify(val);
      lsSet(PREFIX + key, s);
      Backup.put(PREFIX + key, s);
    },
    flush: function () { Backup.flush(); },
    // При запуске (параллельно, не задерживая интерфейс): если каких-то сохранённых ключей нет в localStorage,
    // а в копии они есть — ТВ стёр данные. Возвращаем их и перезапускаемся (обычно ещё под заставкой).
    // При запуске, пока видна заставка: если каких-то сохранённых ключей нет в localStorage, а в копии они есть —
    // ТВ стёр данные. Возвращаем их и перезапускаемся. cb(true) — идёт перезапуск, дальше ничего не делать.
    // Ждём копию не дольше 700 мс; опоздавший ответ игнорируем, чтобы не перезапускать уже работающее приложение.
    restore: function (cb) {
      if (/[?&]restored=1/.test(location.search)) { Backup.ready = true; Backup.flush(); return cb(false); }
      var done = false;
      // интерфейс ждёт не дольше 700 мс; копия при этом запишется только после проверки
      var timer = setTimeout(function () { done = true; cb(false); }, 700);
      Backup.all(function (all) {
        var lost = Object.keys(all).filter(function (k) { return k.indexOf(PREFIX) === 0 && !initialKeys[k]; });
        if (done) {
          // копия ответила поздно, приложение уже работает: перезапускать не будем, но и копию не затираем —
          // недостающие ключи вернём в localStorage, они подхватятся при следующем запуске
          lost.forEach(function (k) { if (lsGet(k) === null) lsSet(k, all[k]); });
          Backup.ready = true; Backup.flush();
          return;
        }
        done = true;
        clearTimeout(timer);
        var ok = lost.length > 0;
        lost.forEach(function (k) { if (!lsSet(k, all[k])) ok = false; });
        Backup.ready = true;
        if (!ok) { Backup.flush(); return cb(false); }
        location.replace(location.pathname + (location.search ? location.search + '&' : '?') + 'restored=1' + location.hash);
        cb(true);
      });
    }
  };
  // базу открываем сразу, чтобы к проверке при запуске она уже была готова
  Backup.open(function () {});

  // при уходе из приложения дописываем копию сразу
  window.addEventListener('pagehide', Backup.flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) Backup.flush(); });

  // --- форматирование (слова — на языке интерфейса, см. i18n.js) ---
  U.num = function (n) {
    n = n || 0;
    var w = I18N.words(), dot = /^(en|ja|ko|th|zh)/.test(I18N.lang);
    var f = function (x, d) { var t = x.toFixed(d); if (!dot) t = t.replace('.', ','); return t.replace(/[.,]0$/, ''); };
    if (w.wan) return n >= 1e4 ? f(n / 1e4, n >= 1e5 ? 0 : 1) + w.wan : String(n); // 万: 1,2万
    if (n >= 1e6) return f(n / 1e6, n >= 1e7 ? 0 : 1) + w.m;
    if (n >= 1e3) return f(n / 1e3, n >= 1e4 ? 0 : 1) + w.k;
    return String(n);
  };

  // дробное число по правилам языка: 2,05 / 2.05
  U.dec = function (x, d) {
    var t = Number(x).toFixed(d);
    return /^(en|ja|ko|th|zh)/.test(I18N.lang) ? t : t.replace('.', ',');
  };

  U.viewers = function (n) {
    n = n || 0;
    var W = I18N.words(), w = W.viewer;
    return U.num(n) + (W.sep === undefined ? ' ' : W.sep) + (n >= 1000 ? w[w.length - 1] : I18N.plural(n, w));
  };

  U.views = function (n) {
    n = n || 0;
    var W = I18N.words(), w = W.view;
    return U.num(n) + (W.sep === undefined ? ' ' : W.sep) + (n >= 1000 ? w[w.length - 1] : I18N.plural(n, w));
  };

  U.pad = function (n) { return n < 10 ? '0' + n : String(n); };

  U.duration = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(s);
  };

  U.ago = function (iso) {
    if (!iso) return '';
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    var w = I18N.words();
    if (d < 60) return w.now;
    var secs = [31536000, 2592000, 604800, 86400, 3600, 60];
    for (var i = 0; i < secs.length; i++) {
      var n = Math.floor(d / secs[i]);
      if (n >= 1) return (w.pre || '') + n + (w.sep === undefined ? ' ' : w.sep) + I18N.plural(n, w.units[i]) + w.ago;
    }
    return '';
  };

  // Сколько идёт эфир: "2:15:03"
  U.uptime = function (iso) {
    if (!iso) return '';
    return U.duration((Date.now() - new Date(iso).getTime()) / 1000);
  };

  U.clock = function () {
    var d = new Date();
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  };

  // Promise.all, но не больше n задач одновременно — чтобы не заваливать сеть ТВ пачкой запросов
  U.pool = function (items, n, fn) {
    var out = new Array(items.length), i = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(items[k], k)).then(function (r) { out[k] = r; }, function () { out[k] = undefined; }).then(worker);
    }
    var ws = [];
    for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  };

  U.uid = function (len) {
    var s = '', c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < (len || 32); i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  };

  // Подстановка размера в шаблоны картинок Twitch ({width}x{height})
  U.img = function (url, w, hgt) {
    if (!url) return '';
    return url.replace('{width}', w).replace('{height}', hgt).replace('%{width}', w).replace('%{height}', hgt);
  };

  // Сумма offsetTop до заданного предка (без учёта transform — геометрия раскладки)
  U.offsetWithin = function (el, ancestor) {
    var top = 0, left = 0;
    while (el && el !== ancestor) {
      top += el.offsetTop;
      left += el.offsetLeft;
      el = el.offsetParent;
    }
    return { top: top, left: left };
  };

  window.U = U;
})();
