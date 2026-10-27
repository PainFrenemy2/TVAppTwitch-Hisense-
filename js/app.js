/* Ядро приложения: слои, переходы между страницами, боковое меню, избранное, обработка пульта */
(function () {
  'use strict';
  var h = U.h;

  var App = {
    VERSION: '2.0.0',
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

  // ---------- облегчённый режим ----------
  // «Авто»: включаем на слабом железе (мало ядер/памяти) — без анимаций и живых превью
  App.isLite = function () {
    var v = Settings.get('lite');
    if (v === 'on') return true;
    if (v === 'off') return false;
    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    return cores <= 2 || mem < 1;
  };
  App.applyLite = function () { document.documentElement.classList.toggle('lite', App.isLite()); };

  // смена языка интерфейса — проще всего перезапуститься
  App.reload = function () { setTimeout(function () { location.reload(); }, 150); };

  // ---------- что знаем о телевизоре ----------
  App.tvInfo = function () {
    var ua = navigator.userAgent || '';
    var m = /(Hisense[^;)]*|VIDAA[^;)]*|HE\w*\d+\w*)/i.exec(ua);
    var chrome = /Chrome\/(\d+)/.exec(ua);
    var sup = Twitch.codecSupport();
    var conn = navigator.connection || {};
    return [
      [tr('Модель / браузер'), (m ? m[1].trim() + ' • ' : '') + (chrome ? 'Chromium ' + chrome[1] : ua.slice(0, 60))],
      [tr('Экран'), (screen.width || 0) + '×' + (screen.height || 0) + (window.devicePixelRatio && window.devicePixelRatio !== 1 ? ' @' + window.devicePixelRatio + 'x' : '')],
      [tr('Окно приложения'), window.innerWidth + '×' + window.innerHeight],
      [tr('Ядра процессора'), String(navigator.hardwareConcurrency || tr('нет данных'))],
      [tr('Память'), navigator.deviceMemory ? navigator.deviceMemory + ' GB' : tr('нет данных')],
      [tr('Видеокодеки'), 'H.264 ' + (sup.h264 ? '✓' : '✗') + '  HEVC ' + (sup.hevc ? '✓' : '✗') + '  AV1 ' + (sup.av1 ? '✓' : '✗')],
      [tr('Сеть'), conn.downlink ? conn.downlink + tr(' Мбит/с') + (conn.effectiveType ? ' (' + conn.effectiveType + ')' : '') : tr('нет данных')],
      [tr('Язык ТВ'), navigator.language || tr('нет данных')]
    ];
  };

  // Замер скорости: несколько параллельных загрузок файла с GitHub Pages без кэша
  App.speedTest = function () {
    var url = 'js/vendor/hls.min.js';
    var t0 = Date.now();
    var jobs = [];
    for (var i = 0; i < 4; i++) {
      jobs.push(fetch(url + '?speed=' + Date.now() + '_' + i, { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return b.byteLength; }));
    }
    return Promise.all(jobs).then(function (sizes) {
      var bytes = sizes.reduce(function (a, b) { return a + b; }, 0);
      var sec = Math.max(0.05, (Date.now() - t0) / 1000);
      return bytes * 8 / sec / 1e6;
    });
  };

  // ---------- заставка при запуске ----------
  var splashStart = Date.now();
  App.hideSplash = function () {
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('out')) return;
    var wait = Math.max(0, 1300 - (Date.now() - splashStart));
    setTimeout(function () {
      sp.classList.add('out');
      setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 500);
    }, wait);
  };

  // ---------- избранное ----------
  App.favs = function () { return U.store.get('favs', []); };
  App.setFavs = function (list) { U.store.set('favs', list); };
  App.isFav = function (login) { return !!login && App.favs().indexOf(login.toLowerCase()) >= 0; };
  App.toggleFav = function (login) {
    login = login.toLowerCase();
    var list = App.favs();
    var i = list.indexOf(login);
    if (i >= 0) { list.splice(i, 1); UI.toast(tr('Удалено из избранного')); }
    else { list.unshift(login); UI.toast(tr('Добавлено в избранное')); }
    App.setFavs(list);
    return i < 0;
  };

  // ---------- заблокированные каналы (локально: скрываются из всех списков, чата и «Другие каналы») ----------
  // список держим в памяти: isBlocked вызывается на каждое сообщение чата и каждую карточку
  var blockedList = U.store.get('blocked', []), blockedSet = {};
  blockedList.forEach(function (l) { blockedSet[l] = 1; });
  App.blocked = function () { return blockedList.slice(); };
  App.isBlocked = function (login) { return !!login && blockedSet[String(login).toLowerCase()] === 1; };
  App.setBlocked = function (login, on) {
    login = String(login).toLowerCase();
    blockedList = blockedList.filter(function (x) { return x !== login; });
    if (on) blockedList.unshift(login);
    blockedSet = {};
    blockedList.forEach(function (l) { blockedSet[l] = 1; });
    U.store.set('blocked', blockedList);
    if (on) UI.dropCards(login);
  };

  // «Сообщить о проблеме»: ссылка на новый issue в GitHub с данными о ТВ и о том, что смотрели
  App.ISSUES = 'https://github.com/PainFrenemy2/TVAppTwitch-Hisense-/issues/new';
  App.reportProblem = function (context) {
    var ua = navigator.userAgent || '';
    var m = /(Hisense[^;)]*|VIDAA[^;)]*)/i.exec(ua);
    var chrome = /Chrome\/(\d+)/.exec(ua);
    var body = 'v' + App.VERSION + ' | ' + (m ? m[1].trim() : 'TV') + ' | ' + (chrome ? 'Chromium ' + chrome[1] : '') + ' | ' + I18N.lang +
      (context ? ' | ' + context : '') + '\n\n';
    var url = App.ISSUES + '?title=' + encodeURIComponent(tr('Проблема: ')) + '&body=' + encodeURIComponent(body.slice(0, 300));
    UI.qrDialog(tr('Сообщить о проблеме'), tr('Наведите камеру телефона на QR-код и опишите, что случилось. Данные о ТВ и версии уже подставлены.'), url, 'github.com/PainFrenemy2/TVAppTwitch-Hisense-/issues');
  };

  // Все «мои» каналы: подписки аккаунта + локальное избранное
  App.myChannels = function () {
    var list = App.favs().slice();
    if (window.Auth && Auth.loggedIn()) Auth.cachedFollows().forEach(function (l) { if (list.indexOf(l) < 0) list.push(l); });
    return list;
  };

  // ---------- история просмотров ----------
  App.history_ = function () { return U.store.get('watchHistory', []); };
  App.addHistory = function (it) {
    if (!it || !it.login) return;
    var key = it.kind + ':' + (it.kind === 'live' ? it.login : (it.id || it.slug));
    var list = App.history_().filter(function (x) { return x.key !== key; });
    list.unshift({ key: key, kind: it.kind, login: it.login, name: it.name, avatar: it.avatar, id: it.id, slug: it.slug,
      title: it.title, thumb: it.thumb, length: it.length, game: it.game, roomId: it.roomId, createdAt: it.kind === 'live' ? null : it.createdAt, at: Date.now() });
    U.store.set('watchHistory', list.slice(0, 40));
  };

  // ---------- элементы для плеера ----------
  function gname(g) { return g ? (g.displayName || g.name || '') : ''; }

  App.itemFromStream = function (s) {
    var b = s.broadcaster || {};
    return { kind: 'live', login: b.login, name: b.displayName, avatar: b.profileImageURL, title: s.title, game: gname(s.game),
      viewers: s.viewersCount, createdAt: s.createdAt, roomId: b.id, thumb: s.previewImageURL };
  };
  App.itemFromVideo = function (v) {
    var o = v.owner || {};
    return { kind: 'vod', id: v.id, login: o.login, name: o.displayName, avatar: o.profileImageURL, title: v.title, game: gname(v.game),
      views: v.viewCount, createdAt: v.createdAt, length: v.lengthSeconds, thumb: v.previewThumbnailURL };
  };
  App.itemFromClip = function (c) {
    var b = c.broadcaster || {};
    return { kind: 'clip', slug: c.slug, id: c.id, login: b.login, name: b.displayName, avatar: b.profileImageURL, title: c.title,
      game: gname(c.game), views: c.viewCount, createdAt: c.createdAt, length: c.durationSeconds, thumb: c.thumbnailURL };
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
    var lf = top.lastFocus;
    var ok = lf && lf.isConnected && lf.offsetParent !== null;
    // закрыли плеер, а под ним фокус был в боковом меню (эфир открылся сразу при запуске) — ставим на контент.
    // Для обычных диалогов из меню (например, «Выйти?») фокус возвращается в меню.
    if (top === App.base && (!ok || (inSidebar(lf) && layer.el === Player.el))) App.refocus(true);
    else if (ok) Nav.focus(lf, { noScroll: true });
    else if (top.el === Player.el) { /* плеер сам покажет OSD */ }
    else { var f = Nav.focusables(top.scope || top.el)[0]; if (f) Nav.focus(f); } // запомненный элемент перестроили — первый в окне
  };

  // ---------- боковое меню ----------
  var SIDE = [
    ['search', 'search', tr('Поиск')],
    ['home', 'home', tr('Главная')],
    ['live', 'liveFeed', tr('Эфир')],
    ['browse', 'browse', tr('Категории')],
    ['clips', 'clip', tr('Клипы')],
    ['following', 'following', tr('Отслеживаемое')],
    ['history', 'history', tr('История')],
    ['settings', 'settings', tr('Настройки')]
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
    var acc = h('div.side-item.side-account.focusable', { 'data-page': 'account' });
    acc._onclick = function () { App.go('account', {}, { root: true }); };
    sidebar.appendChild(acc);
    App.updateAccountItem();
  }

  App.updateAccountItem = function () {
    var acc = U.$('.side-account', sidebar);
    if (!acc) return;
    var u = window.Auth && Auth.user();
    acc.innerHTML = (u && u.profileImageURL ? '<img class="side-avatar" src="' + U.esc(u.profileImageURL) + '" alt="">' : UI.icon('person')) +
      '<span class="side-label">' + U.esc(u ? u.displayName : tr('Войти')) + '</span>';
    acc.classList.toggle('needs-login', !!(window.Auth && Auth.needsLogin()));
  };

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
      if (cur && cur.name === name && App.history.length === 1 && !opts.force) {
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
    // не копим бесконечно скрытые страницы (память ТВ): держим не больше 6 шагов «назад»
    while (App.history.length > 6) removePage(App.history.splice(1, 1)[0].page);
    markSidebar();
    focusPage(page, true);
    App.saveState();
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
    if (target) { Nav.focus(target); App.pendingFocus = false; App.hideSplash(); }
    else {
      // страница ещё грузится: фокус не уводим в боковое меню (иначе оно на миг открывается и закрывается,
      // когда появляется контент) — просто ждём, App.refocus поставит фокус на первую карточку
      Nav.blur();
      App.pendingFocus = true;
      clearTimeout(App._pfTimer);
      App._pfTimer = setTimeout(function () {
        if (!App.pendingFocus) return;
        App.pendingFocus = false;
        var f = U.$('.card.focusable', page.el) || Nav.focusables(page.el)[0];
        if (App.topLayer() !== App.base || (Nav.current && !inSidebar(Nav.current))) return;
        Nav.focus(f || activeSideItem()); // пусто и через 5 с — тогда уже в меню
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
      if (t) { App.pendingFocus = false; Nav.focus(t); App.hideSplash(); }
      else if (lost && !App.pendingFocus) Nav.focus(activeSideItem());
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
      App.saveState();
      return;
    }
    var only = App.history[0];
    if (only && only.backHome) { App.go('home', {}, { root: true }); return; }
    if (!inSidebar(Nav.current)) { Nav.focus(activeSideItem()); return; }
    var page = currentPage();
    if (page && page.nav !== 'home') { App.go('home', {}, { root: true }); return; }
    UI.confirm(tr('Выйти из Twitch TV?'), null, tr('Выйти'), App.exit);
  };

  App.exit = function () {
    try { if (window.Hisense_closeApp) window.Hisense_closeApp(); } catch (e) { /* нет API */ }
    try { window.close(); } catch (e2) { /* ignore */ }
    setTimeout(function () { try { history.go(-(history.length - 1)); } catch (e3) { /* ignore */ } }, 300);
  };

  // ---------- клавиши ----------
  var lastBackAt = 0, lastKeyAt = 0;

  App.keyCount = 0;
  function onKeyDown(e) {
    var k = Nav.keyName(e);
    App.keyCount++;
    // зажатая кнопка: не даём нажатиям копиться быстрее, чем ТВ успевает рисовать
    var now = Date.now();
    if (e.repeat && k && now - lastKeyAt < 110) { e.preventDefault(); return; }
    lastKeyAt = now;
    if (k) { e.preventDefault(); e.stopPropagation(); }
    if (k === 'BACK') lastBackAt = Date.now();
    App.pendingFocus = false;
    var layer = App.topLayer();
    // синяя кнопка во время уведомления — сразу открыть эфир
    if (k === 'BLUE' && App._notifyStream && !Player.isOpen()) {
      var ns = App._notifyStream; App._notifyStream = null;
      App.play(App.itemFromStream(ns));
      return;
    }
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
          else {
            // на странице пока нечего выбрать (пусто или ещё грузится) — всё равно закрываем меню,
            // а фокус перейдёт на контент, как только он появится
            U.$('#app').classList.remove('side-open');
            App.pendingFocus = true;
          }
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
    var moved;
    var pg = currentPage();
    if (layer === App.base && (dir === 'up' || dir === 'down') && pg) {
      // вверх/вниз — только по странице, без прыжков в боковое меню
      var sc = Nav.scope;
      Nav.setScope(pg.el);
      moved = Nav.move(dir);
      Nav.setScope(sc);
    } else moved = Nav.move(dir);
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

  // ---------- где остановились: страница + открытый эфир/запись ----------
  // Сохраняем при каждом переходе и при открытии/закрытии плеера; при запуске возвращаемся туда же.
  var RESUMABLE = { home: 1, browse: 1, clips: 1, following: 1, history: 1, settings: 1, search: 1, channel: 1, game: 1 };
  App.saveState = function () {
    var cur = App.history[App.history.length - 1];
    var it = Player.item;
    var st = U.store.get('lastState', {}) || {};
    if (cur && RESUMABLE[cur.name]) { st.page = cur.name; st.params = cur.params || {}; }
    st.player = it ? { kind: it.kind, login: it.login, name: it.name, avatar: it.avatar, id: it.id, slug: it.slug, title: it.title,
      length: it.length, thumb: it.thumb, game: it.game, roomId: it.roomId, createdAt: it.createdAt } : null;
    st.at = Date.now();
    U.store.set('lastState', st);
  };

  function resume() {
    var st = U.store.get('lastState', null);
    if (!st || Settings.get('resume') === 'off') return false;
    var name = st.page;
    if (!name || !Pages[name] || !RESUMABLE[name]) return false;
    App.go(name, st.params || {}, { root: true });
    // «Назад» с канала/категории ведёт на главную (её строим только тогда — запуск быстрее)
    if (name === 'channel' || name === 'game') App.history[0].backHome = true;
    // плеер открываем снова, только если вышли недавно
    var it = st.player;
    if (!it || !it.kind || Date.now() - (st.at || 0) > 12 * 3600 * 1000) return 'page';
    if (it.kind !== 'live') { App.play(it); return 'player'; }
    // эфир мог уже закончиться — сначала проверяем, что канал в сети, и что пользователь ещё никуда не ушёл
    var keys = App.keyCount;
    Twitch.user(it.login).then(function (u) {
      if (App.keyCount !== keys || Player.isOpen() || App.topLayer() !== App.base) return;
      if (u && u.stream) { u.stream.broadcaster = u.stream.broadcaster || u; App.play(App.itemFromStream(u.stream)); return; }
      // эфир, который вы смотрели, уже закончился — говорим об этом, а не молча остаёмся на странице
      UI.toast(tr('Эфир закончился') + ': ' + (it.name || it.login), 4000);
      if (Auth.accounts.length > 1) App.showProfiles();
    }).catch(function () { if (Auth.accounts.length > 1 && App.keyCount === keys) App.showProfiles(); });
    return 'player';
  }

  // ---------- старт ----------
  function init() {
    U.store.restore(function (restarting) { if (!restarting) start(); });
    checkUpdate();
  }

  // Самообновление: ТВ держит приложение (и index.html) в кеше и часто не перезапускает его, а только
  // сворачивает. Поэтому при запуске и при возврате на экран спрашиваем version.txt с GitHub и,
  // если вышла новая версия, перезагружаемся с новым адресом — тогда ТВ берёт свежие файлы.
  var updChecked = 0;
  function checkUpdate(force) {
    if (!force && Date.now() - updChecked < 10 * 60 * 1000) return;
    updChecked = Date.now();
    if (!window.fetch) return;
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var v = parseInt(t, 10), cur = parseInt(window.APP_V, 10);
      if (!v || !cur || v <= cur) return;
      var m = /[?&]u=(\d+)/.exec(location.search);
      if (m && +m[1] >= v) return; // уже перезагружались ради этой версии — второй раз не крутимся
      // идёт эфир — не прерываем: обновимся, когда плеер закроют
      if (window.Player && Player.isOpen && Player.isOpen()) { updChecked = 0; return; }
      try { if (App.base) App.saveState(); if (window.Player && Player.saveNow) Player.saveNow(); U.store.flush(); } catch (e) { /* не страшно */ }
      location.replace(location.pathname + '?u=' + v + location.hash);
    }).catch(function () {});
  }
  App.checkUpdate = checkUpdate;
  // приложение могут не закрывать сутками — проверяем и просто по ходу работы (не чаще раза в 10 минут)
  setInterval(function () { if (!document.hidden) checkUpdate(); }, 5 * 60 * 1000);

  function start() {
    App.applyScale();
    App.applyLite();
    U.$$('[data-i18n]').forEach(function (el) { el.textContent = tr(el.textContent); });
    setTimeout(App.hideSplash, 6000); // на случай, если сеть совсем не отвечает
    window.addEventListener('resize', App.applyScale);
    buildSidebar();
    pagesEl = U.$('#pages');
    App.base = { el: U.$('#app'), scope: U.$('#app') };
    App.layers = [App.base];
    Nav.onChange = function (el) {
      U.$('#app').classList.toggle('side-open', inSidebar(el) && App.topLayer() === App.base);
      Player.el.classList.toggle('next-open', !!el && !!el.closest && !!el.closest('.osd-next'));
      // ленивые полки: фокус дошёл до предпоследних — достраиваем следующие
      var lz = el && el.closest && el.closest('[data-lazy]');
      if (lz && lz._lazy) {
        var rows = lz.children, row = el.closest('.shelf, .grid');
        var idx = Array.prototype.indexOf.call(rows, row);
        if (idx >= 0 && idx >= rows.length - 2) lz._lazy(2);
      }
    };
    Chat.init();
    Player.init();
    document.addEventListener('keydown', onKeyDown, true);
    trapHistory();

    // ТВ свернул приложение — ставим на паузу, при возврате эфир перезапускаем с «живой» точки
    window.addEventListener('pagehide', function () { App.saveState(); Player.saveNow(); U.store.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { App.saveState(); Player.saveNow(); U.store.flush(); }
      else {
        if (Auth.loggedIn() && !Auth.needsLogin()) Auth.ensure().catch(function () {}); // вернулись — продлеваем вход сейчас
        checkUpdate();
      }
      if (!Player.isOpen()) return;
      if (document.hidden) { Player.bgPaused = true; try { Player.video.pause(); } catch (e) { /* ignore */ } }
      else {
        Player.bgPaused = false;
        if (Player.item && Player.item.kind === 'live') Player.open(Player.item, Player.playlist);
        else { try { Player.video.play(); } catch (e2) { /* ignore */ } }
      }
    });

    // клики мышью/указкой (у некоторых пультов Hisense есть режим курсора)
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.focusable') : null;
      if (!el) return;
      Nav.focus(el);
      if (el._onclick) el._onclick(el);
    });

    Auth.onChange(function () {
      knownLive = null; // другой профиль — не засыпаем уведомлениями о «новых» эфирах
      App.updateAccountItem();
      if (Auth.loggedIn()) Auth.syncFollows().catch(function () {});
    });
    if (Auth.loggedIn()) {
      // при каждом запуске освежаем профиль (аватарка и ник могли смениться на Twitch);
      // после него Auth.onChange сам обновит подписки
      Auth.ensure().then(function () { return Auth.loadUser(); }).catch(function () {});
    }

    var hashPage = (location.hash || '').replace('#', '');
    var resumed = false;
    if (Pages[hashPage] && hashPage !== 'channel' && hashPage !== 'game') App.go(hashPage, {}, { root: true });
    else {
      try { resumed = resume(); } catch (e) { resumed = false; }
      if (!resumed) App.go('home', {}, { root: true });
    }
    // «Кто смотрит?» — только при обычном запуске; если вернулись к эфиру, не перебиваем его
    if (Auth.accounts.length > 1 && resumed !== 'player') App.showProfiles();
    if (Auth.needsLogin()) setTimeout(function () { UI.toast(tr('Вход в Twitch устарел — войдите снова в разделе «Аккаунт»'), 6000); }, 1500);
    setTimeout(checkLive, 20000);
    setInterval(checkLive, 3 * 60 * 1000);
  }

  // ---------- «Кто смотрит?» — выбор профиля при запуске, как в YouTube ----------
  App.showProfiles = function (onDone) {
    var list = h('div.profiles-list', { 'data-group': 'free' });
    var first = null;
    function tile(avatarHtml, name, sub, fn, cls) {
      var el = h('div.profile.focusable' + (cls ? '.' + cls : ''), null, [
        h('div.profile-avatar', { html: avatarHtml, 'data-letter': cls ? null : String(name || '?').charAt(0).toUpperCase() }),
        h('div.profile-name', { text: name }),
        sub ? h('div.profile-sub', { text: sub }) : null
      ]);
      el._onclick = fn;
      list.appendChild(el);
      return el;
    }
    var active = Auth.user();
    Auth.accounts.forEach(function (a) {
      if (!a.user) return;
      var el = tile(a.user.profileImageURL ? '<img src="' + U.esc(a.user.profileImageURL) + '" alt="" onerror="this.remove()">' : '', a.user.displayName, active && active.login === a.user.login ? tr('Текущий') : '', function () {
        App.closeLayer();
        Auth.switchTo(a.user.login);
        UI.toast(tr('Профиль: ') + a.user.displayName);
        App.go('home', {}, { root: true, force: true });
        if (onDone) onDone();
      });
      if (!first || (active && active.login === a.user.login)) first = el;
    });
    tile(UI.icon('person'), tr('Без входа'), tr('Гость'), function () {
      App.closeLayer();
      Auth.switchTo(null);
      App.go('home', {}, { root: true, force: true });
    }, 'profile-guest');
    tile('<span class="profile-plus">+</span>', tr('Добавить аккаунт'), '', function () {
      App.closeLayer();
      App.go('account', { add: true }, { root: true });
    }, 'profile-add');
    var box = h('div.profiles', null, [
      h('img.profiles-logo', { src: 'icons/glitch.svg', alt: '' }),
      h('div.profiles-title', { text: tr('Кто смотрит?') }),
      list
    ]);
    App.openLayer({ el: h('div.overlay.profiles-overlay', null, box), root: U.$('#modal-root'), focus: first || list.firstChild });
    App.hideSplash();
  };

  // ---------- уведомления: кто из ваших каналов начал эфир ----------
  var knownLive = null;
  function checkLive() {
    // ТВ в режиме ожидания / приложение свёрнуто — никаких фоновых запросов (и продлений входа)
    if (Settings.get('notify') === 'off' || document.hidden) return;
    var p = (Auth.loggedIn() ? Auth.followedLiveSafe() : Twitch.users(App.favs()).then(function (us) {
      return us.filter(function (u) { return u.stream; }).map(function (u) { var st = u.stream; st.broadcaster = st.broadcaster || u; return st; });
    })).then(function (list) { return list.filter(function (st) { return !App.isBlocked(st.broadcaster.login); }); });
    p.then(function (streams) {
      var now = {};
      streams.forEach(function (st) { now[st.broadcaster.login] = st; });
      if (knownLive) {
        Object.keys(now).forEach(function (login) {
          if (!knownLive[login] && !(Player.item && Player.item.login === login)) notify(now[login]);
        });
      }
      knownLive = now;
    }).catch(function () {});
  }

  function notify(st) {
    var b = st.broadcaster;
    var el = h('div.notify', null, [
      UI.img('notify-avatar', b.profileImageURL),
      h('div.notify-text', null, [
        h('div.notify-title', { text: b.displayName + ' ' + tr('в эфире') }),
        h('div.notify-sub', { text: st.title || '' }),
        h('div.notify-hint', { text: tr('Синяя кнопка — открыть') })
      ])
    ]);
    U.$('#app').appendChild(el);
    App._notifyStream = st;
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); if (App._notifyStream === st) App._notifyStream = null; }, 400); }, 9000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
