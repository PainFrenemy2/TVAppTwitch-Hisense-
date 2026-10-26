/* Ядро приложения: слои, переходы между страницами, боковое меню, избранное, обработка пульта */
(function () {
  'use strict';
  var h = U.h;

  var App = {
    VERSION: '1.0.0',
    layers: [],
    history: [],
    pendingFocus: false
  };
  window.App = App;

  // ---------- масштаб: интерфейс рисуется в rem, 1920px = 120rem ----------
  App.applyScale = function () {
    var w = window.innerWidth || 1920;
    var hgt = window.innerHeight || 1080;
    // если экран не 16:9 — подгоняем по меньшей стороне
    var base = Math.min(w / 120, hgt / 67.5);
    var rem = base * (parseInt(Settings.get('scale'), 10) || 100) / 100;
    document.documentElement.style.fontSize = rem + 'px';
    Nav.rem = rem;
  };

  // ---------- избранное ----------
  App.favs = function () { return U.store.get('favs', []); };
  App.setFavs = function (list) { U.store.set('favs', list); };
  App.isFav = function (login) { return !!login && App.favs().indexOf(login.toLowerCase()) >= 0; };
  App.toggleFav = function (login) {
    login = login.toLowerCase();
    var list = App.favs();
    var i = list.indexOf(login);
    if (i >= 0) { list.splice(i, 1); UI.toast('Удалено из избранного'); }
    else { list.unshift(login); UI.toast('Добавлено в избранное'); }
    App.setFavs(list);
    return i < 0;
  };

  // ---------- элементы для плеера ----------
  function gname(g) { return g ? (g.displayName || g.name || '') : ''; }

  App.itemFromStream = function (s) {
    var b = s.broadcaster || {};
    return { kind: 'live', login: b.login, name: b.displayName, avatar: b.profileImageURL, title: s.title, game: gname(s.game),
      viewers: s.viewersCount, createdAt: s.createdAt, roomId: b.id };
  };
  App.itemFromVideo = function (v) {
    var o = v.owner || {};
    return { kind: 'vod', id: v.id, login: o.login, name: o.displayName, avatar: o.profileImageURL, title: v.title, game: gname(v.game),
      views: v.viewCount, createdAt: v.createdAt, length: v.lengthSeconds };
  };
  App.itemFromClip = function (c) {
    var b = c.broadcaster || {};
    return { kind: 'clip', slug: c.slug, id: c.id, login: b.login, name: b.displayName, avatar: b.profileImageURL, title: c.title,
      game: gname(c.game), views: c.viewCount, createdAt: c.createdAt, length: c.durationSeconds };
  };
  App.itemFrom = function (d) {
    if (!d) return null;
    if (d.slug) return App.itemFromClip(d);
    if (d.lengthSeconds !== undefined) return App.itemFromVideo(d);
    if (d.viewersCount !== undefined && d.broadcaster) return App.itemFromStream(d);
    return null;
  };

  App.play = function (item, playlist) { Player.open(item, playlist); };

  // Плейлист = все карточки того же ряда: CH+/CH− листают эфиры как телеканалы
  App.playFromCard = function (card) {
    var me = App.itemFrom(card._data);
    if (!me) return;
    var items = [], idx = 0;
    Array.prototype.forEach.call(card.parentNode.children, function (c) {
      var it = c === card ? me : App.itemFrom(c._data);
      if (!it || it.kind !== me.kind) return;
      if (c === card) idx = items.length;
      items.push(it);
    });
    Player.open(items[idx], items);
  };

  // ---------- слои (страницы → модальные окна/плеер поверх) ----------
  App.topLayer = function () { return App.layers[App.layers.length - 1]; };

  App.openLayer = function (layer) {
    var top = App.topLayer();
    if (top) top.lastFocus = Nav.current;
    if (!layer.inPlace) (layer.root || document.body).appendChild(layer.el);
    App.layers.push(layer);
    Nav.blur();
    Nav.setScope(layer.scope || layer.el);
    if (layer.focus) Nav.focus(layer.focus);
  };

  App.closeLayer = function () {
    if (App.layers.length < 2) return;
    var layer = App.layers.pop();
    Nav.blur();
    if (!layer.inPlace && layer.el.parentNode) layer.el.parentNode.removeChild(layer.el);
    if (layer.onClose) layer.onClose();
    var top = App.topLayer();
    Nav.setScope(top.scope || top.el);
    if (top.lastFocus && top.lastFocus.isConnected && top.lastFocus.offsetParent !== null) Nav.focus(top.lastFocus, { noScroll: true });
    else if (top === App.base) App.refocus(true);
    else if (top.el === Player.el) { /* плеер сам покажет OSD */ }
  };

  // ---------- боковое меню ----------
  var SIDE = [
    ['search', 'search', 'Поиск'],
    ['home', 'home', 'Главная'],
    ['browse', 'browse', 'Категории'],
    ['following', 'following', 'Избранное'],
    ['settings', 'settings', 'Настройки']
  ];
  var sidebar, pagesEl;

  function buildSidebar() {
    sidebar = U.$('#sidebar');
    sidebar.innerHTML = '';
    sidebar.appendChild(h('div.side-logo', { html: '<img src="icons/glitch.svg" alt=""><span>Twitch</span>' }));
    var list = h('div.side-list');
    SIDE.forEach(function (s) {
      var it = h('div.side-item.focusable', { 'data-page': s[0], html: UI.icon(s[1]) + '<span class="side-label">' + s[2] + '</span>' });
      it._onclick = function () { App.go(s[0], {}, { root: true }); };
      list.appendChild(it);
    });
    sidebar.appendChild(list);
  }

  function inSidebar(el) { return !!el && sidebar.contains(el); }

  function activeSideItem() {
    var cur = App.history[App.history.length - 1];
    var name = cur && cur.page.nav;
    return U.$('.side-item[data-page="' + (name || 'home') + '"]', sidebar) || U.$('.side-item', sidebar);
  }

  function markSidebar() {
    U.$$('.side-item', sidebar).forEach(function (i) { i.classList.remove('active'); });
    var cur = App.history[App.history.length - 1];
    if (cur && cur.page.nav) {
      var a = U.$('.side-item[data-page="' + cur.page.nav + '"]', sidebar);
      if (a) a.classList.add('active');
    }
  }

  // ---------- страницы ----------
  function currentPage() { var e = App.history[App.history.length - 1]; return e && e.page; }

  App.go = function (name, params, opts) {
    opts = opts || {};
    params = params || {};
    if (Player.isOpen()) Player.close();
    while (App.layers.length > 1) App.closeLayer();
    var cur = App.history[App.history.length - 1];
    if (opts.root) {
      if (cur && cur.name === name && App.history.length === 1) {
        // повторный выбор того же раздела — просто вернуться в контент
        focusPage(cur.page);
        return;
      }
      App.history.forEach(function (e) { removePage(e.page); });
      App.history = [];
    } else if (cur) {
      cur.page.lastFocus = inSidebar(Nav.current) ? cur.page.lastFocus : Nav.current;
      cur.page.el.classList.add('hidden');
      if (cur.page.onHide) cur.page.onHide();
    }
    var page = Pages[name](params);
    pagesEl.appendChild(page.el);
    App.history.push({ name: name, params: params, page: page });
    markSidebar();
    focusPage(page, true);
  };

  App.replace = function (name, params) {
    var cur = App.history.pop();
    if (cur) removePage(cur.page);
    App.go(name, params, { root: !App.history.length });
  };

  function removePage(page) {
    if (page.onHide) page.onHide();
    if (page.destroy) page.destroy();
    if (page.el.parentNode) page.el.parentNode.removeChild(page.el);
  }

  function focusPage(page, fresh) {
    Nav.setScope(App.base.el);
    var target = null;
    if (!fresh && page.lastFocus && page.lastFocus.isConnected && page.lastFocus.offsetParent !== null) target = page.lastFocus;
    if (!target) target = page.firstFocus ? page.firstFocus() : Nav.focusables(page.el)[0];
    if (target) { Nav.focus(target); App.pendingFocus = false; }
    else {
      Nav.focus(activeSideItem());
      App.pendingFocus = true;
      clearTimeout(App._pfTimer);
      App._pfTimer = setTimeout(function () {
        if (!App.pendingFocus) return;
        App.pendingFocus = false;
        var f = U.$('.card.focusable', page.el) || Nav.focusables(page.el)[0];
        if (f && inSidebar(Nav.current) && App.topLayer() === App.base) Nav.focus(f);
      }, 5000);
    }
  }

  // Вызывается после асинхронной загрузки: ставит фокус, если он «потерялся» или ждал контент
  App.refocus = function (force) {
    if (App.topLayer() !== App.base) return;
    var page = currentPage();
    if (!page) return;
    var cur = Nav.current;
    var lost = !cur || !cur.isConnected || cur.offsetParent === null;
    if (App.pendingFocus || lost || force) {
      var t = page.firstFocus ? page.firstFocus() : Nav.focusables(page.el)[0];
      if (!t && !App.pendingFocus) t = Nav.focusables(page.el)[0];
      if (t) { App.pendingFocus = false; Nav.focus(t); }
      else if (lost) Nav.focus(activeSideItem());
    } else if (cur && page.el.contains(cur)) {
      Nav.reveal(cur); // контент выше мог сдвинуться
    }
  };

  App.back = function () {
    if (App.history.length > 1) {
      var cur = App.history.pop();
      removePage(cur.page);
      var prev = App.history[App.history.length - 1];
      prev.page.el.classList.remove('hidden');
      if (prev.page.onShow) prev.page.onShow();
      markSidebar();
      focusPage(prev.page);
      return;
    }
    if (!inSidebar(Nav.current)) { Nav.focus(activeSideItem()); return; }
    var page = currentPage();
    if (page && page.nav !== 'home') { App.go('home', {}, { root: true }); return; }
    UI.confirm('Выйти из Twitch TV?', null, 'Выйти', App.exit);
  };

  App.exit = function () {
    try { if (window.Hisense_closeApp) window.Hisense_closeApp(); } catch (e) { /* нет API */ }
    try { window.close(); } catch (e2) { /* ignore */ }
    setTimeout(function () { try { history.go(-(history.length - 1)); } catch (e3) { /* ignore */ } }, 300);
  };

  // ---------- клавиши ----------
  var lastBackAt = 0;

  function onKeyDown(e) {
    var k = Nav.keyName(e);
    if (k) { e.preventDefault(); e.stopPropagation(); }
    if (k === 'BACK') lastBackAt = Date.now();
    App.pendingFocus = false;
    var layer = App.topLayer();
    if (layer.onKey && layer.onKey(k, e)) return;
    if (layer === App.base) {
      var page = currentPage();
      if (page && page.onKey && page.onKey(k, e)) return;
    }
    if (!k) return;
    var cur = Nav.current;
    if (cur && cur._onkey && cur._onkey(k)) return;

    switch (k) {
      case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT':
        moveFocus(k.toLowerCase(), layer);
        break;
      case 'ENTER':
        if (cur && cur._onclick) cur._onclick(cur);
        else if (!cur) Nav.move('down');
        break;
      case 'BACK':
        if (layer !== App.base) App.closeLayer();
        else App.back();
        break;
    }
  }

  function moveFocus(dir, layer) {
    var cur = Nav.current;
    if (layer === App.base && inSidebar(cur)) {
      if (dir === 'right') {
        var page = currentPage();
        if (page) {
          var t = page.lastFocus && page.lastFocus.isConnected && page.lastFocus.offsetParent !== null ? page.lastFocus : null;
          if (!t) t = page.firstFocus ? page.firstFocus() : null;
          if (!t) t = Nav.focusables(page.el)[0];
          if (t) Nav.focus(t);
        }
        return;
      }
      if (dir === 'left') return;
      var prevScope = Nav.scope;
      Nav.setScope(sidebar);
      Nav.move(dir);
      Nav.setScope(prevScope);
      return;
    }
    var moved = Nav.move(dir);
    if (layer === App.base && Nav.current && inSidebar(Nav.current) && !inSidebar(cur)) {
      // уход в меню: запоминаем место в контенте, подсвечиваем текущий раздел
      var p = currentPage();
      if (p) p.lastFocus = cur;
      Nav.focus(activeSideItem());
    } else if (!moved && dir === 'left' && layer === App.base) {
      var p2 = currentPage();
      if (p2) p2.lastFocus = cur;
      Nav.focus(activeSideItem());
    }
  }

  // Двойная защита кнопки «Назад»: некоторые прошивки сначала делают history.back()
  function trapHistory() {
    try {
      history.pushState({ ttv: 1 }, '');
      window.addEventListener('popstate', function () {
        history.pushState({ ttv: 1 }, '');
        if (Date.now() - lastBackAt < 400) return;
        onKeyDown({ keyCode: 8, key: 'GoBack', preventDefault: function () {}, stopPropagation: function () {} });
      });
    } catch (e) { /* ignore */ }
  }

  // ---------- старт ----------
  function startClock() {
    var c = h('div.clock');
    document.getElementById('app').appendChild(c);
    var tick = function () { c.textContent = U.clock(); };
    tick();
    setInterval(tick, 15000);
  }

  function init() {
    App.applyScale();
    window.addEventListener('resize', App.applyScale);
    buildSidebar();
    pagesEl = U.$('#pages');
    App.base = { el: U.$('#app'), scope: U.$('#app') };
    App.layers = [App.base];
    Nav.onChange = function (el) {
      U.$('#app').classList.toggle('side-open', inSidebar(el) && App.topLayer() === App.base);
    };
    Chat.init();
    Player.init();
    startClock();
    document.addEventListener('keydown', onKeyDown, true);
    trapHistory();

    // ТВ свернул приложение — ставим на паузу, при возврате эфир перезапускаем с «живой» точки
    document.addEventListener('visibilitychange', function () {
      if (!Player.isOpen()) return;
      if (document.hidden) { try { Player.video.pause(); } catch (e) { /* ignore */ } }
      else if (Player.item && Player.item.kind === 'live') Player.open(Player.item, Player.playlist);
      else { try { Player.video.play(); } catch (e2) { /* ignore */ } }
    });

    // клики мышью/указкой (у некоторых пультов Hisense есть режим курсора)
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.focusable') : null;
      if (!t) return;
      Nav.focus(t, { noScroll: !!t.closest('.shelf-track') && false });
      if (t._onclick) t._onclick(t);
    });

    var start = (location.hash || '').replace('#', '');
    App.go(Pages[start] && start !== 'channel' && start !== 'game' ? start : 'home', {}, { root: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
