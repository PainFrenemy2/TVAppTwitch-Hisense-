/* Навигация пультом: коды клавиш VIDAA и пространственная навигация по элементам .focusable */
(function () {
  'use strict';

  var K = {
    LEFT: [37], UP: [38], RIGHT: [39], DOWN: [40],
    ENTER: [13, 29443, 65376],
    BACK: [8, 27, 461, 10009, 166],
    PLAY: [415, 250],
    PAUSE: [19],
    PLAYPAUSE: [179, 463, 10252, 85],
    STOP: [413, 178],
    FF: [417, 228, 176],
    RW: [412, 227, 177],
    RED: [403], GREEN: [404], YELLOW: [405], BLUE: [406],
    CH_UP: [427, 33], CH_DOWN: [428, 34],
    INFO: [457]
  };

  var codeToName = {};
  Object.keys(K).forEach(function (name) { K[name].forEach(function (c) { codeToName[c] = name; }); });

  var Nav = {
    current: null,
    scope: document.body,
    keyName: function (e) {
      var n = codeToName[e.keyCode];
      if (n) return n;
      switch (e.key) {
        case 'ArrowLeft': return 'LEFT';
        case 'ArrowRight': return 'RIGHT';
        case 'ArrowUp': return 'UP';
        case 'ArrowDown': return 'DOWN';
        case 'Enter': return 'ENTER';
        case 'Escape': case 'GoBack': case 'BrowserBack': return 'BACK';
        case 'MediaPlayPause': return 'PLAYPAUSE';
        case 'MediaPlay': return 'PLAY';
        case 'MediaPause': return 'PAUSE';
        case 'MediaStop': return 'STOP';
        case 'MediaFastForward': return 'FF';
        case 'MediaRewind': return 'RW';
      }
      return null;
    }
  };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    return !el.classList.contains('disabled');
  }

  Nav.focusables = function (scope) {
    return U.$$('.focusable', scope || Nav.scope).filter(visible);
  };

  Nav.setScope = function (el) { Nav.scope = el; };

  Nav.focus = function (el, opts) {
    if (!el) return;
    var prev = Nav.current;
    if (prev && prev !== el) {
      prev.classList.remove('focused');
      if (prev._onblur) prev._onblur(prev);
    }
    Nav.current = el;
    el.classList.add('focused');
    // запоминаем последний элемент в «группе» (полка, сетка, меню) — как в YouTube TV
    var group = el.closest('[data-group]');
    if (group) group._last = el;
    if (!opts || !opts.noScroll) Nav.reveal(el);
    if (el._onfocus) el._onfocus(el);
    if (Nav.onChange) Nav.onChange(el);
  };

  Nav.blur = function () {
    if (Nav.current) {
      Nav.current.classList.remove('focused');
      if (Nav.current._onblur) Nav.current._onblur(Nav.current);
    }
    Nav.current = null;
    if (Nav.onChange) Nav.onChange(null);
  };

  // Прокрутка: полка по горизонтали — сфокусированная карточка встаёт к левому краю;
  // страница по вертикали — строка с фокусом встаёт под заголовок.
  Nav.reveal = function (el) {
    var track = el.closest('.shelf-track');
    if (track) {
      var first = track.firstElementChild;
      var x = el.offsetLeft - (first ? first.offsetLeft : 0);
      var max = track.scrollWidth - track.parentNode.clientWidth;
      if (max < 0) max = 0;
      if (x > max) x = max;
      if (x < 0) x = 0;
      track.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
      // заранее грузим превью следующих карточек, чтобы при листании не было пустых мест
      var sib = el, n = 0;
      while (sib && n++ < 7) {
        U.$$('img[data-src]', sib).forEach(function (img) { img.src = img.dataset.src; img.removeAttribute('data-src'); });
        sib = sib.nextElementSibling;
      }
      if (track._onscroll) track._onscroll(el);
    }
    var hs = el.closest('.h-scroll');
    if (hs && !track) {
      var inner = hs.firstElementChild;
      var vw = hs.clientWidth;
      var l = el.offsetLeft, w = el.offsetWidth;
      var cur = inner._x || 0;
      if (l - cur < 0) cur = l;
      else if (l + w - cur > vw) cur = l + w - vw;
      inner._x = cur;
      inner.style.transform = 'translate3d(' + (-cur) + 'px,0,0)';
    }
    var vs = el.closest('.v-scroll');
    if (vs) {
      var content = vs.firstElementChild;
      var row = el.closest('.row') || el;
      var top = U.offsetWithin(row, content).top;
      var viewH = vs.clientHeight;
      var maxY = Math.max(0, content.scrollHeight - viewH);
      var y;
      if (vs.classList.contains('v-center')) {
        y = top + row.offsetHeight / 2 - viewH / 2;
      } else {
        // крутим, только если строка не помещается целиком; тогда ставим её к верху (как в YouTube TV)
        var pad = parseFloat(vs.dataset.pad || '0') * Nav.rem;
        var cur = vs._y || 0;
        var bottom = top + row.offsetHeight;
        if (top - pad < cur || bottom > cur + viewH - pad) y = top - pad;
        else y = cur;
      }
      if (row.dataset.top === '1') y = 0;
      if (y > maxY) y = maxY;
      if (y < 0) y = 0;
      content.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
      vs._y = y;
    }
    // подгрузка следующей страницы
    var more = el.closest('[data-more]');
    if (more && more._loadMore) {
      var items = more._items ? more._items() : [];
      var idx = items.indexOf(el);
      if (idx >= 0 && idx >= items.length - (more._threshold || 8)) { var pr = more._loadMore(); if (pr && pr.catch) pr.catch(function () {}); }
    }
  };

  Nav.rem = 16;

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  Nav.move = function (dir) {
    var cur = Nav.current;
    var inScope = cur && cur.isConnected && Nav.scope.contains(cur) && visible(cur);
    // быстрый путь — без сбора и замера всех элементов страницы
    if (inScope && !cur.hasAttribute('data-nav-' + dir)) {
      var fast = fastMove(cur, dir);
      if (fast === cur) return true;
      if (fast) { Nav.focus(fast); return true; }
    }
    var list = Nav.focusables();
    if (!cur || list.indexOf(cur) < 0) {
      if (list.length) Nav.focus(list[0]);
      return !!list.length;
    }
    // явные переходы: data-nav-left="#id" и т.п.
    var explicit = cur.getAttribute('data-nav-' + dir);
    if (explicit) {
      if (explicit === 'none') return true;
      var tgt = U.$(explicit, Nav.scope);
      if (tgt && visible(tgt)) {
        var g = tgt.hasAttribute('data-group') ? tgt : null;
        Nav.focus(g && g._last && visible(g._last) ? g._last : (g ? Nav.focusables(g)[0] : tgt));
        return true;
      }
    }

    return fullMove(cur, dir, list);
  };

  // Быстрый путь (слабый процессор ТВ): по полке влево/вправо — просто соседняя карточка,
  // вверх/вниз с полки — ищем только в соседнем ряду. Полный перебор всех элементов — только на краях.

  function focusableIn(el) { return el.classList.contains('focusable') && visible(el); }

  function fastMove(cur, dir) {
    var track = cur.parentNode && cur.parentNode.classList && cur.parentNode.classList.contains('shelf-track') ? cur.parentNode : null;
    if (!track) return null;
    if (dir === 'left' || dir === 'right') {
      var sib = dir === 'right' ? cur.nextElementSibling : cur.previousElementSibling;
      while (sib && !focusableIn(sib)) sib = dir === 'right' ? sib.nextElementSibling : sib.previousElementSibling;
      // правый край полки — остаёмся на месте (не прыгаем в соседний ряд); левый край решает полный перебор —
      // так уходят в боковое меню
      if (!sib && dir === 'right' && !track.closest('.osd-next')) return cur;
      return sib;
    }
    // вверх/вниз: соседняя полка в том же контейнере
    var shelf = cur.closest('.shelf');
    if (!shelf || !shelf.parentNode) return null;
    var row = shelf;
    for (var hop = 0; hop < 3; hop++) {
      row = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
      if (!row) return null;
      var items = Nav.focusables(row);
      if (!items.length) continue;
      // не полка (баннер, сетка, кнопки) — пусть решает полный перебор
      if (!row.classList.contains('shelf')) return null;
      // в той полке уже были — возвращаемся к той же карточке (как в YouTube TV)
      if (row._last && row._last.isConnected && visible(row._last)) return row._last;
      // иначе — ближайшая по горизонтали к текущей
      var cx = cur.getBoundingClientRect().left, best = null, bd = Infinity;
      for (var i = 0; i < items.length; i++) {
        var d = Math.abs(items[i].getBoundingClientRect().left - cx);
        if (d < bd) { bd = d; best = items[i]; }
        else if (best) break; // карточки идут слева направо — дальше только дальше
      }
      return best;
    }
    return null;
  }

  function fullMove(cur, dir, list) {
    var a = cur.getBoundingClientRect();
    var ac = center(a);
    var best = null, bestScore = Infinity;
    var horizontal = dir === 'left' || dir === 'right';
    var curGroup = cur.closest('[data-group]');

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var b = el.getBoundingClientRect();
      var bc = center(b);
      var primary, overlap, secondary;
      if (dir === 'left') { primary = a.left - b.right; if (bc.x >= ac.x - 1) continue; }
      else if (dir === 'right') { primary = b.left - a.right; if (bc.x <= ac.x + 1) continue; }
      else if (dir === 'up') { primary = a.top - b.bottom; if (bc.y >= ac.y - 1) continue; }
      else { primary = b.top - a.bottom; if (bc.y <= ac.y + 1) continue; }
      if (primary < -a.height / 2 && !horizontal) primary = Math.abs(primary) * 3;
      if (primary < 0) primary = 0;
      if (horizontal) {
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        secondary = overlap > 0 ? 0 : Math.abs(bc.y - ac.y);
      } else {
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        secondary = overlap > 0 ? 0 : Math.min(Math.abs(b.left - a.left), Math.abs(bc.x - ac.x));
      }
      var score = primary + secondary * (horizontal ? 4 : 1.2);
      // по горизонтали предпочитаем оставаться в своей группе (полке)
      if (horizontal && curGroup && el.closest('[data-group]') !== curGroup) score += 400;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;

    // при переходе в другую группу восстанавливаем запомненный там элемент
    var tg = best.closest('[data-group]');
    if (tg && tg !== curGroup && tg._last && visible(tg._last) && tg.dataset.group !== 'free') best = tg._last;
    Nav.focus(best);
    return true;
  }

  window.Nav = Nav;
})();
