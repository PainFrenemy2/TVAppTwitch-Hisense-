/* Работа с Twitch: GQL (как сайт twitch.tv), токены воспроизведения и HLS-плейлисты usher. */
(function () {
  'use strict';

  var CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // публичный Client-ID веб-сайта twitch.tv
  var GQL = 'https://gql.twitch.tv/gql';
  var DEVICE_ID = U.store.get('deviceId', null);
  if (!DEVICE_ID) { DEVICE_ID = U.uid(32); U.store.set('deviceId', DEVICE_ID); }

  var STREAM = 'id title viewersCount createdAt type previewImageURL(width:440,height:248) ' +
    'broadcaster{id login displayName profileImageURL(width:70)} game{id name displayName}';
  var GAME = 'id name displayName viewersCount boxArtURL(width:188,height:250)';
  var VIDEO = 'id title lengthSeconds viewCount createdAt broadcastType previewThumbnailURL(width:440,height:248) ' +
    'owner{id login displayName profileImageURL(width:70)} game{id name displayName}';
  var CLIP = 'id slug title viewCount durationSeconds createdAt thumbnailURL(width:480,height:272) ' +
    'broadcaster{id login displayName profileImageURL(width:70)} game{id name displayName}';
  var USER = 'id login displayName description profileImageURL(width:150) bannerImageURL ' +
    'followers{totalCount} stream{' + STREAM + '}';

  // Простой кэш ответов, чтобы возврат «назад» был мгновенным
  var cache = {};
  var CACHE_MS = 60 * 1000;

  function gql(query, variables, opts) {
    opts = opts || {};
    var key = opts.cache ? query + JSON.stringify(variables || {}) : null;
    if (key && cache[key] && Date.now() - cache[key].t < CACHE_MS) return Promise.resolve(cache[key].d);
    // тот же запрос уже летит (например, «В тренде» и ряд категории на странице клипов) — ждём его, а не шлём второй
    if (key && inflight[key]) return inflight[key];

    var body = JSON.stringify({ query: query, variables: variables || {} });
    var pr = request(GQL, {
      method: 'POST',
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8', 'X-Device-Id': DEVICE_ID, 'Accept-Language': I18N.lang },
      body: body
    }, opts.timeout || 12000, opts.retries === undefined ? 2 : opts.retries).then(function (r) {
      return r.json();
    }).then(function (j) {
      if (j.errors && j.errors.length && !j.data) {
        var err = new Error('GQL: ' + (j.errors[0].message || 'error'));
        err.gql = j.errors;
        throw err;
      }
      if (key) {
        cache[key] = { t: Date.now(), d: j.data };
        // не растём бесконечно: выкидываем устаревшее, держим не больше ~80 ответов
        var keys = Object.keys(cache);
        if (keys.length > 80) keys.forEach(function (k) { if (Date.now() - cache[k].t > CACHE_MS) delete cache[k]; });
        keys = Object.keys(cache);
        while (keys.length > 80) delete cache[keys.shift()];
      }
      return j.data;
    });
    if (key) {
      inflight[key] = pr;
      var clear = function () { if (inflight[key] === pr) delete inflight[key]; };
      pr.then(clear, clear);
    }
    return pr;
  }
  var inflight = {};

  // fetch с таймаутом и повторами (сеть у ТВ по Wi-Fi часто «моргает»)
  function request(url, init, timeout, retries) {
    return new Promise(function (resolve, reject) {
      var attempt = 0;
      function go() {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          if (ctrl) ctrl.abort();
          fail(new Error(tr('Таймаут сети')));
        }, timeout);
        var i = {};
        for (var k in init) i[k] = init[k];
        if (ctrl) i.signal = ctrl.signal;
        fetch(url, i).then(function (r) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (r.status >= 500 || r.status === 429) return fail(new Error('HTTP ' + r.status));
          resolve(r);
        }, function (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          fail(e);
        });
      }
      function fail(e) {
        if (attempt++ < retries) setTimeout(go, 600 * attempt);
        else reject(e);
      }
      go();
    });
  }

  function edges(conn) {
    return conn && conn.edges ? conn.edges.map(function (e) { return e.node; }).filter(Boolean) : [];
  }

  function page(conn) {
    var list = conn && conn.edges ? conn.edges : [];
    return {
      items: edges(conn),
      cursor: list.length ? list[list.length - 1].cursor : null,
      more: !!(conn && conn.pageInfo && conn.pageInfo.hasNextPage)
    };
  }

  var T = {};
  // сырой запрос без кэша и повторов (прогнозы, голосования — данные меняются каждую секунду)
  T.gqlRaw = function (query, variables) { return gql(query, variables, { retries: 0, timeout: 8000 }); };

  // ---------- Персональная главная, как на twitch.tv и в приложении Twitch ----------
  // С входом — от имени аккаунта (рекомендации под вас), без входа — общие ряды главной Twitch.
  // Возвращает [{id, title, items:[{type:'Stream'|'Game'|'Clip'|'Video', data}]}] или [] (тогда — обычная главная).
  // Запрос рядов главной — как у сайта twitch.tv (с context), и запасной — без него.
  // В объединении (union) одноимённые поля разных типов конфликтуют, если типы различаются
  // (Clip.title — String!, Stream.title — String), поэтому у Game/Clip/Video каждому полю верхнего
  // уровня даём псевдоним «p_поле», а после ответа возвращаем обычные имена (unalias).
  function alias(p, fields) {
    var out = [], depth = 0, tok = '';
    for (var i = 0; i <= fields.length; i++) {
      var c = fields.charAt(i);
      if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') depth--;
      if ((c === ' ' || c === '') && depth === 0) {
        if (tok) out.push(p + tok.match(/^\w+/)[0] + ':' + tok);
        tok = '';
      } else tok += c;
    }
    return out.join(' ');
  }
  function unalias(x) {
    var m = /^(Game|Clip|Video)$/.test(x.__typename) && x.__typename.charAt(0).toLowerCase() + '_';
    if (m) for (var k in x) if (k.indexOf(m) === 0) x[k.slice(2)] = x[k];
    return x;
  }
  var SHELF_ITEMS = 'edges{node{id title{fallbackLocalizedTitle} content{edges{node{__typename ' +
    '... on Stream{' + STREAM + '} ... on Game{' + alias('g_', GAME) + '} ... on Clip{' + alias('c_', CLIP) + '} ... on Video{' + alias('v_', VIDEO) + '}}}}}}';
  // Варианты от «как у сайта» до минимального: если Twitch ругается на какой-то аргумент
  // (как было с «Unknown argument imageWidth»), следующий вариант обходится без него.
  var CTX = 'context:{clientApp:"twilight",location:"home",referrerDomain:"",viewportHeight:1080,viewportWidth:1920}';
  var SHELVES_VARIANTS = [
    ['shelves+context', 'query($first:Int,$itemsPerRow:Int,$requestID:String!){shelves(first:$first,itemsPerRow:$itemsPerRow,platform:"web",requestID:$requestID,' +
      'langWeightedCCU:true,verbose:false,' + CTX + '){' + SHELF_ITEMS + '}}'],
    ['shelves', 'query($first:Int,$itemsPerRow:Int,$requestID:String!){shelves(first:$first,itemsPerRow:$itemsPerRow,platform:"web",requestID:$requestID){' + SHELF_ITEMS + '}}']
  ];
  // элементы раздела — объединение типов (union), поэтому канал выбираем через фрагмент
  var RECS_Q = 'query{personalSections(input:{sectionInputs:[RECOMMENDED_SECTION],recommendationContext:{platform:"web"}}){' +
    'type title{localizedFallback} items{__typename ... on PersonalSectionChannel{user{id login displayName profileImageURL(width:70) stream{' + STREAM + '}}}}}}';
  var personal = { at: 0, key: '', p: null };
  // что ответил Twitch — для экрана «Диагностика аккаунта»
  T.diag = {};

  function shelvesFrom(d) {
    var out = [];
    edges(d && d.shelves).forEach(function (n) {
      var items = edges(n.content).map(function (x) { return x && unalias(x); }).filter(function (x) {
        return x && /^(Stream|Game|Clip|Video)$/.test(x.__typename) && (x.__typename !== 'Stream' || x.broadcaster);
      }).map(function (x) { return { type: x.__typename, data: x }; });
      var title = n.title && n.title.fallbackLocalizedTitle;
      if (items.length && title) out.push({ id: n.id, title: title, items: items });
    });
    return out;
  }
  function recsFrom(d) {
    var out = [];
    ((d && d.personalSections) || []).forEach(function (sec) {
      var items = (sec.items || []).map(function (it) { return it.user; }).filter(function (u) { return u && u.stream; }).map(function (u) {
        var st = u.stream; st.broadcaster = st.broadcaster || { id: u.id, login: u.login, displayName: u.displayName, profileImageURL: u.profileImageURL };
        return { type: 'Stream', data: st };
      });
      if (items.length) out.push({ id: sec.type, title: (sec.title && sec.title.localizedFallback) || tr('Рекомендуемые каналы'), items: items });
    });
    return out;
  }

  // Пробуем источники по очереди: ряды главной от аккаунта (оба варианта запроса), «Рекомендуемые каналы»
  // от аккаунта; без входа — те же ряды анонимно. Каждый результат пишем в T.diag.
  T.personalShelves = function () {
    var signed = window.Auth && Auth.loggedIn() && !Auth.needsLogin();
    // во время входа токен уже есть, а профиля ещё нет — считаем гостем
    if (signed && !(Auth.user() && Auth.user().id)) signed = false;
    var key = signed ? Auth.user().id : 'anon';
    if (personal.p && personal.key === key && Date.now() - personal.at < 60000) return personal.p;
    var steps = [];
    var asUser = function (q, v) { return Auth.gql(q, v); };
    var asAnon = function (q, v) { return gql(q, v, { retries: 0 }); };
    SHELVES_VARIANTS.forEach(function (sv) {
      if (signed) steps.push({ name: sv[0] + ' (account)', run: function () { return asUser(sv[1], { first: 8, itemsPerRow: 16, requestID: U.uid(16) }).then(shelvesFrom); } });
    });
    if (signed) steps.push({ name: 'personalSections (account)', run: function () { return asUser(RECS_Q, {}).then(recsFrom); } });
    SHELVES_VARIANTS.forEach(function (sv) {
      if (!signed) steps.push({ name: sv[0] + ' (guest)', run: function () { return asAnon(sv[1], { first: 8, itemsPerRow: 16, requestID: U.uid(16) }).then(shelvesFrom); } });
    });
    T.diag = { signed: signed, steps: [] };
    var i = 0;
    function next() {
      if (i >= steps.length) return Promise.resolve([]);
      var st = steps[i++], t0 = Date.now();
      return st.run().then(function (rows) {
        T.diag.steps.push({ name: st.name, ok: !!rows.length, info: rows.length ? rows.length + ' rows: ' + rows.map(function (r) { return r.title; }).join(' | ') : 'empty', ms: Date.now() - t0 });
        return rows.length ? rows : next();
      }, function (e) {
        T.diag.steps.push({ name: st.name, ok: false, info: 'error: ' + ((e && e.message) || e), ms: Date.now() - t0 });
        return next();
      });
    }
    var p = next();
    personal = { at: Date.now(), key: key, p: p };
    return p;
  };

  T.topStreams = function (first, after) {
    return gql('query($first:Int,$after:Cursor){streams(first:$first,after:$after){edges{cursor node{' + STREAM + '}} pageInfo{hasNextPage}}}',
      { first: first || 30, after: after || null }, { cache: !after }).then(function (d) { return page(d.streams); });
  };

  // Популярное на языке пользователя. Поле фильтра у Twitch менялось — пробуем варианты.
  T.topStreamsByLang = function (lang, first, after) {
    var L = String(lang || 'ru').toUpperCase();
    var v = { first: first || 30, after: after || null, langs: [L] };
    return gql('query($first:Int,$after:Cursor,$langs:[Language!]){streams(first:$first,after:$after,options:{broadcasterLanguages:$langs}){edges{cursor node{' + STREAM + '}} pageInfo{hasNextPage}}}', v, { cache: !after, retries: 0 })
      .catch(function () {
        return gql('query($first:Int,$after:Cursor,$langs:[String!]){streams(first:$first,after:$after,options:{languages:$langs}){edges{cursor node{' + STREAM + '}} pageInfo{hasNextPage}}}',
          { first: v.first, after: v.after, langs: [String(lang || 'ru').toLowerCase()] }, { cache: !after, retries: 0 });
      })
      .then(function (d) { return page(d.streams); });
  };

  T.topGames = function (first, after) {
    return gql('query($first:Int,$after:Cursor){games(first:$first,after:$after){edges{cursor node{' + GAME + '}} pageInfo{hasNextPage}}}',
      { first: first || 40, after: after || null }, { cache: !after }).then(function (d) { return page(d.games); });
  };

  T.gameStreams = function (name, first, after, lang) {
    var q = 'query($name:String!,$first:Int,$after:Cursor){game(name:$name){' + GAME + ' streams(first:$first,after:$after){edges{cursor node{' + STREAM + '}} pageInfo{hasNextPage}}}}';
    return gql(q, { name: name, first: first || 30, after: after || null }, { cache: !after }).then(function (d) {
      if (!d.game) throw new Error(tr('Категория не найдена'));
      var p = page(d.game.streams);
      p.game = d.game;
      return p;
    });
  };

  T.gameVideos = function (name, first) {
    return gql('query($name:String!,$first:Int){game(name:$name){videos(first:$first,sort:VIEWS){edges{node{' + VIDEO + '}}}}}',
      { name: name, first: first || 20 }, { cache: true, retries: 0 }).then(function (d) { return d.game ? edges(d.game.videos) : []; });
  };

  T.user = function (login) {
    return gql('query($login:String!){user(login:$login){' + USER + '}}', { login: login }, { cache: false }).then(function (d) { return d.user; });
  };

  // Несколько каналов за раз (для избранного). Twitch ограничивает ~100 логинов на запрос.
  T.users = function (logins) {
    if (!logins.length) return Promise.resolve([]);
    var chunks = [];
    for (var i = 0; i < logins.length; i += 90) chunks.push(logins.slice(i, i + 90));
    return Promise.all(chunks.map(function (c) {
      return gql('query($logins:[String!]){users(logins:$logins){id login displayName profileImageURL(width:150) stream{' + STREAM + '}}}', { logins: c })
        .then(function (d) { return (d.users || []).filter(Boolean); });
    })).then(function (parts) { return [].concat.apply([], parts); });
  };

  T.videos = function (login, type, first, after) {
    var q = 'query($login:String!,$first:Int,$after:Cursor,$type:BroadcastType){user(login:$login){videos(first:$first,after:$after,type:$type,sort:TIME){edges{cursor node{' + VIDEO + '}} pageInfo{hasNextPage}}}}';
    return gql(q, { login: login, first: first || 30, after: after || null, type: type || 'ARCHIVE' }, { cache: !after, retries: 1 })
      .then(function (d) { return page(d.user && d.user.videos); });
  };

  T.clips = function (login, period, first) {
    var q = 'query($login:String!,$first:Int,$period:ClipsPeriod){user(login:$login){clips(first:$first,criteria:{period:$period,sort:VIEWS_DESC}){edges{node{' + CLIP + '}}}}}';
    return gql(q, { login: login, first: first || 30, period: period || 'LAST_MONTH' }, { cache: true, retries: 1 })
      .then(function (d) { return edges(d.user && d.user.clips); });
  };

  T.gameClips = function (name, first, period) {
    var q = 'query($name:String!,$first:Int,$period:ClipsPeriod){game(name:$name){clips(first:$first,criteria:{period:$period,sort:VIEWS_DESC}){edges{node{' + CLIP + '}}}}}';
    return gql(q, { name: name, first: first || 20, period: period || 'LAST_WEEK' }, { cache: true, retries: 0 })
      .then(function (d) { return edges(d.game && d.game.clips); });
  };

  // Поиск: пробуем searchFor (как на сайте), при ошибке — searchUsers/searchCategories.
  T.search = function (text) {
    var q1 = 'query($q:String!){searchFor(userQuery:$q,platform:"web"){' +
      'channels{items{' + USER.replace('description ', '').replace('bannerImageURL ', '') + '}} ' +
      'games{items{' + GAME + '}}}}';
    var exact = T.user(text.replace(/\s+/g, '').toLowerCase()).catch(function () { return null; });
    var main = gql(q1, { q: text }, { retries: 0, cache: true }).then(function (d) {
      var s = d.searchFor || {};
      return {
        channels: (s.channels && s.channels.items) || [],
        games: (s.games && s.games.items) || []
      };
    }).catch(function () {
      var q2 = 'query($q:String!){searchUsers(userQuery:$q,first:20){edges{node{id login displayName profileImageURL(width:150) followers{totalCount} stream{' + STREAM + '}}}} ' +
        'searchCategories(query:$q,first:20){edges{node{' + GAME + '}}}}';
      return gql(q2, { q: text }, { retries: 0, cache: true }).then(function (d) {
        return { channels: edges(d.searchUsers), games: edges(d.searchCategories) };
      });
    }).catch(function () { return { channels: [], games: [] }; });

    return Promise.all([exact, main]).then(function (r) {
      var res = r[1];
      if (r[0] && !res.channels.some(function (c) { return c.login === r[0].login; })) res.channels.unshift(r[0]);
      res.live = res.channels.filter(function (c) { return c.stream; }).map(function (c) {
        var s = c.stream;
        if (!s.broadcaster) s.broadcaster = { id: c.id, login: c.login, displayName: c.displayName, profileImageURL: c.profileImageURL };
        return s;
      });
      return res;
    });
  };

  // ---------- Воспроизведение ----------

  var TOKEN_Q = 'query PlaybackAccessToken_Template($login:String!,$isLive:Boolean!,$vodID:ID!,$isVod:Boolean!,$playerType:String!){' +
    'streamPlaybackAccessToken(channelName:$login,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isLive){value signature}' +
    'videoPlaybackAccessToken(id:$vodID,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isVod){value signature}}';

  // Если вошли в аккаунт и включено «Смотреть от своего аккаунта» — токен от имени пользователя
  // (Turbo/подписка = без рекламы, доступ к записям только для подписчиков)
  function userToken(kind, id, pt) {
    var vars = {
      login: kind === 'live' ? id : '', isLive: kind === 'live',
      vodID: kind === 'vod' ? id : '', isVod: kind === 'vod', playerType: pt
    };
    return Auth.gql(TOKEN_Q.replace('platform:"web"', 'platform:"android"').replace('platform:"web"', 'platform:"android"'), vars).then(function (d) {
      var t = kind === 'live' ? d.streamPlaybackAccessToken : d.videoPlaybackAccessToken;
      if (!t || !t.value) throw new Error(tr('Нет токена'));
      t.clientId = Auth.CLIENT_ID;
      return t;
    });
  }

  function token(kind, id, playerType) {
    if (window.Auth && Auth.loggedIn() && Settings.get('useAccount') === 'on') {
      return userToken(kind, id, playerType || 'site').catch(function () { return anonToken(kind, id, playerType); });
    }
    return anonToken(kind, id, playerType);
  }

  function anonToken(kind, id, playerType) {
    var types = [playerType || 'site', 'embed', 'popout', 'site'];
    var seen = {};
    types = types.filter(function (t) { if (seen[t]) return false; seen[t] = 1; return true; });
    var i = 0;
    function attempt() {
      var pt = types[i++];
      return gql(TOKEN_Q, {
        login: kind === 'live' ? id : '', isLive: kind === 'live',
        vodID: kind === 'vod' ? id : '', isVod: kind === 'vod', playerType: pt
      }, { retries: 2, timeout: 10000 }).then(function (d) {
        var t = kind === 'live' ? d.streamPlaybackAccessToken : d.videoPlaybackAccessToken;
        if (!t || !t.value) throw new Error(tr('Нет токена'));
        return t;
      }).catch(function (e) {
        if (i < types.length) return attempt();
        throw e;
      });
    }
    return attempt();
  }

  function anonTokenOnce(kind, id, playerType) {
    return gql(TOKEN_Q, {
      login: kind === 'live' ? id : '', isLive: kind === 'live',
      vodID: kind === 'vod' ? id : '', isVod: kind === 'vod', playerType: playerType
    }, { retries: 0, timeout: 5000 }).then(function (d) {
      var t = kind === 'live' ? d.streamPlaybackAccessToken : d.videoPlaybackAccessToken;
      if (!t || !t.value) throw new Error(tr('Нет токена'));
      return t;
    });
  }

  function qs(o) {
    var a = [];
    for (var k in o) a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]));
    return a.join('&');
  }

  // Какие кодеки просить у Twitch. H.264 декодирует любой ТВ; HEVC/AV1 (Enhanced Broadcasting, до 1440p)
  // включаем, только если браузер ТВ реально умеет их через MSE.
  T.codecSupport = function () {
    var ms = window.MediaSource || window.WebKitMediaSource;
    var ok = function (c) { try { return !!(ms && ms.isTypeSupported('video/mp4; codecs="' + c + '"')); } catch (e) { return false; } };
    return {
      h264: ok('avc1.64002A'),
      hevc: ok('hvc1.1.6.L150.90') || ok('hev1.1.6.L150.90') || ok('hvc1.2.4.L153.B0'),
      av1: ok('av01.0.08M.08') || ok('av01.0.12M.10')
    };
  };

  T.codecs = function () {
    var mode = Settings.get('codec');
    if (mode === 'h264' || T.forceH264) return 'avc1';
    var sup = T.codecSupport();
    var list = [];
    if (mode !== 'h264') {
      if (sup.av1 && mode === 'auto') list.push('av1');
      if (sup.hevc) list.push('h265', 'h264');
    }
    list.push('avc1');
    return list.filter(function (c, i) { return list.indexOf(c) === i; }).join(',');
  };

  // Возвращает URL master-плейлиста. По умолчанию — кодеки, которые ТВ декодирует аппаратно.
  function masterUrl(login, t, clientId) {
    return 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(login) + '.m3u8?' + qs({
      client_id: clientId,
      token: t.value,
      sig: t.signature,
      allow_source: 'true',
      allow_audio_only: 'false',
      fast_bread: 'true',
      player_backend: 'mediaplayer',
      playlist_include_framerate: 'true',
      reassignments_supported: 'true',
      supported_codecs: T.codecs(),
      cdm: 'wv',
      player_version: '1.28.0',
      p: Math.floor(Math.random() * 9999999)
      });
  }

  T.liveUrl = function (login, playerType) {
    login = login.toLowerCase();
    return token('live', login, playerType).then(function (t) {
      return masterUrl(login, t, t.clientId || CLIENT_ID);
    });
  };

  T.vodUrl = function (id, playerType) {
    return token('vod', String(id), playerType).then(function (t) {
      return 'https://usher.ttvnw.net/vod/' + encodeURIComponent(id) + '.m3u8?' + qs({
        client_id: t.clientId || CLIENT_ID,
        nauth: t.value,
        nauthsig: t.signature,
        allow_source: 'true',
        allow_audio_only: 'false',
        player_backend: 'mediaplayer',
        playlist_include_framerate: 'true',
        supported_codecs: T.codecs(),
        cdm: 'wv',
        p: Math.floor(Math.random() * 9999999)
      });
    });
  };

  // Клипы — обычные mp4, отдаём список качеств
  T.clipSources = function (slug) {
    var q = 'query($slug:ID!){clip(slug:$slug){playbackAccessToken(params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){signature value} videoQualities{frameRate quality sourceURL}}}';
    return gql(q, { slug: slug }).then(function (d) {
      var c = d.clip;
      if (!c || !c.videoQualities || !c.videoQualities.length) throw new Error(tr('Клип недоступен'));
      var tok = c.playbackAccessToken;
      return c.videoQualities.map(function (v) {
        return {
          quality: parseInt(v.quality, 10) || 0,
          fps: Math.round(v.frameRate || 30),
          url: v.sourceURL + (tok ? '?' + qs({ sig: tok.signature, token: tok.value }) : '')
        };
      }).sort(function (a, b) { return b.quality - a.quality; });
    });
  };

  // ---------- Значки чата ----------
  // Берём прямо у Twitch: глобальные (модератор, VIP, Prime, сезонные и ивентовые — Хэллоуин и т.п.)
  // и значки канала (подписчик, битсы). Новые значки Twitch появляются у нас сами, без обновления приложения.
  var BADGE = 'setID version title imageURL(size:DOUBLE)';
  function badgeMap(list) {
    var m = {};
    (list || []).forEach(function (b) { if (b && b.setID && b.imageURL) m[b.setID + '/' + b.version] = { url: b.imageURL, title: b.title || b.setID }; });
    return m;
  }
  T.globalBadges = function () {
    return gql('query{badges{' + BADGE + '}}', {}, { retries: 1 }).then(function (d) { return badgeMap(d.badges); });
  };
  T.channelBadges = function (login) {
    return gql('query($login:String!){user(login:$login){broadcastBadges{' + BADGE + '}}}', { login: login }, { retries: 1 })
      .then(function (d) { return badgeMap(d.user && d.user.broadcastBadges); });
  };

  // ---------- Рекламные паузы ----------
  // Зрителям без входа/Turbo Twitch иногда вклеивает в эфир рекламу или заставку
  // «Commercial break in progress». Такие куски видно в медиаплейлисте (метки stitched-ad,
  // сегменты без названия «live»). На время паузы подменяем плейлист тем же качеством из
  // резервного потока Twitch (другой тип плеера), где рекламы обычно нет.
  T.isAdPlaylist = function (text) {
    return /stitched-ad|X-TV-TWITCH-AD|CLASS="twitch-ad/.test(text) || /#EXTINF:[^,\n]*,(?!live)[^\s]/.test(text);
  };

  var BACKUP_TYPES = ['embed', 'popout', 'autoplay', 'picture-by-picture'];
  var backup = { login: null, good: null, masters: {} };

  function absolute(base, url) {
    if (/^https?:\/\//.test(url)) return url;
    try { return new URL(url, base).href; } catch (e) { return url; }
  }

  function getText(url) {
    return request(url, {}, 4000, 0).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  // варианты качества резервного потока (кэш 4 минуты — токен живёт дольше)
  function backupVariants(login, type) {
    var key = login + '|' + type, c = backup.masters[key]; // кэш — свой у каждого канала
    if (c && Date.now() - c.t < 240000) return Promise.resolve(c.list);
    return anonTokenOnce('live', login, type).then(function (t) {
      var url = masterUrl(login, t, CLIENT_ID);
      return getText(url).then(function (txt) {
        var list = [], lines = txt.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var m = /^#EXT-X-STREAM-INF:(.*)$/.exec(lines[i]);
          if (!m || !lines[i + 1]) continue;
          var res = /RESOLUTION=\d+x(\d+)/.exec(m[1]);
          list.push({ height: res ? +res[1] : 0, url: absolute(url, lines[i + 1].trim()) });
        }
        // пока искали, переключили канал — в общий кэш чужое не пишем
        if (backup.login === login) backup.masters[key] = { t: Date.now(), list: list };
        return list;
      });
    });
  }

  // Медиаплейлист без рекламы того же качества (или ближайшего ниже). null — не нашли.
  // Ждём не дольше 2,5 с: иначе hls.js без нового плейлиста опустошит буфер. Не успели — отдаём исходный
  // плейлист; поиск при этом доводится в фоне, и найденный резервный тип плеера и список его качеств
  // запоминаются — следующее обновление плейлиста (через 2 с) получает поток без рекламы сразу.
  // Не нашли поток без рекламы — минуту не ищем снова, чтобы не нагружать ТВ и сеть.
  T.adFreePlaylist = function (login, height) {
    login = login.toLowerCase();
    if (backup.login !== login) { backup.login = login; backup.good = null; backup.masters = {}; backup.failUntil = 0; backup.jobs = {}; }
    if (backup.failUntil > Date.now()) return Promise.resolve(null);
    var hk = height || 0; // у каждого качества — свой поиск
    if (!backup.jobs[hk]) {
      var job = backup.jobs[hk] = findClean(login, height).then(function (txt) {
        if (backup.login !== login) return null; // поиск для прошлого канала — результат не нужен
        if (backup.jobs[hk] === job) delete backup.jobs[hk];
        if (!txt) backup.failUntil = Date.now() + 60000;
        return txt;
      });
    }
    var limit = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 2500); });
    return Promise.race([backup.jobs[hk], limit]);
  };

  function findClean(login, height) {
    var types = BACKUP_TYPES.slice();
    if (backup.good) { types.splice(types.indexOf(backup.good), 1); types.unshift(backup.good); }
    var i = 0;
    function next() {
      if (i >= types.length) return Promise.resolve(null);
      var type = types[i++];
      return backupVariants(login, type).then(function (list) {
        var pick = null;
        list.forEach(function (v) {
          if (!v.height) return;
          if (v.height <= (height || 1080) && (!pick || v.height > pick.height)) pick = v;
        });
        if (!pick) pick = list.filter(function (v) { return v.height; })[0];
        if (!pick) return next();
        return getText(pick.url).then(function (txt) {
          if (T.isAdPlaylist(txt) || txt.indexOf('#EXTINF') < 0) return next();
          backup.good = type;
          // ссылки на сегменты — абсолютные, чтобы hls.js грузил их откуда надо
          return txt.split('\n').map(function (l) { return l && l[0] !== '#' ? absolute(pick.url, l.trim()) : l; }).join('\n');
        });
      }).catch(function () { return next(); });
    }
    return next();
  }

  function mediaSeq(txt) {
    var m = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(txt);
    return m ? +m[1] : 0;
  }
  function firstPdt(txt) {
    var m = /#EXT-X-PROGRAM-DATE-TIME:([^\s]+)/.exec(txt);
    var t = m ? Date.parse(m[1]) : NaN;
    return isNaN(t) ? null : t;
  }
  // Номер первого сегмента резервного плейлиста подгоняем под основной по реальному времени сегментов
  // (PROGRAM-DATE-TIME). Без меток времени принимаем только совпадающую нумерацию (±1).
  function alignSeq(clean, orig) {
    var a = mediaSeq(orig), b = mediaSeq(clean);
    var ta = firstPdt(orig), tb = firstPdt(clean);
    var dur = /#EXTINF:([\d.]+)/.exec(orig);
    dur = dur ? parseFloat(dur[1]) : 2;
    if (ta !== null && tb !== null && dur > 0) {
      var want = a + Math.round((tb - ta) / 1000 / dur);
      return clean.replace(/#EXT-X-MEDIA-SEQUENCE:\d+/, '#EXT-X-MEDIA-SEQUENCE:' + want);
    }
    return Math.abs(a - b) <= 1 ? clean : null;
  }

  // Загрузчик плейлистов для hls.js: пропускает всё как есть, кроме медиаплейлистов эфира с рекламой
  T.adLoader = function (getInfo, onAd) {
    var Base = window.Hls && Hls.DefaultConfig.loader;
    function L(config) { this.inner = new Base(config); this.dead = false; }
    ['stats', 'context'].forEach(function (k) {
      Object.defineProperty(L.prototype, k, { get: function () { return this.inner[k]; } });
    });
    L.prototype.abort = function () { this.dead = true; this.inner.abort(); };
    L.prototype.getCacheAge = function () { return this.inner.getCacheAge ? this.inner.getCacheAge() : null; };
    L.prototype.getResponseHeader = function (n) { return this.inner.getResponseHeader ? this.inner.getResponseHeader(n) : null; };
    L.prototype.destroy = function () { this.dead = true; this.inner.destroy(); };
    L.prototype.load = function (context, config, callbacks) {
      var self = this;
      var info = getInfo();
      if (context.type !== 'level' || !info || !info.login || !info.enabled) return this.inner.load(context, config, callbacks);
      var cb = {};
      for (var k in callbacks) cb[k] = callbacks[k];
      cb.onSuccess = function (response, stats, ctx, net) {
        var text = typeof response.data === 'string' ? response.data : '';
        if (!text || !T.isAdPlaylist(text)) { if (onAd) onAd(false); return callbacks.onSuccess(response, stats, ctx, net); }
        T.adFreePlaylist(info.login, info.height(ctx.level)).then(function (clean) {
          if (self.dead) return;
          // hls.js склеивает обновления плейлиста по номерам сегментов — резервный поток должен идти
          // «в ногу» с основным, иначе пропустит или повторит куски
          if (clean) clean = alignSeq(clean, text);
          if (onAd) onAd(true, !!clean);
          if (clean) response.data = clean;
          callbacks.onSuccess(response, stats, ctx, net);
        }, function () {
          if (!self.dead) callbacks.onSuccess(response, stats, ctx, net);
        });
      };
      this.inner.load(context, config, cb);
    };
    return L;
  };

  T.clearCache = function () { cache = {}; personal.p = null; };

  window.Twitch = T;
})();
