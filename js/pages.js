/* Страницы приложения + настройки */
(function () {
  'use strict';
  var h = U.h;

  // ---------- Настройки ----------
  var DEFAULTS = {
    quality: 'auto', latency: 'normal', chat: 'on', chatMode: 'overlay', chatSide: 'right', chatOpacity: '30',
    chatWidth: 'normal', chatFont: 'normal', chatHeight: 'full', lang: I18N.tvLang().split('-')[0], uiLang: I18N.tvLang(),
    resume: 'on', adblock: 'on', eventsNotify: 'on',
    engine: 'hls', playerType: 'site', scale: '100', preview: 'on', codec: 'auto', useAccount: 'on',
    notify: 'on', lite: 'auto', previewSound: 'on',
    // экранная клавиатура — на языке ТВ, если для него есть раскладка (для японского, китайского и т.п. — латиница)
    kb: /^(ru|uk|en|de|fr|es|pt|it|pl|cs|sk|hu|ro|tr|nl|sv|da|no|fi|vi|el|bg)$/.test(I18N.tvLang()) ? I18N.tvLang() : 'en'
  };
  var Settings = {
    data: U.store.get('settings', {}),
    get: function (k) { return Settings.data[k] !== undefined ? Settings.data[k] : DEFAULTS[k]; },
    set: function (k, v) { Settings.data[k] = v; U.store.set('settings', Settings.data); }
  };
  window.Settings = Settings;

  // языки трансляций (фильтр Twitch по языку стримера)
  var LANGS = [['ru', 'Русский'], ['uk', 'Українська'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'],
    ['fr', 'Français'], ['pt', 'Português'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['it', 'Italiano'], ['nl', 'Nederlands'],
    ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['hu', 'Magyar'], ['ro', 'Română'], ['bg', 'Български'], ['el', 'Ελληνικά'],
    ['sv', 'Svenska'], ['da', 'Dansk'], ['no', 'Norsk'], ['fi', 'Suomi'], ['ar', 'العربية'], ['th', 'ภาษาไทย'],
    ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];

  // ---------- общие кусочки ----------

  function pageShell(cls) {
    var content = h('div.v-content');
    var scroll = h('div.v-scroll', { 'data-pad': '2' }, content);
    var el = h('section.page' + (cls ? '.' + cls : ''), null, scroll);
    el.content = content;
    el.scroll = scroll;
    return el;
  }

  function header(title, sub) {
    return h('div.page-header.row', { 'data-top': '1' }, [h('h1.page-title', { text: title }), sub ? h('div.page-sub', { text: sub }) : null]);
  }

  // полка, которая сама грузит данные и исчезает, если пусто/ошибка
  function autoShelf(parent, title, loader, makeCard, opts) {
    opts = opts || {};
    var shelf = UI.shelf(title, opts);
    for (var i = 0; i < (opts.skeleton || 5); i++) shelf.track.appendChild(h('div.card.skeleton' + (opts.game ? '.card-game' : '.card-video'), null, [h('div.' + (opts.game ? 'box' : 'thumb')), h('div.sk-line'), h('div.sk-line.short')]));
    if (opts.before) parent.insertBefore(shelf, opts.before); else parent.appendChild(shelf);
    var p = loader().then(function (items) {
      shelf.track.innerHTML = '';
      if (!items || !items.length) { if (shelf.parentNode) shelf.parentNode.removeChild(shelf); return 0; }
      shelf.add(items.map(makeCard));
      App.refocus();
      return items.length;
    }, function (e) {
      if (shelf.parentNode) shelf.parentNode.removeChild(shelf);
      if (window.console) console.warn(title, e);
      return 0;
    });
    shelf.ready = p;
    return shelf;
  }

  function openGame(g) { App.go('game', { name: g.name, displayName: g.displayName || g.name }); }
  function openChannel(u) { App.go('channel', { login: u.login }); }

  function streamCard(s) { return UI.streamCard(s, function (_, card) { App.playFromCard(card); }); }
  function videoCard(v) { return UI.videoCard(v, function (_, card) { App.playFromCard(card); }); }
  function clipCard(c) { return UI.clipCard(c, function (_, card) { App.playFromCard(card); }); }
  function gameCard(g) { return UI.gameCard(g, openGame); }
  function channelCard(u) { return UI.channelCard(u, function (data) { openChannel(data); }); }

  // Сетка со страницами из API: fetchPage(cursor) -> {items, cursor, more}
  function pagedGrid(cls, fetchPage, makeCard, onFirst) {
    var cursor = null, more = true, first = true;
    return UI.grid(cls, function () {
      if (!more) return null;
      return fetchPage(cursor).then(function (p) {
        cursor = p.cursor; more = p.more && !!p.cursor;
        if (first) { first = false; if (onFirst) onFirst(p); }
        return p.items.map(makeCard);
      });
    });
  }

  function fillGrid(wrap, grid, emptyText) {
    var loading = UI.loading();
    wrap.appendChild(loading);
    wrap.appendChild(grid);
    return grid._loadMore().then(function () {
      loading.remove();
      if (!grid.isConnected) return; // пока грузили, переключили вкладку
      if (!grid.children.length) wrap.appendChild(UI.empty(emptyText || tr('Здесь пока пусто')));
      App.refocus();
    }, function (e) {
      loading.remove();
      if (!grid.isConnected) return;
      var err = UI.error(e, function () { err.remove(); fillGrid(wrap, grid, emptyText); });
      wrap.appendChild(err);
      App.refocus();
    });
  }

  function fillStatic(wrap, grid, promise, makeCard, emptyText) {
    var loading = UI.loading();
    wrap.appendChild(loading);
    wrap.appendChild(grid);
    return promise.then(function (items) {
      loading.remove();
      if (!grid.isConnected) return;
      if (!items.length) wrap.appendChild(UI.empty(emptyText));
      grid.add(items.map(makeCard));
      App.refocus();
    }, function (e) {
      loading.remove();
      wrap.appendChild(UI.empty(tr('Не удалось загрузить'), e && e.message));
    });
  }

  function liveOf(users) {
    return users.filter(function (u) { return u.stream; }).map(function (u) {
      var s = u.stream; s.broadcaster = s.broadcaster || u; return s;
    }).sort(function (a, b) { return b.viewersCount - a.viewersCount; });
  }

  // Мои каналы в эфире: с аккаунтом — сразу из подписок, иначе по избранному
  function myLive() {
    var favs = App.favs();
    var acc = Auth.loggedIn() ? Auth.followedLiveSafe().catch(function () { return []; }) : Promise.resolve([]);
    var loc = favs.length ? Twitch.users(favs).then(liveOf).catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([acc, loc]).then(function (r) {
      var seen = {}, out = [];
      r[0].concat(r[1]).forEach(function (s) {
        var l = s.broadcaster && s.broadcaster.login;
        if (l && !seen[l]) { seen[l] = 1; out.push(s); }
      });
      return out.sort(function (a, b) { return b.viewersCount - a.viewersCount; });
    });
  }

  // ---------- Превью эфира (одно на всё приложение, минимальное качество — бережём ТВ) ----------
  var Preview = {
    hls: null, timer: null, video: null, gen: 0,
    start: function (video, login) {
      Preview.stop();
      if (Settings.get('preview') === 'off' || App.isLite() || !window.Hls || !Hls.isSupported() || Player.isOpen()) return;
      var gen = Preview.gen;
      Preview.timer = setTimeout(function () {
        Twitch.liveUrl(login, Settings.get('playerType')).then(function (url) {
          // пока ждали токен, фокус ушёл / открылся плеер или меню — не запускаем
          if (gen !== Preview.gen || Player.isOpen() || !video.isConnected || App.topLayer() !== App.base) return;
          var hls = new Hls({ enableWorker: true, startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 6, maxMaxBufferLength: 10,
            backBufferLength: 0, liveSyncDurationCount: 2, abrEwmaDefaultEstimate: 1500000 });
          Preview.hls = hls; Preview.video = video;
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            // самое лёгкое видео не ниже 360p
            var idx = 0;
            hls.levels.forEach(function (l, i) { if (l.height && l.height <= 480 && l.height >= hls.levels[idx].height) idx = i; });
            hls.currentLevel = idx;
            // со звуком, как в YouTube; если ТВ запретит автозапуск со звуком — играем без звука
            var withSound = Settings.get('previewSound') !== 'off';
            video.muted = !withSound;
            video.volume = 0.7;
            var pr = video.play();
            if (pr && pr.catch) pr.catch(function () { video.muted = true; var p2 = video.play(); if (p2 && p2.catch) p2.catch(function () {}); });
          });
          hls.on(Hls.Events.ERROR, function (e, d) { if (d.fatal) Preview.stop(); });
          video.onplaying = function () { video.classList.add('playing'); };
          hls.attachMedia(video);
          hls.loadSource(url);
        }).catch(function () {});
      }, 1400);
    },
    stop: function () {
      Preview.gen++;
      clearTimeout(Preview.timer);
      if (Preview.hls) { try { Preview.hls.destroy(); } catch (e) { /* ignore */ } Preview.hls = null; }
      if (Preview.video) { Preview.video.classList.remove('playing'); try { Preview.video.removeAttribute('src'); Preview.video.load(); } catch (e2) { /* ignore */ } Preview.video = null; }
    }
  };
  window.Preview = Preview;

  var Pages = {};

  // ---------- Главная ----------
  Pages.home = function () {
    var el = pageShell('page-home');
    var chipsInner = h('div.chips-inner');
    var chips = h('div.chips.row.h-scroll', { 'data-group': 'chips' }, chipsInner);
    var hero = h('div.hero-wrap.row', { 'data-top': '1' });
    var body = h('div.home-body');
    el.content.appendChild(hero);
    el.content.appendChild(chips);
    el.content.appendChild(body);

    // --- баннер с живым превью (как «Рекомендуемые» на главной Twitch) ---
    var heroItems = [], heroIdx = 0;
    var heroEl = h('div.hero.focusable', null, [
      h('div.hero-media', null, [h('img.hero-img', { alt: '' }), h('video.hero-video', { playsinline: '' }), h('div.hero-fade')]),
      h('div.hero-info', null, [
        h('div.hero-chan', null, [h('img.hero-avatar', { alt: '' }), h('div', null, [h('div.hero-name'), h('div.hero-game')])]),
        h('div.hero-title'),
        h('div.hero-meta', null, [h('span.badge-inline.live', { text: tr('В ЭФИРЕ') }), h('span.hero-viewers')]),
        h('div.hero-cta', { html: UI.icon('play') + '<span>' + U.esc(tr('Смотреть')) + '</span>' }),
        h('div.hero-hint', { text: tr('OK — смотреть • ← → — листать') }),
        h('div.hero-dots')
      ])
    ]);
    function showHero(i) {
      if (!heroItems.length) return;
      heroIdx = (i + heroItems.length) % heroItems.length;
      var s = heroItems[heroIdx], b = s.broadcaster || {};
      U.$('.hero-img', heroEl).src = String(s.previewImageURL || '').replace('440x248', '1280x720');
      U.$('.hero-avatar', heroEl).src = b.profileImageURL || '';
      U.$('.hero-name', heroEl).textContent = b.displayName || b.login;
      U.$('.hero-game', heroEl).textContent = s.game ? (s.game.displayName || s.game.name) : '';
      U.$('.hero-title', heroEl).textContent = s.title || '';
      U.$('.hero-viewers', heroEl).textContent = U.viewers(s.viewersCount);
      U.$('.hero-dots', heroEl).innerHTML = heroItems.map(function (_, k) { return '<i' + (k === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
      if (heroEl.classList.contains('focused')) Preview.start(U.$('.hero-video', heroEl), b.login);
      else Preview.stop();
    }
    heroEl._onclick = function () {
      if (!heroItems.length) return;
      Preview.stop();
      var items = heroItems.map(App.itemFromStream);
      App.play(items[heroIdx], items);
    };
    heroEl._onkey = function (k) {
      if (k === 'RIGHT' && heroItems.length > 1) { showHero(heroIdx + 1); return true; }
      if (k === 'LEFT' && heroIdx > 0) { showHero(heroIdx - 1); return true; }
      return false;
    };
    heroEl._onfocus = function () { showHero(heroIdx); };
    heroEl._onblur = function () { Preview.stop(); };

    var lang = Settings.get('lang');
    Twitch.topStreamsByLang(lang, 8).catch(function () { return Twitch.topStreams(8); }).then(function (p) {
      heroItems = p.items.filter(function (s) { return s.broadcaster && !App.isBlocked(s.broadcaster.login); }).slice(0, 8);
      if (!heroItems.length) return;
      hero.appendChild(heroEl);
      showHero(0);
      App.refocus();
    }).catch(function () {});

    var activeChip = null;
    function chip(label, fn) {
      var c = h('div.chip.focusable', { text: label });
      c._onclick = function () {
        if (activeChip) activeChip.classList.remove('active');
        c.classList.add('active');
        activeChip = c;
        fn();
      };
      chipsInner.appendChild(c);
      return c;
    }

    function continueItems() {
      var pos = U.store.get('vodpos', {});
      return App.history_().filter(function (x) { return x.kind === 'vod' && pos[x.id]; }).slice(0, 15).map(function (x) {
        return { id: x.id, title: x.title, lengthSeconds: x.length || 0, viewCount: 0, createdAt: x.createdAt, broadcastType: 'ARCHIVE',
          previewThumbnailURL: x.thumb, owner: { login: x.login, displayName: x.name, profileImageURL: x.avatar }, game: { name: x.game } };
      });
    }

    // Полки строим порциями: сначала 4, остальные — когда пользователь листает вниз.
    // Так главная открывается быстрее и меньше нагружает ТВ.
    var queue = [];
    body.setAttribute('data-lazy', '1');
    body._lazy = function (n) {
      var k = n || 2;
      while (k-- > 0 && queue.length) queue.shift()();
    };
    function later(fn) { queue.push(fn); }

    function renderMain() {
      body.innerHTML = '';
      queue = [];
      if (App.myChannels().length || Auth.loggedIn()) {
        autoShelf(body, Auth.loggedIn() ? tr('Подписки в эфире') : tr('Избранное в эфире'), myLive, streamCard, { cls: 'shelf-favs' });
      }
      var cont = continueItems();
      if (cont.length) later(function () { autoShelf(body, tr('Продолжить просмотр'), function () { return Promise.resolve(cont); }, videoCard); });
      var recent = App.history_().filter(function (x) { return x.kind === 'live'; });
      var seen = {};
      recent = recent.filter(function (x) { if (seen[x.login]) return false; seen[x.login] = 1; return true; }).slice(0, 20);
      if (recent.length) later(function () {
        autoShelf(body, tr('Недавно смотрели'), function () {
          return Twitch.users(recent.map(function (x) { return x.login; })).then(function (us) {
            var byLogin = {};
            us.forEach(function (u) { byLogin[u.login] = u; });
            return recent.map(function (x) { return byLogin[x.login]; }).filter(Boolean);
          });
        }, function (u) {
          if (u.stream) u.stream.broadcaster = u.stream.broadcaster || u;
          return u.stream ? streamCard(u.stream) : channelCard(u);
        });
      });
      var langName = (LANGS.filter(function (l) { return l[0] === lang; })[0] || ['', ''])[1];
      // «Популярные трансляции» всегда во второй-третьей строке
      queue.unshift(function () {
        autoShelf(body, tr('Популярные трансляции') + (langName ? ' • ' + langName : ''), function () {
          return Twitch.topStreamsByLang(lang, 20).then(function (p) { return p.items; });
        }, streamCard);
      });
      later(function () { autoShelf(body, tr('Популярные категории'), function () { return Twitch.topGames(20).then(function (p) { return p.items; }); }, gameCard, { game: true, skeleton: 8 }); });
      later(function () { autoShelf(body, tr('Популярно во всём мире'), function () { return Twitch.topStreams(20).then(function (p) { return p.items; }); }, streamCard); });
      for (var gi = 0; gi < 6; gi++) (function (i) {
        later(function () {
          var shelf = autoShelf(body, '…', function () {
            return Twitch.topGames(6).then(function (p) {
              var g = p.items[i];
              if (!g) return [];
              var t = U.$('.shelf-title', shelf);
              if (t) t.textContent = g.displayName || g.name;
              return Twitch.gameStreams(g.name, 16).then(function (r) { return r.items; });
            });
          }, streamCard);
        });
      })(gi);
      // сразу показываем столько полок, чтобы заполнить экран
      body._lazy(Math.max(0, 4 - body.children.length));
    }

    function renderGame(g) {
      body.innerHTML = '';
      queue = [];
      var wrap = h('div.grid-wrap');
      body.appendChild(wrap);
      fillGrid(wrap, pagedGrid('grid-video', function (c) { return Twitch.gameStreams(g.name, 24, c); }, streamCard), tr('Нет трансляций'));
    }

    var home = chip(tr('Все'), renderMain);
    home.classList.add('active');
    activeChip = home;
    renderMain();
    Twitch.topGames(12).then(function (p) {
      p.items.forEach(function (g) { chip(g.displayName || g.name, function () { renderGame(g); }); });
      chips.classList.toggle('overflows', chipsInner.scrollWidth > chips.clientWidth + 4);
    }).catch(function () {});

    return {
      el: el, nav: 'home',
      firstFocus: function () {
        // фокус — на баннер или первую карточку, как в YouTube TV (ждём загрузки полок выше)
        if (heroEl.isConnected) return heroEl;
        var shelves = U.$$('.shelf, .grid', body);
        for (var i = 0; i < shelves.length; i++) {
          if (U.$('.skeleton', shelves[i])) return null;
          var c = U.$('.card.focusable', shelves[i]);
          if (c) return c;
        }
        return null;
      },
      onHide: function () { Preview.stop(); },
      refresh: function () { Twitch.clearCache(); if (activeChip === home) renderMain(); }
    };
  };

  // ---------- Категории ----------
  Pages.browse = function () {
    var el = pageShell('page-browse');
    el.content.appendChild(header(tr('Категории'), tr('Во что играют прямо сейчас')));
    var wrap = h('div.grid-wrap');
    el.content.appendChild(wrap);
    fillGrid(wrap, pagedGrid('grid-game', function (c) { return Twitch.topGames(40, c); }, gameCard), tr('Категории не загрузились'));
    return { el: el, nav: 'browse' };
  };

  // ---------- Категория ----------
  Pages.game = function (params) {
    var el = pageShell('page-game');
    var head = h('div.game-header.row', { 'data-top': '1' }, [
      h('div.game-box'),
      h('div.game-info', null, [h('h1.page-title', { text: params.displayName || params.name }), h('div.page-sub.game-viewers')])
    ]);
    el.content.appendChild(head);
    var tabsInner = h('div.chips-inner');
    var tabs = h('div.chips.row.h-scroll', { 'data-group': 'chips' }, tabsInner);
    el.content.appendChild(tabs);
    var body = h('div.grid-wrap');
    el.content.appendChild(body);
    var active = null;

    function tab(label, fn) {
      var c = h('div.chip.focusable', { text: label });
      c._onclick = function () {
        if (active === c) return;
        if (active) active.classList.remove('active');
        c.classList.add('active');
        active = c;
        body.innerHTML = '';
        fn();
      };
      tabsInner.appendChild(c);
      return c;
    }
    var t1 = tab(tr('Трансляции'), function () {
      fillGrid(body, pagedGrid('grid-video', function (c) { return Twitch.gameStreams(params.name, 24, c); }, streamCard, function (p) {
        if (p.game) {
          U.$('.game-box', head).appendChild(UI.img('box-img', p.game.boxArtURL));
          U.$('.game-viewers', head).textContent = U.viewers(p.game.viewersCount);
        }
      }), tr('Сейчас никто не стримит эту категорию'));
    });
    tab(tr('Клипы'), function () { fillStatic(body, UI.grid('grid-video'), Twitch.gameClips(params.name, 40), clipCard, tr('Клипов нет')); });
    tab(tr('Записи'), function () { fillStatic(body, UI.grid('grid-video'), Twitch.gameVideos(params.name, 40), videoCard, tr('Записей нет')); });
    t1._onclick();
    return { el: el, nav: 'browse', firstFocus: function () { return U.$('.grid .card', el) || (U.$('.empty', body) ? t1 : null); } };
  };

  // ---------- Клипы: в тренде + клипы ваших подписок ----------
  // Общего списка «популярные клипы» у Twitch нет, поэтому «В тренде» — лучшие клипы самых популярных
  // категорий, сведённые вместе по просмотрам. С аккаунтом — ещё ряд клипов каналов, на которые вы подписаны.
  var CLIP_PERIODS = [['LAST_DAY', tr('За 24 часа')], ['LAST_WEEK', tr('За неделю')], ['LAST_MONTH', tr('За месяц')], ['ALL_TIME', tr('За всё время')]];

  function byViews(lists, limit) {
    var seen = {}, out = [];
    [].concat.apply([], lists).forEach(function (c) { if (c && c.slug && !seen[c.slug]) { seen[c.slug] = 1; out.push(c); } });
    return out.sort(function (a, b) { return (b.viewCount || 0) - (a.viewCount || 0); }).slice(0, limit);
  }

  Pages.clips = function () {
    var el = pageShell('page-clips');
    el.content.appendChild(header(tr('Клипы'), tr('Самые популярные клипы Twitch')));
    var chipsInner = h('div.chips-inner');
    var chips = h('div.chips.row.h-scroll', { 'data-group': 'chips' }, chipsInner);
    el.content.appendChild(chips);
    var body = h('div');
    el.content.appendChild(body);
    var period = Settings.get('clipsPeriod') || 'LAST_WEEK';
    var gen = 0;

    // Один запрос на категорию: его же используют и «В тренде», и ряд категории (кэш ответов Twitch).
    // Ряды категорий строим порциями по мере прокрутки, как на главной, — меньше запросов и DOM на слабом ТВ.
    var queue = [];
    body.setAttribute('data-lazy', '1');
    body._lazy = function (n) { var k = n || 2; while (k-- > 0 && queue.length) queue.shift()(); };
    function gameClips(g) { return Twitch.gameClips(g.name, 20, period); }

    function render() {
      var my = ++gen;
      body.innerHTML = '';
      queue = [];
      var games = Twitch.topGames(8).then(function (p) { return p.items; });
      autoShelf(body, tr('В тренде'), function () {
        return games.then(function (gs) {
          return Promise.all(gs.slice(0, 6).map(function (g) { return gameClips(g).catch(function () { return []; }); }));
        }).then(function (lists) { return byViews(lists, 30); });
      }, clipCard);
      if (Auth.loggedIn() && !Auth.needsLogin()) {
        autoShelf(body, tr('Клипы ваших подписок'), function () {
          var logins = Auth.cachedFollows().slice(0, 12);
          return Promise.all(logins.map(function (l) { return Twitch.clips(l, period, 6).catch(function () { return []; }); }))
            .then(function (lists) { return byViews(lists, 30); });
        }, clipCard);
      }
      games.then(function (gs) {
        if (my !== gen) return;
        gs.forEach(function (g) {
          queue.push(function () { autoShelf(body, g.displayName || g.name, function () { return gameClips(g); }, clipCard); });
        });
        body._lazy(2);
      }).catch(function () {});
    }

    CLIP_PERIODS.forEach(function (pr) {
      var c = h('div.chip.focusable' + (pr[0] === period ? '.active' : ''), { text: pr[1] });
      c._onclick = function () {
        if (period === pr[0]) return;
        period = pr[0];
        Settings.set('clipsPeriod', period);
        U.$$('.chip', chipsInner).forEach(function (x) { x.classList.toggle('active', x === c); });
        render();
      };
      chipsInner.appendChild(c);
    });
    render();
    return {
      el: el, nav: 'clips',
      firstFocus: function () {
        var shelf = U.$('.shelf', body);
        if (!shelf || U.$('.skeleton', shelf)) return null;
        return U.$('.card.focusable', shelf);
      },
      refresh: render
    };
  };

  // ---------- Подписки ----------
  Pages.following = function () {
    var el = pageShell('page-following');
    el.content.appendChild(header(tr('Подписки'), Auth.loggedIn() && Auth.user()
      ? tr('Каналы аккаунта ') + Auth.user().displayName + tr(' и ваше избранное')
      : tr('Избранные каналы. Войдите в аккаунт Twitch, чтобы видеть свои подписки')));
    var body = h('div');
    el.content.appendChild(body);

    function render() {
      body.innerHTML = '';
      var mine = App.myChannels();
      // вход устарел — как без входа: баннер «войти снова», а не ошибка с бесполезным «Повторить»
      var expired = Auth.needsLogin();
      var active = Auth.loggedIn() && !expired;
      if (!active) {
        var login = UI.button(expired ? tr('Войти снова') : tr('Войти в Twitch'), 'person', function () { App.go('account', expired ? { add: true } : {}, { root: true }); }, 'primary');
        body.appendChild(h('div.row.login-banner', { 'data-group': 'free' }, [
          h('div.login-banner-text', null, [h('div.login-banner-title', { text: expired ? tr('Вход в Twitch устарел — войдите снова') : tr('Ваши подписки — на телевизоре') }),
            h('div.login-banner-sub', { text: tr('Войдите по коду на twitch.tv/activate — подписки появятся здесь автоматически') })]),
          login
        ]));
      }
      if (!mine.length) {
        if (active) {
          body.appendChild(UI.loading());
          Auth.syncFollows().then(function (l) { if (l.length) render(); else { body.innerHTML = ''; body.appendChild(UI.empty(tr('Вы пока ни на кого не подписаны')));
            body.appendChild(h('div.row.empty-actions', { 'data-group': 'free' }, UI.button(tr('Найти каналы'), 'search', function () { App.go('search', {}, { root: true }); }, 'primary'))); App.refocus(); } },
            function (e) { body.innerHTML = ''; body.appendChild(UI.error(e, render)); });
          return;
        }
        var b = UI.button(tr('Найти каналы'), 'search', function () { App.go('search', {}, { root: true }); });
        body.appendChild(h('div.row', null, [UI.empty(tr('Список пуст'), tr('Найдите канал через поиск и нажмите «В избранное»')), b]));
        App.refocus();
        return;
      }
      var loading = UI.loading();
      body.appendChild(loading);
      Promise.all([myLive(), Twitch.users(mine.slice(0, 300))]).then(function (r) {
        loading.remove();
        var live = r[0];
        var liveSet = {};
        live.forEach(function (s) { liveSet[s.broadcaster.login] = 1; });
        var off = r[1].filter(function (u) { return !u.stream && !liveSet[u.login]; });
        if (live.length) {
          body.appendChild(h('h2.section-title.row', { text: tr('В эфире') + ' • ' + live.length }));
          var g = UI.grid('grid-video');
          g.add(live.map(streamCard));
          body.appendChild(g);
        }
        if (off.length) {
          var shelf = UI.shelf(tr('Не в сети') + ' • ' + off.length);
          shelf.add(off.map(channelCard));
          body.appendChild(shelf);
        }
        App.refocus();
      }, function (e) {
        loading.remove();
        body.appendChild(UI.error(e, render));
      });
    }
    render();
    return { el: el, nav: 'following', refresh: render };
  };

  // ---------- История ----------
  Pages.history = function () {
    var el = pageShell('page-history');
    el.content.appendChild(header(tr('История'), tr('Что вы недавно смотрели')));
    var list = App.history_();
    if (!list.length) {
      el.content.appendChild(UI.empty(tr('История пуста'), tr('Здесь появятся эфиры, записи и клипы, которые вы открывали')));
      el.content.appendChild(h('div.row.empty-actions', { 'data-group': 'free' }, UI.button(tr('На главную'), 'home', function () { App.go('home', {}, { root: true }); }, 'primary')));
      return { el: el, nav: 'history' };
    }
    var clear = UI.button(tr('Очистить историю'), null, function () {
      UI.confirm(tr('Очистить историю?'), null, tr('Очистить'), function () {
        U.store.set('watchHistory', []); U.store.set('vodpos', {});
        App.go('history', {}, { root: true, force: true });
      });
    });
    el.content.appendChild(h('div.row.page-actions', { 'data-group': 'free' }, clear));
    var grid = UI.grid('grid-video');
    grid.add(list.map(function (x) {
      var pos = x.kind === 'vod' ? U.store.get('vodpos', {})[x.id] : 0;
      var card = h('div.card.card-video.focusable', null, [
        h('div.thumb', null, [
          UI.img('thumb-img', x.thumb),
          x.kind === 'live' ? h('div.badge.badge-live', { text: tr('В ЭФИРЕ') }) : h('div.badge.badge-tl', { text: x.kind === 'vod' ? tr('ЗАПИСЬ') : tr('КЛИП') }),
          x.length && x.kind !== 'live' ? h('div.badge.badge-br', { text: U.duration(x.length) }) : null,
          pos && x.length ? h('div.progress', null, h('div.progress-fill', { style: 'width:' + Math.min(100, pos / x.length * 100) + '%' })) : null
        ]),
        h('div.meta', null, [
          UI.img('avatar', x.avatar),
          h('div.meta-text', null, [
            h('div.title', { text: x.title || x.name || x.login }),
            h('div.sub', { text: (x.name || x.login) + ' • ' + U.ago(new Date(x.at).toISOString()) })
          ])
        ])
      ]);
      card._onclick = function () { App.play({ kind: x.kind, login: x.login, name: x.name, avatar: x.avatar, id: x.id, slug: x.slug, title: x.title, length: x.length, thumb: x.thumb, game: x.game, roomId: x.roomId }); };
      return card;
    }));
    el.content.appendChild(grid);
    return { el: el, nav: 'history', firstFocus: function () { return U.$('.grid .card', el); } };
  };

  // ---------- Канал ----------
  Pages.channel = function (params) {
    var el = pageShell('page-channel');
    var head = h('div.channel-header.row', { 'data-top': '1' });
    el.content.appendChild(head);
    var body = h('div');
    el.content.appendChild(body);
    var login = params.login.toLowerCase();

    head.appendChild(UI.loading());
    Twitch.user(login).then(function (u) {
      head.innerHTML = '';
      if (!u) { head.appendChild(UI.empty(tr('Канал не найден'), login)); return; }
      if (u.bannerImageURL) head.appendChild(h('div.channel-banner', { style: 'background-image:url(' + JSON.stringify(u.bannerImageURL) + ')' }));
      var followed = Auth.cachedFollows().indexOf(u.login) >= 0;
      var favBtn = UI.button(App.isFav(u.login) ? tr('В избранном') : tr('В избранное'), App.isFav(u.login) ? 'following' : 'heartOutline', function () {
        var on = App.toggleFav(u.login);
        favBtn.innerHTML = UI.icon(on ? 'following' : 'heartOutline') + '<span>' + (on ? tr('В избранном') : tr('В избранное')) + '</span>';
      });
      var buttons = [];
      if (u.stream) {
        var s = u.stream; s.broadcaster = s.broadcaster || u;
        buttons.push(UI.button(tr('Смотреть эфир'), 'play', function () { App.play(App.itemFromStream(s)); }, 'primary'));
      }
      buttons.push(favBtn);
      var blockBtn = UI.button(App.isBlocked(u.login) ? tr('Разблокировать') : tr('Заблокировать'), null, function () {
        var on = !App.isBlocked(u.login);
        App.setBlocked(u.login, on);
        UI.toast((on ? tr('Канал заблокирован: ') : tr('Канал разблокирован: ')) + u.displayName);
        U.$('span', blockBtn).textContent = on ? tr('Разблокировать') : tr('Заблокировать');
      });
      buttons.push(blockBtn);
      head.appendChild(h('div.channel-top', null, [
        h('div.channel-avatar' + (u.stream ? '.is-live' : ''), { 'data-letter': String(u.displayName || '?').charAt(0).toUpperCase() }, [UI.img('ch-img', u.profileImageURL), u.stream ? h('div.ch-live', { text: tr('В ЭФИРЕ') }) : null]),
        h('div.channel-info', null, [
          h('h1.page-title', null, [u.displayName, followed ? h('span.followed-badge', { text: tr('Вы подписаны') }) : null]),
          h('div.page-sub', { text: (u.followers ? U.num(u.followers.totalCount) + ' ' + tr('фолловеров') : '') +
            (u.stream ? ' • ' + tr('в эфире: ') + ((u.stream.game && (u.stream.game.displayName || u.stream.game.name)) || '') : ' • ' + tr('не в сети')) }),
          u.description ? h('div.channel-desc', { text: u.description }) : null,
          h('div.channel-buttons', { 'data-group': 'free' }, buttons)
        ])
      ]));
      if (u.stream) {
        var ls = UI.shelf(tr('Сейчас в эфире'));
        ls.add([streamCard(u.stream)]);
        body.appendChild(ls);
      }
      var shelves = [
        autoShelf(body, tr('Последние трансляции'), function () { return Twitch.videos(login, 'ARCHIVE', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, tr('Популярные клипы за месяц'), function () { return Twitch.clips(login, 'LAST_MONTH', 30); }, clipCard),
        autoShelf(body, tr('Лучшее'), function () { return Twitch.videos(login, 'HIGHLIGHT', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, tr('Загрузки'), function () { return Twitch.videos(login, 'UPLOAD', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, tr('Клипы за всё время'), function () { return Twitch.clips(login, 'ALL_TIME', 30); }, clipCard)
      ];
      Promise.all(shelves.map(function (x) { return x.ready; })).then(function (counts) {
        if (!u.stream && !counts.some(Boolean)) body.appendChild(UI.empty(tr('Нет записей и клипов')));
      });
      App.refocus();
    }, function (e) {
      head.innerHTML = '';
      head.appendChild(UI.error(e, function () { App.replace('channel', params); }));
      App.refocus();
    });
    return { el: el, nav: null, firstFocus: function () { return U.$('.channel-buttons .btn', el); } };
  };

  // ---------- Поиск ----------
  // Раскладки экранной клавиатуры: латиница + буквы языка, кириллица, греческий
  var LATIN = 'abcdefghijklmnopqrstuvwxyz';
  var KB_LAYOUTS = [
    ['ru', 'Русская', 'РУС', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
    ['uk', 'Українська', 'УКР', 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'],
    ['en', 'English', 'ENG', LATIN],
    ['de', 'Deutsch', 'DEU', LATIN + 'äöüß'],
    ['fr', 'Français', 'FRA', LATIN + 'àâçéèêëîïôûùœ'],
    ['es', 'Español', 'ESP', LATIN + 'ñáéíóúü'],
    ['pt', 'Português', 'POR', LATIN + 'ãõáâàçéêíóôú'],
    ['it', 'Italiano', 'ITA', LATIN + 'àèéìòù'],
    ['pl', 'Polski', 'POL', LATIN + 'ąćęłńóśźż'],
    ['cs', 'Čeština', 'CES', LATIN + 'áčďéěíňóřšťúůýž'],
    ['sk', 'Slovenčina', 'SLK', LATIN + 'áäčďéíĺľňóôŕšťúýž'],
    ['hu', 'Magyar', 'HUN', LATIN + 'áéíóöőúüű'],
    ['ro', 'Română', 'RON', LATIN + 'ăâîșț'],
    ['tr', 'Türkçe', 'TUR', 'abcçdefgğhıijklmnoöprsştuüvyz'],
    ['nl', 'Nederlands', 'NLD', LATIN],
    ['sv', 'Svenska', 'SVE', LATIN + 'åäö'],
    ['da', 'Dansk', 'DAN', LATIN + 'æøå'],
    ['no', 'Norsk', 'NOR', LATIN + 'æøå'],
    ['fi', 'Suomi', 'FIN', LATIN + 'åäö'],
    ['vi', 'Tiếng Việt', 'VIE', LATIN + 'ăâđêôơưáàảãạéèẻẽẹíìóòúù'],
    ['el', 'Ελληνικά', 'ΕΛΛ', 'αβγδεζηθικλμνξοπρστυφχψωάέήίόύώ'],
    ['bg', 'Български', 'БЪЛ', 'абвгдежзийклмнопрстуфхцчшщъьюя']
  ];
  var KB = {};
  KB_LAYOUTS.forEach(function (l) { KB[l[0]] = l[3].split(''); });
  var KB_NUM = '1234567890_-.@!?#&()+:/\'"%*,;~$'.split('');

  Pages.search = function () {
    var query = '';
    var layout = KB[Settings.get('kb')] ? Settings.get('kb') : 'en';
    var symbols = false;
    var el = h('section.page.page-search');
    var field = h('div.search-field', null, [h('span.search-icon', { html: UI.icon('search') }), h('span.search-text', { 'data-ph': tr('Поиск каналов и игр') }), h('span.search-caret')]);
    var tabs = h('div.kb-tabs', { 'data-group': 'kbtabs' });
    var keys = h('div.kb-keys', { 'data-group': 'kb' });
    var kb = h('div.kb', null, [field, tabs, keys]);
    var resultsContent = h('div.v-content');
    var results = h('div.search-results.v-scroll', { 'data-pad': '1' }, resultsContent);
    el.appendChild(kb);
    el.appendChild(results);
    var lastKey = null;

    function layoutOf(code) { return KB_LAYOUTS.filter(function (l) { return l[0] === code; })[0] || KB_LAYOUTS[2]; }

    // Раскладка — кнопка со списком (OK → выбрать из списка), рядом переключатель цифр/символов
    var layoutBtn = h('div.kb-tab.kb-layout.focusable');
    layoutBtn._onclick = function () {
      UI.menu(tr('Раскладка клавиатуры'), KB_LAYOUTS.map(function (l) {
        return { label: l[1], sub: l[2], selected: !symbols && l[0] === layout, onSelect: function () {
          layout = l[0]; symbols = false;
          Settings.set('kb', layout);
          markTabs(); buildKeys(true);
        } };
      }), { cls: 'menu-right' });
    };
    var symBtn = h('div.kb-tab.kb-sym.focusable');
    symBtn._onclick = function () { symbols = !symbols; markTabs(); buildKeys(true); };
    tabs.appendChild(layoutBtn);
    tabs.appendChild(symBtn);
    function markTabs() {
      layoutBtn.innerHTML = UI.icon('keyboard') + '<span>' + U.esc(layoutOf(layout)[1]) + '</span><span class="kb-caret">&#9662;</span>';
      symBtn.textContent = symbols ? layoutOf(layout)[2] : '123';
      symBtn.classList.toggle('active', symbols);
    }

    function key(label, cls, fn, html) {
      var k = h('div.kb-key.focusable' + (cls ? '.' + cls : ''), html ? { html: html } : { text: label });
      k._onclick = function () { lastKey = k; fn(); };
      keys.appendChild(k);
      return k;
    }

    function buildKeys(keepFocus) {
      var hadFocus = keepFocus || (Nav.current && keys.contains(Nav.current));
      keys.innerHTML = '';
      lastKey = null;
      var letters = (symbols ? KB_NUM : KB[layout]).slice();
      // добиваем цифрами до ровной сетки по 7 в ряд
      var digits = '1234567890-._'.split('');
      while (letters.length % 7 && !symbols && digits.length) letters.push(digits.shift());
      letters.forEach(function (ch) { key(ch, null, function () { type(ch); }); });
      keys.appendChild(h('div.kb-row'));
      key('', 'kb-wide', function () { type(' '); }, UI.icon('space') + '<span>' + U.esc(tr('Пробел')) + '</span>');
      key('', 'kb-wide', backspace, UI.icon('backspace') + '<span>' + U.esc(tr('Стереть')) + '</span>');
      key(tr('Очистить'), 'kb-wide.kb-full', function () { setQuery(''); });
      if (hadFocus && App.topLayer() === App.base) Nav.focus(keys.firstChild);
    }

    function type(ch) { setQuery(query + ch); }
    function backspace() { setQuery(query.slice(0, -1)); }

    function setQuery(q) {
      q = q.slice(0, 40);
      if (q === query && resultsContent.children.length) return;
      query = q;
      var txt = U.$('.search-text', field);
      txt.textContent = query;
      txt.scrollLeft = txt.scrollWidth; // длинный запрос — видно конец, то, что сейчас набрали
      field.classList.toggle('is-empty', !query);
      field.classList.toggle('typing', !!query);
      runSearch();
    }

    // Результаты перерисовались, а фокус был в них — возвращаем на клавиатуру, а не теряем
    function keepFocus() {
      var cur = Nav.current;
      if (App.topLayer() !== App.base || !el.isConnected) return;
      if (!cur || !cur.isConnected) Nav.focus(lastKey && lastKey.isConnected ? lastKey : keys.firstChild);
    }

    function remembered(make) {
      return function (data) {
        var card = make(data);
        var orig = card._onclick;
        card._onclick = function () { remember(query.trim()); orig(card); };
        return card;
      };
    }

    var seq = 0;
    var runSearch = U.debounce(function () {
      var my = ++seq;
      var q = query.trim();
      resultsContent.innerHTML = '';
      resultsContent.style.transform = '';
      results._y = 0;
      if (q.length < 2) { renderHistory(); keepFocus(); return; }
      resultsContent.appendChild(UI.loading());
      keepFocus();
      Twitch.search(q).then(function (r) {
        if (my !== seq) return;
        resultsContent.innerHTML = '';
        var any = false;
        if (r.live.length) {
          any = true;
          var s1 = UI.shelf(tr('Трансляции'));
          s1.add(r.live.map(remembered(streamCard)));
          resultsContent.appendChild(s1);
        }
        if (r.channels.length) {
          any = true;
          var s2 = UI.shelf(tr('Каналы'));
          s2.add(r.channels.map(remembered(channelCard)));
          resultsContent.appendChild(s2);
        }
        if (r.games.length) {
          any = true;
          var s3 = UI.shelf(tr('Категории'));
          s3.add(r.games.map(remembered(gameCard)));
          resultsContent.appendChild(s3);
        }
        if (!any) resultsContent.appendChild(UI.empty(tr('Ничего не найдено'), tr('Попробуйте другой запрос')));
        keepFocus();
      }, function (e) {
        if (my !== seq) return;
        resultsContent.innerHTML = '';
        resultsContent.appendChild(UI.error(e, function () { runSearch(); }));
        keepFocus();
      });
    }, 450);

    function remember(q) {
      if (!q || q.length < 2) return;
      var hist = U.store.get('searchHistory', []).filter(function (x) { return x !== q; });
      hist.unshift(q);
      U.store.set('searchHistory', hist.slice(0, 12));
    }

    function renderHistory() {
      var hist = U.store.get('searchHistory', []);
      if (hist.length) {
        var box = h('div.row.search-history', { 'data-group': 'free' }, [h('h2.shelf-title', { text: tr('Недавние запросы') })]);
        hist.forEach(function (q) {
          var c = h('div.chip.focusable', { text: q });
          c._onclick = function () { setQuery(q); };
          box.appendChild(c);
        });
        resultsContent.appendChild(box);
      }
      autoShelf(resultsContent, tr('Популярные каналы сейчас'), function () { return Twitch.topStreams(20).then(function (p) { return p.items; }); }, streamCard);
    }

    markTabs();
    buildKeys();
    setQuery('');
    return {
      el: el, nav: 'search',
      firstFocus: function () { return lastKey && lastKey.isConnected ? lastKey : keys.firstChild; },
      onKey: function (k, e) {
        var cur = Nav.current;
        var inResults = !!cur && results.contains(cur);
        var inKb = !!cur && kb.contains(cur);
        // вверх/вниз — только внутри своей колонки: из результатов не прыгаем на клавиатуру и наоборот
        if ((k === 'UP' || k === 'DOWN') && (inResults || inKb)) {
          var sc = Nav.scope;
          Nav.setScope(inResults ? results : kb);
          Nav.move(k.toLowerCase());
          Nav.setScope(sc);
          return true;
        }
        // «Назад» из результатов — к клавиатуре (как в YouTube TV), а не в боковое меню
        if (k === 'BACK' && inResults) {
          Nav.focus(lastKey && lastKey.isConnected ? lastKey : keys.firstChild);
          return true;
        }
        // физическая клавиатура / пульт с клавиатурой
        if (e && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { type(e.key); return true; }
        return false;
      }
    };
  };

  // ---------- Аккаунт: вход по коду, как в официальном приложении Twitch для ТВ ----------
  Pages.account = function (params) {
    var el = pageShell('page-account');
    var poller = null;
    var u = Auth.user();

    if (u && !params.add) {
      el.content.appendChild(header(tr('Аккаунт')));
      var expired = Auth.needsLogin();
      var actions = h('div.account-actions', { 'data-group': 'free' }, [
        expired ? UI.button(tr('Войти снова'), 'refresh', function () { App.go('account', { add: true }); }, 'primary') : null,
        UI.button(tr('Сменить профиль'), 'person', function () { App.showProfiles(); }),
        UI.button(tr('Добавить аккаунт'), null, function () { App.go('account', { add: true }); }),
        UI.button(tr('Обновить подписки'), 'refresh', function () {
          Auth.syncFollows().then(function (l) { UI.toast(tr('Подписок: ') + l.length); }, function (e) { UI.toast(e.message); });
        }),
        UI.button(tr('Выйти'), null, function () {
          UI.confirm(tr('Выйти из аккаунта?'), u.displayName, tr('Выйти'), function () { Auth.logout(); App.go('home', {}, { root: true, force: true }); });
        })
      ]);
      el.content.appendChild(h('div.account-card.row', null, [
        h('img.account-avatar', { src: u.profileImageURL || '', alt: '' }),
        h('div.account-info', null, [
          h('div.account-name', { text: u.displayName }),
          h('div.account-sub' + (expired ? '.account-expired' : ''), { text: expired ? tr('Вход в Twitch устарел. Избранное и подписки сохранены — просто войдите снова по коду.') : tr('Подписок: ') + Auth.cachedFollows().length }),
          actions
        ])
      ]));
      return { el: el, nav: 'account', firstFocus: function () { return U.$('.btn', actions); } };
    }

    el.content.appendChild(header(params.add ? tr('Добавить аккаунт') : tr('Вход в Twitch')));
    var box = h('div.activate.row');
    el.content.appendChild(box);
    var retry = UI.button(tr('Получить новый код'), 'refresh', start, 'primary');

    function start() {
      if (poller) poller.stop();
      box.innerHTML = '';
      box.appendChild(UI.loading());
      Auth.startDevice().then(function (dev) {
        box.innerHTML = '';
        var url = dev.verification_uri || 'https://www.twitch.tv/activate';
        var qr = '';
        try {
          var q = qrcode(0, 'M');
          q.addData(url);
          q.make();
          qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
        } catch (e) { qr = ''; }
        box.appendChild(h('div.activate-steps', null, [
          h('div.activate-step', { html: '<b>1</b>' + U.esc(tr('На телефоне или компьютере откройте')) + ' <span class="activate-url">twitch.tv/activate</span>' }),
          h('div.activate-step', { html: '<b>2</b>' + U.esc(tr('Войдите в Twitch и введите код:')) }),
          h('div.activate-code', { text: dev.user_code }),
          h('div.activate-step.muted', { text: tr('Или наведите камеру телефона на QR-код — код подставится сам') }),
          h('div.activate-wait', null, [h('div.spinner.small'), h('span', { text: tr('Ждём подтверждения…') })]),
          h('div', { 'data-group': 'free' }, retry)
        ]));
        if (qr) box.appendChild(h('div.activate-qr', { html: qr }));
        App.refocus();
        poller = Auth.poll(dev);
        poller.then(function (user) {
          UI.toast(tr('Добро пожаловать, ') + user.displayName + '!');
          App.go('home', {}, { root: true, force: true });
        }, function (e) {
          var w = U.$('.activate-wait', box);
          if (w) w.innerHTML = '<span class="err">' + U.esc(e.message) + '</span>';
        });
      }, function (e) {
        box.innerHTML = '';
        box.appendChild(UI.empty(tr('Не удалось начать вход'),
          (e && e.message ? e.message + '. ' : '') + tr('Проверьте интернет. Если ошибка повторяется — вход с этого ТВ не поддерживается, используйте ♥ «Избранное».')));
        box.appendChild(h('div', { 'data-group': 'free' }, retry));
        App.refocus();
      });
    }
    start();
    return {
      el: el, nav: 'account',
      firstFocus: function () { return U.$('.btn', box); },
      onHide: function () { if (poller) poller.stop(); },
      destroy: function () { if (poller) poller.stop(); }
    };
  };

  // ---------- Настройки ----------
  Pages.settings = function () {
    var el = pageShell('page-settings');
    el.content.appendChild(header(tr('Настройки')));
    var list = h('div.settings-list', { 'data-group': 'free' });
    el.content.appendChild(list);

    function section(title) { list.appendChild(h('h2.set-section.row', { text: title })); }

    // Параметр: OK открывает список значений справа (как в YouTube TV), а не листание ← →
    function opt(label, key, values, hint, onChange) {
      var valueEl = h('div.set-value');
      var row = h('div.set-row.row.focusable', null, [
        h('div.set-text', null, [h('div.set-label', { text: label }), hint ? h('div.set-hint', { text: hint }) : null]),
        h('div.set-control', null, [valueEl, h('span.set-go', { html: '&#8250;' })])
      ]);
      function find(v) {
        for (var i = 0; i < values.length; i++) if (String(values[i][0]) === String(v)) return values[i];
        return null;
      }
      // неизвестное сохранённое значение — показываем то, что приложение реально использует (значение по умолчанию)
      function current() { return find(Settings.get(key)) || find(DEFAULTS[key]) || values[0]; }
      function show() { valueEl.textContent = current()[1]; }
      row._onclick = function () {
        var cur = current();
        UI.menu(label, values.map(function (v) {
          return { label: v[1], sub: v[2] || null, selected: v === cur, onSelect: function () {
            if (String(v[0]) === String(Settings.get(key))) return;
            Settings.set(key, v[0]);
            show();
            if (onChange) onChange(v[0]);
          } };
        }), { cls: 'menu-right' });
      };
      show();
      list.appendChild(row);
      return row;
    }

    function action(label, hint, fn) {
      var row = h('div.set-row.row.focusable', null, [
        h('div.set-text', null, [h('div.set-label', { text: label }), hint !== null && hint !== undefined ? h('div.set-hint', { text: hint }) : null]),
        h('div.set-control', null, h('span.set-go', { html: '&#8250;' }))
      ]);
      row._onclick = fn;
      list.appendChild(row);
      return row;
    }

    var sup = Twitch.codecSupport();
    var u = Auth.user();

    section(tr('Аккаунт'));
    action(u ? u.displayName : tr('Войти в Twitch'), u ? (Auth.needsLogin() ? tr('Вход устарел — нажмите, чтобы войти снова') : tr('Профили, подписки, выход')) : tr('Вход по коду на twitch.tv/activate — подписки подтянутся сами'), function () { App.go('account', {}, { root: true }); });
    if (Auth.accounts.length > 1) action(tr('Сменить профиль'), tr('Кто смотрит?'), function () { App.showProfiles(); });
    opt(tr('Смотреть от своего аккаунта'), 'useAccount', [['on', tr('Да')], ['off', tr('Нет')]],
      tr('С Turbo или подпиской на канал — без рекламы и с доступом к записям для подписчиков'));

    section(tr('Язык'));
    opt(tr('Язык интерфейса'), 'uiLang', I18N.LANGS, null, function () {
      App.reload();
    });
    opt(tr('Язык трансляций на главной'), 'lang', LANGS, null, function () { Twitch.clearCache(); });
    opt(tr('Раскладка клавиатуры поиска'), 'kb', KB_LAYOUTS.map(function (l) { return [l[0], l[1]]; }));

    section(tr('Видео'));
    opt(tr('Качество видео'), 'quality', [['auto', tr('Авто')], ['1440p60', '1440p60'], ['1080p60', '1080p60'], ['1080p', '1080p'], ['720p60', '720p60'], ['720p', '720p'], ['480p', '480p'], ['360p', '360p'], ['160p', '160p']],
      tr('Авто подбирает качество под скорость интернета. Если эфир тормозит — поставьте 720p.'));
    opt(tr('Кодек (улучшенное качество)'), 'codec', [['auto', tr('Авто: HEVC/AV1, если ТВ умеет')], ['hevc', tr('HEVC + H.264')], ['h264', tr('Только H.264 (максимум стабильности)')]],
      tr('Twitch Enhanced Broadcasting: до 1440p и чётче картинка при той же скорости. Ваш ТВ: ') +
      'H.264 ' + (sup.h264 ? '✓' : '✗') + ', HEVC ' + (sup.hevc ? '✓' : '✗') + ', AV1 ' + (sup.av1 ? '✓' : '✗'));
    opt(tr('Пропуск рекламы Twitch'), 'adblock', [['on', tr('Включён')], ['off', tr('Выключен')]],
      tr('Во время рекламной паузы («Commercial break in progress») плеер переключается на резервный поток Twitch без рекламы.'));
    opt(tr('Задержка эфира'), 'latency', [['low', tr('Минимальная')], ['normal', tr('Обычная')], ['stable', tr('Стабильная (большой буфер)')]],
      tr('Стабильная — меньше подвисаний при слабом Wi‑Fi, но отставание от эфира больше.'));
    opt(tr('Видеодвижок'), 'engine', [['hls', tr('hls.js (рекомендуется)')], ['native', tr('Встроенный в ТВ')]],
      tr('Встроенный — запасной вариант, если hls.js не работает на вашей прошивке.'));
    opt(tr('Тип плеера Twitch'), 'playerType', [['site', 'site'], ['embed', 'embed'], ['popout', 'popout']],
      tr('Если эфир не запускается, попробуйте другой вариант.'));

    section(tr('Чат'));
    opt(tr('Чат при открытии эфира'), 'chat', [['on', tr('Включён')], ['off', tr('Выключен')]], tr('Во время эфира чат включается зелёной кнопкой пульта.'));
    var O = Player.CHAT_OPTS;
    opt(tr('Вид чата'), 'chatMode', O.chatMode);
    opt(tr('Сторона чата'), 'chatSide', O.chatSide);
    opt(tr('Подложка чата'), 'chatOpacity', O.chatOpacity);
    opt(tr('Ширина чата'), 'chatWidth', O.chatWidth);
    opt(tr('Высота чата'), 'chatHeight', O.chatHeight);
    opt(tr('Размер текста чата'), 'chatFont', O.chatFont);

    section(tr('Интерфейс'));
    opt(tr('Превью эфиров на главной'), 'preview', [['on', tr('Включено')], ['off', tr('Выключено')]], tr('Живое видео в баннере и карточках. Выключите, если интерфейс подтормаживает.'));
    opt(tr('Звук в превью'), 'previewSound', [['on', tr('Включён')], ['off', tr('Выключен')]], tr('Превью в карточке играет со звуком, как в YouTube.'));
    opt(tr('Облегчённый режим'), 'lite', [['auto', tr('Авто')], ['off', tr('Выключен')], ['on', tr('Включён')]],
      tr('Без анимаций и превью — максимально плавно на слабых ТВ.'), function () { App.applyLite(); });
    opt(tr('Уведомления о прогнозах и голосованиях'), 'eventsNotify', [['on', tr('Включены')], ['off', tr('Выключены')]],
      tr('Когда стример запускает прогноз или голосование — в плеере всплывает подсказка. Участвовать можно и через «Параметры» плеера.'));
    opt(tr('Уведомления о начале эфиров'), 'notify', [['on', tr('Включены')], ['off', tr('Выключены')]], tr('Когда ваш канал начинает эфир — всплывает подсказка.'));
    opt(tr('При запуске'), 'resume', [['on', tr('Продолжить с того же места')], ['off', tr('Открывать главную')]],
      tr('Приложение откроется там, где вы из него вышли, — на той же странице или в том же эфире.'));
    opt(tr('Масштаб интерфейса'), 'scale', [['90', '90%'], ['100', '100%'], ['110', '110%'], ['120', '120%']], null, function () { App.applyScale(); });

    section(tr('Телевизор'));
    var info = App.tvInfo();
    var speedRow = action(tr('Проверить скорость интернета'), tr('Подскажет лучшее качество видео для вашего подключения'), function () {
      var hint = U.$('.set-hint', speedRow);
      hint.textContent = tr('Измеряю…');
      App.speedTest().then(function (mbps) {
        var rec = mbps > 14 ? '1080p60' : mbps > 8 ? '1080p' : mbps > 5 ? '720p60' : mbps > 3 ? '720p' : '480p';
        hint.textContent = mbps.toFixed(1) + tr(' Мбит/с • рекомендуем: ') + rec;
      }, function () { hint.textContent = tr('Не удалось измерить'); });
    });
    list.appendChild(h('div.tv-info.row', null, info.map(function (r) {
      return h('div.tv-info-row', null, [h('span', { text: r[0] }), h('b', { text: r[1] })]);
    })));

    section(tr('Данные'));
    var blockedRow = action(tr('Заблокированные каналы'), '', function () {
      var list = App.blocked();
      if (!list.length) { UI.toast(tr('Список пуст')); return; }
      UI.menu(tr('Разблокировать канал'), list.map(function (login) {
        return { label: login, onSelect: function () { App.setBlocked(login, false); UI.toast(tr('Канал разблокирован: ') + login); showBlocked(); } };
      }), { cls: 'menu-right' });
    });
    function showBlocked() { U.$('.set-hint', blockedRow).textContent = App.blocked().length ? tr('Заблокировано: ') + App.blocked().length : tr('Никого не заблокировано'); }
    showBlocked();
    action(tr('Очистить избранное'), tr('Удалить все каналы из избранного'), function () {
      UI.confirm(tr('Очистить избранное?'), tr('Список каналов будет удалён.'), tr('Очистить'), function () { App.setFavs([]); UI.toast(tr('Избранное очищено')); });
    });
    action(tr('Очистить историю'), tr('История просмотров, поиска и позиции записей'), function () {
      U.store.set('searchHistory', []); U.store.set('vodpos', {}); U.store.set('watchHistory', []); UI.toast(tr('История очищена'));
    });
    action(tr('Сообщить о проблеме'), tr('QR-код на страницу GitHub — опишите, что не работает'), function () { App.reportProblem('settings'); });
    action(tr('Перезапустить приложение'), null, function () { location.reload(); });

    var url = location.href.split('#')[0].split('?')[0];
    el.content.appendChild(h('div.about.row', null, [
      h('div.about-title', { text: 'Twitch TV ' + tr('для Hisense VIDAA • версия ') + App.VERSION }),
      h('div.about-text', { text: tr('Разработчик: ') + 'github.com/PainFrenemy2' + ' • ' + tr('Издатель: ') + 'Null/Code' }),
      h('div.about-text', { text: tr('Работает на телевизорах Hisense и других ТВ с системой VIDAA (Toshiba, Sharp, Loewe и др.).') }),
      h('div.about-text', { text: tr('Источник видео, чата и данных — Twitch (twitch.tv). Twitch и логотип Twitch — товарные знаки Twitch Interactive, Inc. Это неофициальное приложение: оно не связано с Twitch и не одобрено им. Все права на трансляции, записи и клипы принадлежат их авторам и Twitch.') }),
      h('div.about-text', { text: tr('Адрес приложения: ') + url }),
      h('div.about-text', { text: tr('Кнопки пульта: OK — выбор, Назад — назад, CH+/CH− — переключение эфиров, красная — качество, зелёная — чат, жёлтая — избранное, синяя — перезагрузить поток.') })
    ]));
    return { el: el, nav: 'settings' };
  };

  window.Pages = Pages;
})();
