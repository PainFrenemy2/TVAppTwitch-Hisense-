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
      title: it.title, thumb: it.thumb, length: it.length, game: it.game, createdAt: it.kind === 'live' ? null : it.createdAt, at: Date.now() });
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
    if (top.lastFocus && top.lastFocus.isConnected && top.lastFocus.offsetParent !== null) Nav.focus(top.lastFocus, { noScroll: true });
    else if (top === App.base) App.refocus(true);
    else if (top.el === Player.el) { /* плеер сам покажет OSD */ }
  };

  // ---------- боковое меню ----------
  var SIDE = [
    ['search', 'search', tr('Поиск')],
    ['home', 'home', tr('Главная')],
    ['browse', 'browse', tr('Категории')],
    ['following', 'following', tr('Подписки')],
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
    if (target) { Nav.focus(target); App.pendingFocus = false; App.hideSplash(); }
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
      if (t) { App.pendingFocus = false; Nav.focus(t); App.hideSplash(); }
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
    UI.confirm(tr('Выйти из Twitch TV?'), null, tr('Выйти'), App.exit);
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

  // ---------- старт ----------
  function init() {
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
    };
    Chat.init();
    Player.init();
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
      var el = e.target.closest ? e.target.closest('.focusable') : null;
      if (!el) return;
      Nav.focus(el);
      if (el._onclick) el._onclick(el);
    });

    Auth.onChange(function () {
      App.updateAccountItem();
      if (Auth.loggedIn()) Auth.syncFollows().catch(function () {});
    });
    if (Auth.loggedIn()) {
      Auth.ensure().then(function () { return Auth.syncFollows(); }).catch(function () {});
    }

    var start = (location.hash || '').replace('#', '');
    App.go(Pages[start] && start !== 'channel' && start !== 'game' ? start : 'home', {}, { root: true });
    if (Auth.accounts.length > 1) App.showProfiles();
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
    if (Settings.get('notify') === 'off') return;
    var p = Auth.loggedIn() ? Auth.followedLive() : Twitch.users(App.favs()).then(function (us) {
      return us.filter(function (u) { return u.stream; }).map(function (u) { var st = u.stream; st.broadcaster = st.broadcaster || u; return st; });
    });
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
