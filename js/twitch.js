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

    var body = JSON.stringify({ query: query, variables: variables || {} });
    return request(GQL, {
      method: 'POST',
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8', 'X-Device-Id': DEVICE_ID },
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
  }

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

  T.gameClips = function (name, first) {
    var q = 'query($name:String!,$first:Int){game(name:$name){clips(first:$first,criteria:{period:LAST_WEEK,sort:VIEWS_DESC}){edges{node{' + CLIP + '}}}}}';
    return gql(q, { name: name, first: first || 20 }, { cache: true, retries: 0 })
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
  T.liveUrl = function (login, playerType) {
    login = login.toLowerCase();
    return token('live', login, playerType).then(function (t) {
      return 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(login) + '.m3u8?' + qs({
        client_id: t.clientId || CLIENT_ID,
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

  T.clearCache = function () { cache = {}; };

  window.Twitch = T;
})();
