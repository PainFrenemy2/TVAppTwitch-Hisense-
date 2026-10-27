/* Страницы приложения + настройки */
(function () {
  'use strict';
  var h = U.h;

  // ---------- Настройки ----------
  var DEFAULTS = {
    quality: 'auto', latency: 'normal', chat: 'on', chatMode: 'overlay', chatSide: 'right', chatOpacity: '30',
    chatWidth: 'normal', chatFont: 'normal', chatHeight: 'full', lang: I18N.tvLang().split('-')[0], uiLang: I18N.tvLang(),
    resume: 'on', adblock: 'on', eventsNotify: 'on', autoClaim: 'on',
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
      if (!items || !items.length) { if (shelf.parentNode) shelf.parentNode.removeChild(shelf); App.refocus(); return 0; }
      shelf.add(items.map(makeCard));
      App.refocus();
      return items.length;
    }, function (e) {
      if (shelf.parentNode) shelf.parentNode.removeChild(shelf);
      if (window.console) console.warn(title, e);
      App.refocus(); // полки сверху больше нет — фокус ждал её, переходим к следующей
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

  // Мои каналы в эфире: с аккаунтом — сразу из подписок, иначе по избранному.
  // Баннер, ряд главной и «Отслеживаемое» спрашивают одновременно — один запрос на 30 секунд.
  var myLiveMemo = { at: 0, p: null };
  function myLive() {
    if (myLiveMemo.p && Date.now() - myLiveMemo.at < 30000) return myLiveMemo.p;
    myLiveMemo = { at: Date.now(), p: myLiveRaw() };
    myLiveMemo.p.catch(function () { myLiveMemo.p = null; });
    return myLiveMemo.p;
  }
  function myLiveRaw() {
    var favs = App.favs();
    var acc = Auth.loggedIn() ? Auth.followedLiveSafe().catch(function () { return []; }) : Promise.resolve([]);
    var loc = favs.length ? Twitch.users(favs).then(liveOf).catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([acc, loc]).then(function (r) {
      var seen = {}, out = [];
      r[0].concat(r[1]).forEach(function (s) {
        var l = s.broadcaster && s.broadcaster.login;
        if (l && !seen[l]) { seen[l] = 1; out.push(s); }
      });
      // порядок не трогаем: сначала отслеживаемые в порядке Twitch, потом избранное
      return out;
    });
  }

  // Клипы и новые записи каналов, за которыми вы следите (по 4 запроса за раз)
  function followedClips(period, limit) {
    var logins = App.myChannels().slice(0, 8);
    return U.pool(logins, 3, function (l) { return Twitch.clips(l, period || 'LAST_WEEK', 6).catch(function () { return []; }); })
      .then(function (lists) { return byViews(lists, limit || 30); });
  }
  function followedVideos(limit) {
    return U.pool(App.myChannels().slice(0, 12), 3, function (l) {
      return Twitch.videos(l, 'ARCHIVE', 4).then(function (p) { return p.items; }).catch(function () { return []; });
    }).then(function (lists) {
      return [].concat.apply([], lists.map(function (x) { return x || []; }))
        .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).slice(0, limit || 30);
    });
  }
  function byViews(lists, limit) {
    var seen = {}, out = [];
    [].concat.apply([], lists.map(function (x) { return x || []; })).forEach(function (c) { if (c && c.slug && !seen[c.slug]) { seen[c.slug] = 1; out.push(c); } });
    return out.sort(function (a, b) { return (b.viewCount || 0) - (a.viewCount || 0); }).slice(0, limit);
  }

  // ---------- Превью эфира (одно на всё приложение, минимальное качество — бережём ТВ) ----------
  var Preview = {
    hls: null, timer: null, video: null, gen: 0,
    start: function (video, login) {
      Preview.stop();
      if (Settings.get('preview') === 'off' || App.isLite() || !window.Hls || !Hls.isSupported() || Player.isOpen()) return;
      var gen = Preview.gen;
      Preview.timer = setTimeout(function () {
        if (typeof video === 'function') video = video(); // элемент видео — по требованию
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
    var keysAtOpen = App.keyCount;
    // Баннер как на ПК: сразу — эфиры каналов, за которыми вы следите (они приходят быстро), затем
    // добавляются рекомендации Twitch. Ничего нет — популярные на вашем языке. Пока грузится, место
    // под баннер занято, чтобы страница не прыгала вниз, когда он появится.
    hero.classList.add('loading');
    function heroDone() { hero.classList.remove('loading'); }
    function addHero(list) {
      var seen = {};
      heroItems.forEach(function (x) { seen[x.broadcaster.login] = 1; });
      list.forEach(function (x) {
        var l = x && x.broadcaster && x.broadcaster.login;
        if (l && !seen[l] && !App.isBlocked(l) && heroItems.length < 8) { seen[l] = 1; heroItems.push(x); }
      });
      if (!heroItems.length) return false;
      if (heroEl.parentNode) {
        U.$('.hero-dots', heroEl).innerHTML = heroItems.map(function (_, k) { return '<i' + (k === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
        return true;
      }
      heroDone();
      hero.appendChild(heroEl);
      showHero(0);
      // главная открылась, а пользователь ещё ничего не нажимал — выбор на самом верхнем элементе (баннер)
      var cur = Nav.current;
      if (App.keyCount === keysAtOpen && App.topLayer() === App.base && el.isConnected && (!cur || el.contains(cur))) Nav.focus(heroEl);
      else App.refocus();
      return true;
    }
    var followedHero = Auth.loggedIn() ? myLive().then(addHero, function () { return false; }) : Promise.resolve(false);
    Promise.all([followedHero, Twitch.personalShelves()]).then(function (r) {
      var st = [];
      r[1].forEach(function (row) { row.items.forEach(function (it) { if (it.type === 'Stream') st.push(it.data); }); });
      if (addHero(st)) return;
      return Twitch.topStreamsByLang(lang, 8).catch(function () { return Twitch.topStreams(8); }).then(function (p) { addHero(p.items); });
    }).catch(function () {}).then(heroDone);

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
      var k = n === undefined || n === null ? 2 : n; // 0 — значит «ничего не достраивать», а не 2
      while (k-- > 0 && queue.length) queue.shift()();
    };
    function later(fn) { queue.push(fn); }

    function renderMain() {
      body.innerHTML = '';
      queue = [];
      personalDone = false;
      clearTimeout(lateTimer);
      if (App.myChannels().length || Auth.loggedIn()) {
        autoShelf(body, Auth.loggedIn() ? tr('Подписки в эфире') : tr('Избранное в эфире'), myLive, streamCard, { cls: 'shelf-favs' });
      }
      // ряды главной Twitch — «Рекомендованные каналы», «Категории, которые вам понравятся» и т.д.
      personalRows();
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
      // С аккаунтом главная — как у Twitch: только ваше (подписки, рекомендации Twitch, ваши клипы и записи, история).
      // Общие «популярные» ряды — без входа или если Twitch не отдал персональные ряды.
      if (signedIn()) {
        later(function () { autoShelf(body, tr('Ваши категории'), function () {
          // нет отслеживаемых категорий — берём те, в которых обычно стримят ваши каналы
          return Auth.followedGames().catch(function () { return []; }).then(function (g) { return g.length ? g : Twitch.tasteGames(Auth.cachedFollows()); });
        }, gameCard, { game: true, skeleton: 8 }); });
        later(function () { autoShelf(body, tr('Клипы ваших подписок'), function () { return followedClips('LAST_WEEK', 24); }, clipCard); });
        later(function () { autoShelf(body, tr('Новые записи ваших каналов'), function () { return followedVideos(24); }, videoCard); });
        // остальные ряды — когда придут персональные (не забиваем сеть ТВ залпом запросов при открытии),
        // но не позже чем через 4 секунды, если Twitch отвечает медленно
        clearTimeout(lateTimer);
        lateTimer = setTimeout(function () { if (body.isConnected && !personalDone) afterPersonal(); }, 4000);
        return;
      }
      genericRows(true);
    }

    function signedIn() { return Auth.loggedIn() && !Auth.needsLogin(); }

    function genericRows(top) {
      var langName = (LANGS.filter(function (l) { return l[0] === lang; })[0] || ['', ''])[1];
      // «Популярные трансляции» всегда во второй-третьей строке
      queue[top ? 'unshift' : 'push'](function () {
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

    var MAKE = { Stream: streamCard, Game: gameCard, Clip: clipCard, Video: videoCard };
    // персональные ряды пришли (или вместо них — рекомендации): достраиваем экран до 4 рядов
    var personalDone = false, lateTimer = null;
    function afterPersonal() { personalDone = true; clearTimeout(lateTimer); body._lazy(Math.max(0, 4 - body.children.length)); }

    function personalRows() {
      var holder = autoShelf(body, tr('Рекомендуем для вас'), function () { return new Promise(function () {}); }, streamCard);
      Twitch.personalShelves().then(function (rows) {
        if (!holder.parentNode) return;
        // Twitch не отдал персональные ряды — рекомендуем сами по вашим каналам и категориям
        if (!rows.length && signedIn()) { var after = holder.nextSibling; holder.parentNode.removeChild(holder); recommendRows(after); afterPersonal(); return; }
        // ряды добавляем по одному с паузой — слабый ТВ не строит 8 полок по 16 карточек разом
        var i = 0;
        function nextRow() {
          if (!holder.parentNode) return;
          var r = rows[i++];
          if (!r) { holder.parentNode.removeChild(holder); App.refocus(); afterPersonal(); return; }
          var type = r.items[0].type;
          var shelf = UI.shelf(r.title, type === 'Game' ? { cls: 'shelf-games' } : null);
          shelf.add(r.items.filter(function (it) { return it.type === type; }).slice(0, 16).map(function (it) { return MAKE[type](it.data); }));
          if (shelf.track.children.length) body.insertBefore(shelf, holder);
          if (i === 1) App.refocus();
          setTimeout(nextRow, i < 2 ? 0 : 120);
        }
        nextRow();
      });
    }

    // Рекомендации без персональных рядов Twitch: эфиры в категориях, где сейчас ваши каналы и которые вы отслеживаете
    // before — место, где стоял ряд-заглушка персональных рядов (рекомендации встают туда же, а не в конец)
    function recommendRows(before) {
      var holder = autoShelf(body, tr('Рекомендуем для вас'), function () { return new Promise(function () {}); }, streamCard, { before: before });
      var mineSet = {};
      App.myChannels().forEach(function (l) { mineSet[l] = 1; });
      Promise.all([myLive().catch(function () { return []; }), Auth.followedGames().catch(function () { return []; }),
        Twitch.tasteGames(Auth.cachedFollows()).catch(function () { return []; })]).then(function (r) {
        if (!holder.parentNode) return; // пока грузили, переключили категорию
        r[0].forEach(function (st) { if (st.broadcaster) mineSet[st.broadcaster.login] = 1; }); // отслеживаемые — не в рекомендации
        var games = [], seen = {};
        r[0].forEach(function (st) { var g = st.game; if (g && g.name && !seen[g.name]) { seen[g.name] = 1; games.push(g); } });
        r[1].forEach(function (g) { if (g && g.name && !seen[g.name]) { seen[g.name] = 1; games.push(g); } });
        // во что обычно играют ваши каналы — сначала то, что встречается чаще
        var taste = r[2].filter(function (g) { return g && g.name && !seen[g.name]; });
        // любимая категория подписок важнее случайной игры единственного эфира — ставим её второй
        if (taste.length) { seen[taste[0].name] = 1; games.splice(Math.min(1, games.length), 0, taste.shift()); }
        taste.forEach(function (g) { if (!seen[g.name]) { seen[g.name] = 1; games.push(g); } });
        games = games.slice(0, 4);
        if (!games.length) { holder.parentNode.removeChild(holder); genericRows(false); afterPersonal(); App.refocus(); return; }
        // как на twitch.tv: «Активные каналы, которые могут вам понравиться» — эфиры из ваших категорий вперемешку
        autoShelf(body, tr('Активные каналы, которые могут вам понравиться'), function () {
          return Promise.all(games.map(function (g) { return Twitch.gameStreams(g.name, 12).then(function (p) { return p.items; }).catch(function () { return []; }); }))
            .then(function (lists) {
              var out = [], seen = {};
              for (var k = 0; k < 12; k++) lists.forEach(function (l) {
                var st = l[k];
                if (st && st.broadcaster && !mineSet[st.broadcaster.login] && !seen[st.broadcaster.login]) { seen[st.broadcaster.login] = 1; out.push(st); }
              });
              return out.slice(0, 24);
            });
        }, streamCard, { before: holder });
        // и ряд по каждой вашей категории
        games.slice(0, 3).forEach(function (g) {
          autoShelf(body, tr('Ещё в категории: ') + (g.displayName || g.name), function () {
            return Twitch.gameStreams(g.name, 20).then(function (p) {
              return p.items.filter(function (st) { return st.broadcaster && !mineSet[st.broadcaster.login]; });
            });
          }, streamCard, { before: holder });
        });
        holder.parentNode.removeChild(holder);
        App.refocus();
      });
    }

    function renderGame(g) {
      body.innerHTML = '';
      queue = [];
      clearTimeout(lateTimer);
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
    body._lazy = function (n) { var k = n === undefined || n === null ? 2 : n; while (k-- > 0 && queue.length) queue.shift()(); };
    function gameClips(g) { return Twitch.gameClips(g.name, 20, period); }

    function render() {
      var my = ++gen;
      body.innerHTML = '';
      queue = [];
      var games = Twitch.topGames(8).then(function (p) { return p.items; });
      // с аккаунтом первым рядом — клипы ваших каналов, как в приложении Twitch
      if (Auth.loggedIn() && !Auth.needsLogin()) autoShelf(body, tr('Клипы ваших подписок'), function () { return followedClips(period, 30); }, clipCard);
      autoShelf(body, tr('В тренде'), function () {
        return games.then(function (gs) {
          return Promise.all(gs.slice(0, 6).map(function (g) { return gameClips(g).catch(function () { return []; }); }));
        }).then(function (lists) { return byViews(lists, 30); });
      }, clipCard);
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

  // ---------- Эфир — лента эфиров как в приложении Twitch на телефоне ----------
  // Один большой эфир на экран с живым превью: ▲/▼ — следующий/предыдущий, OK — смотреть.
  // Сначала каналы, за которыми вы следите, потом эфиры из ваших категорий, потом популярные на вашем языке.
  Pages.live = function () {
    var el = h('section.page.page-live');
    var items = [], idx = 0, seen = {}, loading = null, sources = [], srcI = 0;
    var feed = h('div.live-feed.focusable', null, [
      h('div.live-media', null, [h('img.live-img', { alt: '' }), h('video.live-video', { playsinline: '' }), h('div.live-fade')]),
      h('div.live-info', null, [
        h('div.live-chan', null, [h('img.live-avatar', { alt: '' }), h('div', null, [h('div.live-name'), h('div.live-game')])]),
        h('div.live-title'),
        h('div.live-meta', null, [h('span.badge-inline.live', { text: tr('В ЭФИРЕ') }), h('span.live-viewers'), h('span.live-mine', { text: tr('Вы отслеживаете') })]),
        h('div.live-hint', { text: tr('▲ ▼ — листать эфиры • OK — смотреть') })
      ])
    ]);
    var empty = h('div.live-empty', { text: '' });
    var nextBox = h('div.live-next');
    el.appendChild(feed);
    el.appendChild(nextBox);
    el.appendChild(empty);
    var mine = {};

    function add(list, isMine) {
      (list || []).forEach(function (st) {
        var l = st && st.broadcaster && st.broadcaster.login;
        if (!l || seen[l] || App.isBlocked && App.isBlocked(l)) return;
        seen[l] = 1;
        if (isMine) mine[l] = 1;
        items.push(st);
      });
    }
    function more() {
      if (loading || srcI >= sources.length) return loading || Promise.resolve();
      var src = sources[srcI++];
      loading = src().catch(function () { return []; }).then(function (r) {
        loading = null;
        var before = items.length;
        add(r.list, r.mine);
        if (!items.length && srcI < sources.length) return more();
        if (before === 0 && items.length) show(0);
        else renderNext();
        if (!items.length && srcI >= sources.length) { empty.textContent = tr('Нет трансляций'); feed.classList.add('hidden'); }
      });
      return loading;
    }
    var lang = Settings.get('lang');
    sources.push(function () { return myLive().then(function (l) { return { list: l, mine: true }; }); });
    // рекомендации Twitch (если он их отдаёт этому входу) — как лента в приложении на телефоне
    sources.push(function () { return Twitch.liveRecs().then(function (l) { return { list: l }; }); });
    sources.push(function () {
      if (!Auth.loggedIn()) return Promise.resolve({ list: [] });
      return Twitch.tasteGames(Auth.cachedFollows()).then(function (games) {
        return U.pool(games.slice(0, 4), 2, function (g) { return Twitch.gameStreams(g.name, 10).then(function (p) { return p.items; }).catch(function () { return []; }); });
      }).then(function (lists) {
        var out = [];
        for (var k = 0; k < 10; k++) lists.forEach(function (l) { if (l && l[k]) out.push(l[k]); });
        return { list: out };
      });
    });
    sources.push(function () { return Twitch.topStreamsByLang(lang, 30).catch(function () { return Twitch.topStreams(30); }).then(function (p) { return { list: p.items }; }); });
    // дальше — популярные по всему Twitch, страница за страницей (лента не кончается)
    var topCursor = null;
    function topPage() {
      return Twitch.topStreams(30, topCursor).then(function (p) {
        topCursor = p.cursor;
        if (p.more && p.cursor) sources.push(topPage);
        return { list: p.items };
      });
    }
    sources.push(topPage);

    function renderNext() {
      var box = nextBox;
      box.innerHTML = '';
      for (var k = idx + 1; k <= idx + 3 && k < items.length; k++) {
        var st = items[k], b = st.broadcaster || {};
        box.appendChild(h('div.live-next-item', null, [h('img', { src: st.previewImageURL || '', alt: '' }), h('span', { text: b.displayName || b.login })]));
      }
    }
    function show(i) {
      if (!items.length) return;
      idx = Math.max(0, Math.min(i, items.length - 1));
      var st = items[idx], b = st.broadcaster || {};
      U.$('.live-img', feed).src = String(st.previewImageURL || '').replace('440x248', '1280x720');
      U.$('.live-avatar', feed).src = b.profileImageURL || '';
      U.$('.live-name', feed).textContent = b.displayName || b.login;
      U.$('.live-game', feed).textContent = st.game ? (st.game.displayName || st.game.name) : '';
      U.$('.live-title', feed).textContent = st.title || '';
      U.$('.live-viewers', feed).textContent = U.viewers(st.viewersCount);
      U.$('.live-mine', feed).style.display = mine[b.login] ? '' : 'none';
      renderNext();
      if (feed.classList.contains('focused')) Preview.start(U.$('.live-video', feed), b.login); else Preview.stop();
      if (idx >= items.length - 4) more();
    }
    feed._onfocus = function () { show(idx); };
    feed._onblur = function () { Preview.stop(); };
    feed._onclick = function () {
      if (!items.length) return;
      Preview.stop();
      var list = items.map(App.itemFromStream);
      App.play(list[idx], list);
    };
    feed._onkey = function (k) {
      if (k === 'DOWN') { if (idx < items.length - 1) show(idx + 1); else more(); return true; }
      if (k === 'UP') { if (idx > 0) show(idx - 1); return true; }
      if (k === 'RIGHT') return true;
      return false;
    };
    more().then(function () { App.refocus(); });
    return {
      el: el, nav: 'live',
      firstFocus: function () { return items.length ? feed : null; },
      onHide: function () { Preview.stop(); },
      onShow: function () { if (feed.classList.contains('focused')) show(idx); }
    };
  };

  // ---------- Подписки ----------
  Pages.following = function () {
    var el = pageShell('page-following');
    el.content.appendChild(header(tr('Отслеживаемое'), Auth.loggedIn() && Auth.user()
      ? Auth.user().displayName + ' • ' + tr('Ваши каналы и избранное')
      : tr('Избранные каналы. Войдите в аккаунт Twitch, чтобы видеть свои подписки')));
    // вкладки, как в «Отслеживаемом» на twitch.tv
    var tabsInner = h('div.chips-inner');
    var tabs = h('div.chips.row.h-scroll', { 'data-group': 'chips' }, tabsInner);
    el.content.appendChild(tabs);
    var body = h('div');
    el.content.appendChild(body);
    var mode = 'overview', gen = 0;
    var TABS = [['overview', tr('Обзор')], ['live', tr('Прямые трансляции')], ['videos', tr('Видео')], ['games', tr('Категории игр')], ['channels', tr('Каналы')]];
    TABS.forEach(function (t) {
      var c = h('div.chip.focusable' + (t[0] === mode ? '.active' : ''), { text: t[1] });
      c._onclick = function () {
        if (mode === t[0]) return;
        mode = t[0];
        U.$$('.chip', tabsInner).forEach(function (x) { x.classList.toggle('active', x === c); });
        render();
      };
      tabsInner.appendChild(c);
    });

    function done(promise, wrap) {
      var my = gen, loading = UI.loading();
      wrap.appendChild(loading);
      return promise.then(function () { if (my === gen) { loading.remove(); App.refocus(); } }, function (e) {
        if (my !== gen) return;
        loading.remove();
        wrap.appendChild(UI.error(e, render));
        App.refocus();
      });
    }

    function renderTab(mine) {
      var my = gen;
      if (mode === 'live') {
        return done(myLive().then(function (live) {
          if (my !== gen) return;
          if (!live.length) { body.appendChild(UI.empty(tr('Никто из ваших каналов сейчас не в эфире'))); return; }
          var g = UI.grid('grid-video'); g.add(live.map(streamCard)); body.appendChild(g);
        }), body);
      }
      if (mode === 'videos') {
        // последние записи каналов, на которые вы подписаны, — свежие сверху
        return done(followedVideos(48).then(function (all) {
          if (my !== gen) return;
          if (!all.length) { body.appendChild(UI.empty(tr('Записей нет'))); return; }
          var g = UI.grid('grid-video'); g.add(all.map(videoCard)); body.appendChild(g);
        }), body);
      }
      if (mode === 'games') {
        return done(Auth.followedGames().then(function (games) {
          if (my !== gen) return;
          if (!games.length) { body.appendChild(UI.empty(tr('Вы не отслеживаете категории'))); return; }
          var g = UI.grid('grid-game'); g.add(games.map(gameCard)); body.appendChild(g);
        }), body);
      }
      if (mode === 'channels') {
        return done(Twitch.users(mine.slice(0, 300)).then(function (us) {
          if (my !== gen) return;
          // в эфире — первыми, как на Twitch
          us.sort(function (a, b) { return (b.stream ? b.stream.viewersCount + 1 : 0) - (a.stream ? a.stream.viewersCount + 1 : 0); });
          if (!us.length) { body.appendChild(UI.empty(tr('Список пуст'))); return; }
          var g = UI.grid('grid-channels'); g.add(us.map(channelCard)); body.appendChild(g);
        }), body);
      }
      return null;
    }

    function render() {
      gen++;
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
          Auth.syncFollows().then(function (l) { if (l.length) render(); else if (Auth.followsDenied) {
              // вход без права на список отслеживаемых — объясняем и предлагаем войти заново
              body.innerHTML = '';
              body.appendChild(UI.empty(tr('Чтобы показать отслеживаемые каналы, войдите в Twitch ещё раз')));
              body.appendChild(h('div.row.empty-actions', { 'data-group': 'free' }, UI.button(tr('Войти снова'), 'person', function () { App.go('account', { add: true }, { root: true }); }, 'primary')));
              App.refocus();
            } else { body.innerHTML = ''; body.appendChild(UI.empty(tr('Вы пока ни на кого не подписаны')));
            body.appendChild(h('div.row.empty-actions', { 'data-group': 'free' }, UI.button(tr('Найти каналы'), 'search', function () { App.go('search', {}, { root: true }); }, 'primary'))); App.refocus(); } },
            function (e) { body.innerHTML = ''; body.appendChild(UI.error(e, render)); });
          return;
        }
        var b = UI.button(tr('Найти каналы'), 'search', function () { App.go('search', {}, { root: true }); });
        body.appendChild(h('div.row', null, [UI.empty(tr('Список пуст'), tr('Найдите канал через поиск и нажмите «В избранное»')), b]));
        App.refocus();
        return;
      }
      if (renderTab(mine)) return;
      var loading = UI.loading();
      body.appendChild(loading);
      var myGen = gen;
      Promise.all([myLive(), Twitch.users(mine.slice(0, 300))]).then(function (r) {
        if (myGen !== gen) return;
        loading.remove();
        var live = r[0];
        var liveSet = {};
        live.forEach(function (s) { liveSet[s.broadcaster.login] = 1; });
        // канал в эфире, но не попал в список «в эфире» (разные ответы Twitch) — тоже показываем среди живых
        r[1].forEach(function (u) {
          if (u.stream && !liveSet[u.login]) { u.stream.broadcaster = u.stream.broadcaster || u; live.push(u.stream); liveSet[u.login] = 1; }
        });
        // порядок не трогаем — как у Twitch на телефоне и ПК («по рекомендации»), а не по числу зрителей
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
        if (myGen !== gen) return; // пока грузили, переключили вкладку
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
      // пока ничего не набрано — есть что посмотреть: популярные эфиры, категории и клипы в тренде
      autoShelf(resultsContent, tr('Популярные каналы сейчас'), function () { return Twitch.topStreams(20).then(function (p) { return p.items; }); }, streamCard);
      autoShelf(resultsContent, tr('Популярные категории'), function () { return Twitch.topGames(20).then(function (p) { return p.items; }); }, gameCard, { game: true, skeleton: 8 });
      autoShelf(resultsContent, tr('В тренде'), function () {
        return Twitch.topGames(4).then(function (p) {
          return Promise.all(p.items.map(function (g) { return Twitch.gameClips(g.name, 20, 'LAST_WEEK').catch(function () { return []; }); }));
        }).then(function (lists) { return byViews(lists, 24); });
      }, clipCard);
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

  // ---------- Диагностика аккаунта: что именно отвечает Twitch (по скриншоту видно, где проблема) ----------
  Pages.diag = function () {
    var el = pageShell('page-diag');
    el.content.appendChild(header(tr('Диагностика аккаунта'), tr('Покажите этот экран разработчику, если главная отличается от Twitch')));
    // кнопка — сверху, под заголовком: строки дописываются по мере ответов Twitch, и кнопка внизу
    // уезжала бы за экран; ниже стрелкой ▼ можно пройти по всем строкам
    var again = UI.button(tr('Повторить'), 'refresh', function () { App.replace('diag', {}); }, 'primary');
    el.content.appendChild(h('div.row.page-actions', { 'data-group': 'free' }, again));
    var list = h('div.diag-list');
    el.content.appendChild(list);

    function row(name, value, ok) {
      var v = h('b', { text: value });
      if (ok === true) v.style.color = '#7ee787';
      if (ok === false) v.style.color = '#ff7b72';
      var r = h('div.tv-info-row.row.focusable', null, [h('span', { text: name }), v]);
      list.appendChild(r);
      return v;
    }
    function test(name, run) {
      var v = row(name, '…');
      var t0 = Date.now();
      return run().then(function (txt) { v.textContent = txt + ' • ' + (Date.now() - t0) + ' ms'; v.style.color = '#7ee787'; },
        function (e) { v.textContent = 'error: ' + ((e && e.message) || e); v.style.color = '#ff7b72'; });
    }

    var acc = Auth.data;
    App.checkUpdate(true); // открыли диагностику — сразу проверяем, нет ли новой версии
    row('App', 'v' + App.VERSION + ' • ' + I18N.lang + ' • ' + (navigator.userAgent || '').slice(0, 80));
    row('Account', acc && acc.user ? acc.user.login + ' (' + acc.user.id + ')' : 'not signed in', !!(acc && acc.user));
    if (acc && acc.token) {
      row('Token', acc.expires ? 'expires in ' + Math.round((acc.expires - Date.now()) / 60000) + ' min' : 'no expiry info', acc.expires > Date.now());
      row('Needs sign-in', Auth.needsLogin() ? 'yes' : 'no', !Auth.needsLogin());
      var rl = acc.refreshLog;
      row('Last token refresh', rl ? new Date(rl.at).toLocaleString() + ' • ' + (rl.ok ? 'ok' : 'HTTP ' + rl.status + ' ' + rl.msg) : 'never', rl ? rl.ok : undefined);
      row('Client-ID', Auth.CLIENT_ID);
      test('currentUser', function () { return Auth.gql('query{currentUser{id login}}').then(function (d) { return d.currentUser ? d.currentUser.login : 'null'; }); })
        .then(function () { return test('token scopes', function () { return Auth.validate().then(function (j) { return (j.login || '?') + ' • client ' + j.client_id + ' • ' + ((j.scopes || []).join(' ') || 'no scopes'); }); }); })
        .then(function () { return test('Helix follows', function () { return Auth.helix('channels/followed?user_id=' + encodeURIComponent(acc.user.id) + '&first=100').then(function (j) { return (j.total !== undefined ? j.total : (j.data || []).length) + ' channels'; }); }); })
        .then(function () { return test('Helix live', function () { return Auth.helix('streams/followed?user_id=' + encodeURIComponent(acc.user.id) + '&first=100').then(function (j) { return (j.data || []).length + ' live'; }); }); })
        .then(function () { return test('followedLive', function () { return Auth.followedLive().then(function (l) { return l.length + ' live'; }); }); })
        .then(function () { return test('follows', function () { return Auth.syncFollows().then(function (l) { return l.length + ' channels'; }); }); })
        .then(function () { return test('followedGames', function () { return Auth.followedGames().then(function (l) { return l.length + ' categories'; }); }); })
        .then(recs)
        .then(shelves);
    } else shelves();

    // рекомендованные эфиры (лента «Эфир») — выше рядов главной, чтобы помещались на экран
    function recs() {
      var v = row('Live recommendations', '…');
      return Twitch.liveRecs().then(function (l) {
        v.textContent = l.length ? l.length + ' streams' : 'none — feed uses your categories';
        v.style.color = l.length ? '#7ee787' : '#ff7b72';
        (Twitch.recsDiag || []).forEach(function (st) { row('  ' + st.name, st.info + ' • ' + st.ms + ' ms', st.ok); });
      });
    }
    function shelves() {
      Twitch.clearCache();
      var v = row('Home shelves', '…');
      Twitch.personalShelves().then(function (rows) {
        v.textContent = rows.length ? rows.length + ' rows' : 'none — generic Home is shown';
        v.style.color = rows.length ? '#7ee787' : '#ff7b72';
        (Twitch.diag.steps || []).forEach(function (st) { row('  ' + st.name, st.info + ' • ' + st.ms + ' ms', st.ok); });
      });
    }
    return { el: el, nav: 'settings', firstFocus: function () { return again; } };
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
    action(tr('Диагностика аккаунта'), tr('Покажите этот экран разработчику, если главная отличается от Twitch'), function () { App.go('diag', {}); });
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
      tr('Когда стример запускает прогноз или голосование — в плеере всплывает подсказка. Значок события — в правом верхнем углу видео, кнопка «Вверх» открывает его.'));
    opt(tr('Автосбор бонусных баллов'), 'autoClaim', [['on', tr('Включён')], ['off', tr('Выключен')]],
      tr('Сундучок с бонусными баллами канала забирается сам, пока вы смотрите эфир (нужен вход в Twitch).'));
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
