/* Страницы приложения + настройки */
(function () {
  'use strict';
  var h = U.h;

  // ---------- Настройки ----------
  var DEFAULTS = {
    quality: 'auto', latency: 'normal', chat: 'off', chatMode: 'side', lang: 'ru',
    engine: 'hls', playerType: 'site', scale: '100', preview: 'on'
  };
  var Settings = {
    data: U.store.get('settings', {}),
    get: function (k) { return Settings.data[k] !== undefined ? Settings.data[k] : DEFAULTS[k]; },
    set: function (k, v) { Settings.data[k] = v; U.store.set('settings', Settings.data); }
  };
  window.Settings = Settings;

  var LANGS = [['ru', 'Русский'], ['uk', 'Українська'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'],
    ['fr', 'Français'], ['pt', 'Português'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['ja', '日本語'], ['ko', '한국어']];

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
    parent.appendChild(shelf);
    var p = loader().then(function (items) {
      shelf.track.innerHTML = '';
      if (!items || !items.length) { shelf.parentNode && shelf.parentNode.removeChild(shelf); return 0; }
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
  function channelCard(u) {
    return UI.channelCard(u, function (data) { openChannel(data); });
  }

  // Сетка со страницами из API: fetchPage(cursor) -> {items, cursor, more}
  function pagedGrid(cls, fetchPage, makeCard, onFirst) {
    var cursor = null, more = true, first = true;
    var grid = UI.grid(cls, function () {
      if (!more) return null;
      return fetchPage(cursor).then(function (p) {
        cursor = p.cursor; more = p.more && !!p.cursor;
        if (first) { first = false; if (onFirst) onFirst(p); }
        return p.items.map(makeCard);
      });
    });
    return grid;
  }

  function fillGrid(wrap, grid, emptyText) {
    var loading = UI.loading();
    wrap.appendChild(loading);
    wrap.appendChild(grid);
    return grid._loadMore().then(function () {
      loading.remove();
      if (!grid.children.length) wrap.appendChild(UI.empty(emptyText || 'Здесь пока пусто'));
      App.refocus();
    }, function (e) {
      loading.remove();
      var err = UI.error(e, function () { err.remove(); fillGrid(wrap, grid, emptyText); });
      wrap.appendChild(err);
      App.refocus();
    });
  }

  var Pages = {};

  // ---------- Главная ----------
  Pages.home = function () {
    var el = pageShell('page-home');
    var chipsInner = h('div.chips-inner');
    var chips = h('div.chips.row.h-scroll', { 'data-group': 'chips', 'data-top': '1' }, chipsInner);
    var body = h('div.home-body');
    el.content.appendChild(chips);
    el.content.appendChild(body);

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

    function renderMain() {
      body.innerHTML = '';
      var favs = App.favs();
      if (favs.length) {
        autoShelf(body, 'Избранное в эфире', function () {
          return Twitch.users(favs).then(function (us) {
            return us.filter(function (u) { return u.stream; }).map(function (u) {
              var s = u.stream; s.broadcaster = s.broadcaster || u; return s;
            }).sort(function (a, b) { return b.viewersCount - a.viewersCount; });
          });
        }, streamCard, { cls: 'shelf-favs' });
      }
      var lang = Settings.get('lang');
      var langName = (LANGS.filter(function (l) { return l[0] === lang; })[0] || ['', ''])[1];
      autoShelf(body, 'Популярные трансляции' + (langName ? ' • ' + langName : ''), function () {
        return Twitch.topStreamsByLang(lang, 30).then(function (p) { return p.items; });
      }, streamCard);
      autoShelf(body, 'Популярно во всём мире', function () { return Twitch.topStreams(30).then(function (p) { return p.items; }); }, streamCard);
      autoShelf(body, 'Популярные категории', function () { return Twitch.topGames(30).then(function (p) { return p.items; }); }, gameCard, { game: true, skeleton: 8 });
      Twitch.topGames(6).then(function (p) {
        p.items.forEach(function (g) {
          autoShelf(body, g.displayName || g.name, function () { return Twitch.gameStreams(g.name, 20).then(function (r) { return r.items; }); }, streamCard);
        });
      }).catch(function () {});
    }

    function renderGame(g) {
      body.innerHTML = '';
      var wrap = h('div.grid-wrap');
      body.appendChild(wrap);
      fillGrid(wrap, pagedGrid('grid-video', function (c) { return Twitch.gameStreams(g.name, 24, c); }, streamCard), 'Нет трансляций');
    }

    var home = chip('Все', renderMain);
    home.classList.add('active');
    activeChip = home;
    renderMain();
    Twitch.topGames(12).then(function (p) {
      p.items.forEach(function (g) { chip(g.displayName || g.name, function () { renderGame(g); }); });
    }).catch(function () {});

    return {
      el: el, nav: 'home',
      firstFocus: function () {
        // фокус — на первую карточку первой полки, как в YouTube TV (ждём, пока загрузятся полки выше)
        var shelves = U.$$('.shelf, .grid', body);
        for (var i = 0; i < shelves.length; i++) {
          if (U.$('.skeleton', shelves[i])) return null;
          var c = U.$('.card.focusable', shelves[i]);
          if (c) return c;
        }
        return null;
      },
      refresh: function () { Twitch.clearCache(); if (activeChip === home) renderMain(); }
    };
  };

  // ---------- Категории ----------
  Pages.browse = function () {
    var el = pageShell('page-browse');
    el.content.appendChild(header('Категории', 'Во что играют прямо сейчас'));
    var wrap = h('div.grid-wrap');
    el.content.appendChild(wrap);
    fillGrid(wrap, pagedGrid('grid-game', function (c) { return Twitch.topGames(40, c); }, gameCard), 'Категории не загрузились');
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
    var t1 = tab('Трансляции', function () {
      fillGrid(body, pagedGrid('grid-video', function (c) { return Twitch.gameStreams(params.name, 24, c); }, streamCard, function (p) {
        if (p.game) {
          U.$('.game-box', head).appendChild(UI.img('box-img', p.game.boxArtURL));
          U.$('.game-viewers', head).textContent = U.viewers(p.game.viewersCount);
        }
      }), 'Сейчас никто не стримит эту категорию');
    });
    tab('Клипы', function () {
      var g = UI.grid('grid-video');
      fillStatic(body, g, Twitch.gameClips(params.name, 40), clipCard, 'Клипов нет');
    });
    tab('Записи', function () {
      var g = UI.grid('grid-video');
      fillStatic(body, g, Twitch.gameVideos(params.name, 40), videoCard, 'Записей нет');
    });
    t1._onclick();
    return { el: el, nav: 'browse', firstFocus: function () { return U.$('.grid .card', el) || (U.$('.empty', body) ? t1 : null); } };
  };

  function fillStatic(wrap, grid, promise, makeCard, emptyText) {
    var loading = UI.loading();
    wrap.appendChild(loading);
    wrap.appendChild(grid);
    return promise.then(function (items) {
      loading.remove();
      if (!items.length) wrap.appendChild(UI.empty(emptyText));
      grid.add(items.map(makeCard));
    }, function (e) {
      loading.remove();
      wrap.appendChild(UI.empty('Не удалось загрузить', e && e.message));
    });
  }

  // ---------- Избранное ----------
  Pages.following = function () {
    var el = pageShell('page-following');
    el.content.appendChild(header('Избранное', 'Ваши каналы. Добавить: кнопка ♥ в плеере или на странице канала'));
    var body = h('div');
    el.content.appendChild(body);

    function render() {
      body.innerHTML = '';
      var favs = App.favs();
      if (!favs.length) {
        var b = UI.button('Найти каналы', 'search', function () { App.go('search', {}, { root: true }); }, 'primary');
        body.appendChild(h('div.row', null, [UI.empty('Список пуст', 'Найдите канал через поиск и нажмите «В избранное»'), b]));
        return;
      }
      body.appendChild(UI.loading());
      Twitch.users(favs).then(function (users) {
        body.innerHTML = '';
        var live = users.filter(function (u) { return u.stream; }).sort(function (a, b) { return b.stream.viewersCount - a.stream.viewersCount; });
        var off = users.filter(function (u) { return !u.stream; });
        if (live.length) {
          body.appendChild(h('h2.section-title.row', { text: 'В эфире • ' + live.length }));
          var g = UI.grid('grid-video');
          g.add(live.map(function (u) { var s = u.stream; s.broadcaster = s.broadcaster || u; return streamCard(s); }));
          body.appendChild(g);
        }
        if (off.length) {
          var shelf = UI.shelf('Не в сети • ' + off.length);
          shelf.add(off.map(channelCard));
          body.appendChild(shelf);
        }
        App.refocus();
      }, function (e) {
        body.innerHTML = '';
        body.appendChild(UI.error(e, render));
      });
    }
    render();
    return { el: el, nav: 'following', refresh: render, onShow: render };
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
      if (!u) { head.appendChild(UI.empty('Канал не найден', login)); return; }
      if (u.bannerImageURL) head.appendChild(h('div.channel-banner', { style: 'background-image:url(' + JSON.stringify(u.bannerImageURL) + ')' }));
      var favBtn = UI.button(App.isFav(u.login) ? 'В избранном' : 'В избранное', App.isFav(u.login) ? 'following' : 'heartOutline', function () {
        var on = App.toggleFav(u.login);
        favBtn.innerHTML = UI.icon(on ? 'following' : 'heartOutline') + '<span>' + (on ? 'В избранном' : 'В избранное') + '</span>';
      });
      var buttons = [];
      if (u.stream) {
        var s = u.stream; s.broadcaster = s.broadcaster || u;
        var watch = UI.button('Смотреть эфир', 'play', function () { App.play(App.itemFromStream(s)); }, 'primary');
        buttons.push(watch);
      }
      buttons.push(favBtn);
      head.appendChild(h('div.channel-top', null, [
        h('div.channel-avatar' + (u.stream ? '.is-live' : ''), null, [UI.img('ch-img', u.profileImageURL), u.stream ? h('div.ch-live', { text: 'LIVE' }) : null]),
        h('div.channel-info', null, [
          h('h1.page-title', { text: u.displayName }),
          h('div.page-sub', { text: (u.followers ? U.num(u.followers.totalCount) + ' фолловеров' : '') + (u.stream ? ' • в эфире: ' + ((u.stream.game && (u.stream.game.displayName || u.stream.game.name)) || '') : ' • не в сети') }),
          u.description ? h('div.channel-desc', { text: u.description }) : null,
          h('div.channel-buttons', { 'data-group': 'free' }, buttons)
        ])
      ]));
      if (u.stream) {
        var ls = UI.shelf('Сейчас в эфире');
        ls.add([streamCard(u.stream)]);
        body.appendChild(ls);
      }
      var shelves = [
        autoShelf(body, 'Последние трансляции', function () { return Twitch.videos(login, 'ARCHIVE', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, 'Популярные клипы за месяц', function () { return Twitch.clips(login, 'LAST_MONTH', 30); }, clipCard),
        autoShelf(body, 'Лучшее', function () { return Twitch.videos(login, 'HIGHLIGHT', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, 'Загрузки', function () { return Twitch.videos(login, 'UPLOAD', 30).then(function (p) { return p.items; }); }, videoCard),
        autoShelf(body, 'Клипы за всё время', function () { return Twitch.clips(login, 'ALL_TIME', 30); }, clipCard)
      ];
      Promise.all(shelves.map(function (s) { return s.ready; })).then(function (counts) {
        if (!u.stream && !counts.some(Boolean)) body.appendChild(UI.empty('Нет записей и клипов'));
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
  var KB = {
    ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.split(''),
    en: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    num: '1234567890_-.@!?#&'.split('')
  };

  Pages.search = function () {
    var query = '';
    var layout = Settings.get('kb') || 'ru';
    var el = h('section.page.page-search');
    var field = h('div.search-field', null, [h('span.search-icon', { html: UI.icon('search') }), h('span.search-text'), h('span.search-caret')]);
    var keys = h('div.kb-keys', { 'data-group': 'kb' });
    var kb = h('div.kb', null, [field, keys]);
    var resultsContent = h('div.v-content');
    var results = h('div.search-results.v-scroll', { 'data-pad': '1' }, resultsContent);
    el.appendChild(kb);
    el.appendChild(results);

    function key(label, cls, fn, html) {
      var k = h('div.kb-key.focusable' + (cls ? '.' + cls : ''), html ? { html: html } : { text: label });
      k._onclick = fn;
      keys.appendChild(k);
      return k;
    }

    function buildKeys() {
      var focusedText = Nav.current && keys.contains(Nav.current) ? Nav.current.textContent : null;
      keys.innerHTML = '';
      KB[layout].forEach(function (ch) { key(ch, null, function () { type(ch); }); });
      if (layout !== 'num') '0123456789'.split('').slice(0, layout === 'ru' ? 2 : 9).forEach(function (d) { key(d, null, function () { type(d); }); });
      var row = h('div.kb-row');
      keys.appendChild(row);
      key('', 'kb-wide', function () { type(' '); }, UI.icon('space') + '<span>Пробел</span>');
      key('', 'kb-wide', backspace, UI.icon('backspace') + '<span>Стереть</span>');
      key('Очистить', 'kb-wide', function () { setQuery(''); });
      key(layout === 'ru' ? 'EN' : layout === 'en' ? '123' : 'РУС', 'kb-wide.kb-lang', function () {
        layout = layout === 'ru' ? 'en' : layout === 'en' ? 'num' : 'ru';
        Settings.set('kb', layout === 'num' ? 'ru' : layout);
        buildKeys();
        Nav.focus(U.$('.kb-lang', keys));
      });
      if (focusedText && !Nav.current.isConnected) Nav.focus(keys.firstChild);
    }

    function type(ch) { setQuery(query + ch); }
    function backspace() { setQuery(query.slice(0, -1)); }

    function setQuery(q) {
      query = q.slice(0, 40);
      U.$('.search-text', field).textContent = query;
      field.classList.toggle('empty', !query);
      runSearch();
    }

    var seq = 0;
    var runSearch = U.debounce(function () {
      var my = ++seq;
      var q = query.trim();
      resultsContent.innerHTML = '';
      resultsContent.style.transform = '';
      if (q.length < 2) { renderHistory(); return; }
      resultsContent.appendChild(UI.loading());
      Twitch.search(q).then(function (r) {
        if (my !== seq) return;
        resultsContent.innerHTML = '';
        var any = false;
        if (r.live.length) {
          any = true;
          var s1 = UI.shelf('Трансляции');
          s1.add(r.live.map(streamCard));
          resultsContent.appendChild(s1);
        }
        if (r.channels.length) {
          any = true;
          var s2 = UI.shelf('Каналы');
          s2.add(r.channels.map(function (u) {
            var c = channelCard(u);
            var orig = c._onclick;
            c._onclick = function () { remember(q); orig(); };
            return c;
          }));
          resultsContent.appendChild(s2);
        }
        if (r.games.length) {
          any = true;
          var s3 = UI.shelf('Категории');
          s3.add(r.games.map(gameCard));
          resultsContent.appendChild(s3);
        }
        if (!any) resultsContent.appendChild(UI.empty('Ничего не найдено', 'Попробуйте другой запрос'));
      }, function (e) {
        if (my !== seq) return;
        resultsContent.innerHTML = '';
        resultsContent.appendChild(UI.error(e, runSearch));
      });
    }, 450);

    function remember(q) {
      var hist = U.store.get('searchHistory', []).filter(function (x) { return x !== q; });
      hist.unshift(q);
      U.store.set('searchHistory', hist.slice(0, 12));
    }

    function renderHistory() {
      var hist = U.store.get('searchHistory', []);
      if (hist.length) {
        var box = h('div.row.search-history', { 'data-group': 'free' }, [h('h2.shelf-title', { text: 'Недавние запросы' })]);
        hist.forEach(function (q) {
          var c = h('div.chip.focusable', { text: q });
          c._onclick = function () { setQuery(q); };
          box.appendChild(c);
        });
        resultsContent.appendChild(box);
      }
      autoShelf(resultsContent, 'Популярные каналы сейчас', function () { return Twitch.topStreams(20).then(function (p) { return p.items; }); }, streamCard);
    }

    buildKeys();
    setQuery('');
    return {
      el: el, nav: 'search',
      firstFocus: function () { return keys.firstChild; },
      onKey: function (k, e) {
        // физическая клавиатура / пульт с клавиатурой
        if (e && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey) { type(e.key); return true; }
        return false;
      }
    };
  };

  // ---------- Настройки ----------
  Pages.settings = function () {
    var el = pageShell('page-settings');
    el.content.appendChild(header('Настройки'));
    var list = h('div.settings-list', { 'data-group': 'free' });
    el.content.appendChild(list);

    function opt(label, key, values, hint, onChange) {
      var valueEl = h('div.set-value');
      var row = h('div.set-row.row.focusable', null, [
        h('div.set-text', null, [h('div.set-label', { text: label }), hint ? h('div.set-hint', { text: hint }) : null]),
        h('div.set-control', null, [h('span.set-arrow', { html: '&#8249;' }), valueEl, h('span.set-arrow', { html: '&#8250;' })])
      ]);
      function idx() {
        var v = Settings.get(key);
        for (var i = 0; i < values.length; i++) if (values[i][0] === v) return i;
        return 0;
      }
      function show() { valueEl.textContent = values[idx()][1]; }
      function step(d) {
        var i = (idx() + d + values.length) % values.length;
        Settings.set(key, values[i][0]);
        show();
        if (onChange) onChange(values[i][0]);
      }
      row._onclick = function () { step(1); };
      row._onkey = function (k) {
        if (k === 'LEFT') { step(-1); return true; }
        if (k === 'RIGHT') { step(1); return true; }
        return false;
      };
      show();
      list.appendChild(row);
    }

    function action(label, hint, fn) {
      var row = h('div.set-row.row.focusable', null, [
        h('div.set-text', null, [h('div.set-label', { text: label }), hint ? h('div.set-hint', { text: hint }) : null]),
        h('div.set-control', null, h('span.set-go', { html: '&#8250;' }))
      ]);
      row._onclick = fn;
      list.appendChild(row);
    }

    opt('Качество видео', 'quality', [['auto', 'Авто'], ['1080p60', '1080p60'], ['1080p', '1080p'], ['720p60', '720p60'], ['720p', '720p'], ['480p', '480p'], ['360p', '360p'], ['160p', '160p']],
      'Авто подбирает качество под скорость интернета. Если эфир тормозит — поставьте 720p.');
    opt('Задержка эфира', 'latency', [['low', 'Минимальная'], ['normal', 'Обычная'], ['stable', 'Стабильная (большой буфер)']],
      'Стабильная — меньше подвисаний при слабом Wi‑Fi, но отставание от эфира больше.');
    opt('Чат при открытии эфира', 'chat', [['off', 'Выключен'], ['on', 'Включён']], 'Во время эфира чат включается зелёной кнопкой пульта.');
    opt('Расположение чата', 'chatMode', [['side', 'Сбоку от видео'], ['overlay', 'Поверх видео']]);
    opt('Язык трансляций на главной', 'lang', LANGS, null, function () { Twitch.clearCache(); });
    opt('Масштаб интерфейса', 'scale', [['90', '90%'], ['100', '100%'], ['110', '110%'], ['120', '120%']], null, function () { App.applyScale(); });
    opt('Видеодвижок', 'engine', [['hls', 'hls.js (рекомендуется)'], ['native', 'Встроенный в ТВ']],
      'Встроенный — запасной вариант, если hls.js не работает на вашей прошивке.');
    opt('Тип плеера Twitch', 'playerType', [['site', 'site'], ['embed', 'embed'], ['popout', 'popout']],
      'Если эфир не запускается, попробуйте другой вариант.');
    action('Очистить избранное', 'Удалить все каналы из избранного', function () {
      UI.confirm('Очистить избранное?', 'Список каналов будет удалён.', 'Очистить', function () { App.setFavs([]); UI.toast('Избранное очищено'); });
    });
    action('Очистить историю', 'История поиска и позиции просмотра записей', function () {
      U.store.set('searchHistory', []); U.store.set('vodpos', {}); UI.toast('История очищена');
    });
    action('Перезапустить приложение', null, function () { location.reload(); });

    var url = location.href.split('#')[0].split('?')[0];
    el.content.appendChild(h('div.about.row', null, [
      h('div.about-title', { text: 'Twitch TV для Hisense VIDAA • версия ' + App.VERSION }),
      h('div.about-text', { text: 'Адрес приложения: ' + url }),
      h('div.about-text', { text: 'Кнопки пульта: OK — выбор, Назад — выход/назад, CH+/CH− — переключение эфиров, ' +
        'красная — качество, зелёная — чат, жёлтая — избранное, синяя — перезагрузить поток.' })
    ]));
    return { el: el, nav: 'settings' };
  };

  window.Pages = Pages;
})();
