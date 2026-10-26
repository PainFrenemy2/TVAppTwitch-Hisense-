/* Общие утилиты. Код намеренно без optional chaining / ?? — браузер VIDAA бывает старым. */
(function () {
  'use strict';

  var U = {};

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
  U.store = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem('ttv.' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (key, val) {
      try { localStorage.setItem('ttv.' + key, JSON.stringify(val)); } catch (e) { /* нет места */ }
    }
  };

  // --- форматирование ---
  U.plural = function (n, one, few, many) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return many;
    if (n1 > 1 && n1 < 5) return few;
    if (n1 === 1) return one;
    return many;
  };

  U.num = function (n) {
    n = n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + ' млн';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',').replace(',0', '') + ' тыс.';
    return String(n);
  };

  U.viewers = function (n) {
    n = n || 0;
    return U.num(n) + ' ' + (n >= 1000 ? 'зрителей' : U.plural(n, 'зритель', 'зрителя', 'зрителей'));
  };

  U.views = function (n) {
    n = n || 0;
    return U.num(n) + ' ' + (n >= 1000 ? 'просмотров' : U.plural(n, 'просмотр', 'просмотра', 'просмотров'));
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
    if (d < 60) return 'только что';
    var units = [
      [31536000, 'год', 'года', 'лет'],
      [2592000, 'месяц', 'месяца', 'месяцев'],
      [604800, 'неделю', 'недели', 'недель'],
      [86400, 'день', 'дня', 'дней'],
      [3600, 'час', 'часа', 'часов'],
      [60, 'минуту', 'минуты', 'минут']
    ];
    for (var i = 0; i < units.length; i++) {
      var n = Math.floor(d / units[i][0]);
      if (n >= 1) return n + ' ' + U.plural(n, units[i][1], units[i][2], units[i][3]) + ' назад';
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
