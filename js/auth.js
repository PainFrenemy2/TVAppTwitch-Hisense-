/* Вход в аккаунт Twitch как в официальном приложении для ТВ: код + twitch.tv/activate (Device Code Flow) */
(function () {
  'use strict';

  // Client-ID приложения Twitch для Android/TV — у него включён вход по коду активации
  var CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
  var SCOPES = 'chat:read chat:edit user:read:follows user:read:subscriptions';
  var ID = 'https://id.twitch.tv/oauth2/';

  // Несколько аккаунтов, как профили в YouTube: [{token, refresh, expires, user:{id,login,displayName,profileImageURL}}]
  var Auth = {
    CLIENT_ID: CLIENT_ID,
    accounts: U.store.get('accounts', []),
    data: null,
    listeners: []
  };
  (function migrate() {
    var old = U.store.get('auth', null);
    if (old && old.user && !Auth.accounts.length) Auth.accounts.push(old);
    var active = U.store.get('activeAccount', null);
    Auth.data = Auth.accounts.filter(function (a) { return a.user && a.user.login === active; })[0] || null;
  })();

  // запрос с ограничением по времени: зависший ответ не должен навсегда блокировать проверки и окна
  function fetchTimeout(url, init, ms) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctrl) ctrl.abort();
        reject(new Error(tr('Таймаут сети')));
      }, ms || 12000);
      if (ctrl) init.signal = ctrl.signal;
      fetch(url, init).then(function (r) { if (!done) { done = true; clearTimeout(timer); resolve(r); } },
        function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
  }

  function form(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }

  function post(url, body) {
    // с таймаутом: после сна ТВ Wi-Fi поднимается не сразу, и «вечный» запрос заблокировал бы весь вход
    return fetchTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(body)
    }, 12000).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  Auth.loggedIn = function () { return !!(Auth.data && Auth.data.token); };
  Auth.user = function () { return Auth.data && Auth.data.user; };

  Auth.onChange = function (fn) { Auth.listeners.push(fn); };
  function changed() { Auth.listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); }

  function save() {
    if (Auth.data && Auth.data.user) {
      var id = Auth.data.user.id;
      Auth.accounts = Auth.accounts.filter(function (a) { return !a.user || a.user.id !== id; });
      Auth.accounts.push(Auth.data);
    }
    U.store.set('accounts', Auth.accounts);
    U.store.set('activeAccount', Auth.data && Auth.data.user ? Auth.data.user.login : null);
  }

  // Переключить профиль (null — смотреть без входа)
  Auth.switchTo = function (login) {
    Auth.data = Auth.accounts.filter(function (a) { return a.user && a.user.login === login; })[0] || null;
    U.store.set('activeAccount', Auth.data ? login : null);
    U.store.set('followsCache', []);
    changed();
  };

  Auth.remove = function (login) {
    Auth.accounts = Auth.accounts.filter(function (a) { return !a.user || a.user.login !== login; });
    if (Auth.data && Auth.data.user && Auth.data.user.login === login) Auth.data = null;
    save();
    changed();
  };

  // Шаг 1: получаем код для показа на экране
  Auth.startDevice = function () {
    // если Twitch отказал в каком-то праве — пробуем наборы поменьше; доступ к отслеживаемым (user:read:follows)
    // просим в каждом, без него на ТВ не будет списка ваших каналов
    var sets = [SCOPES, 'user:read:follows chat:read', 'user:read:follows', ''];
    var lastErr = null;
    function attempt(i) {
      if (i >= sets.length) return Promise.reject(new Error((lastErr && lastErr.message) || tr('Twitch не выдал код')));
      return post(ID + 'device', { client_id: CLIENT_ID, scopes: sets[i] }).then(function (j) {
        if (j.device_code) { j.scopesAsked = sets[i]; return j; }
        lastErr = new Error(j.message || '');
        return attempt(i + 1);
      });
    }
    return attempt(0);
  };

  // Шаг 2: ждём, пока пользователь введёт код на телефоне/компьютере
  Auth.poll = function (dev, onTick) {
    var stopped = false;
    var interval = Math.max(2, dev.interval || 5) * 1000;
    var deadline = Date.now() + (dev.expires_in || 1800) * 1000;
    var p = new Promise(function (resolve, reject) {
      function tick() {
        if (stopped) return;
        if (Date.now() > deadline) return reject(new Error(tr('Код устарел — получите новый')));
        post(ID + 'token', {
          client_id: CLIENT_ID,
          scopes: dev.scopesAsked !== undefined ? dev.scopesAsked : SCOPES,
          device_code: dev.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }).then(function (j) {
          if (stopped) return;
          if (j.access_token) {
            var prev = Auth.data;
            Auth.data = { token: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
            return Auth.loadUser().then(function (u) { U.store.set('followsCache', []); resolve(u); }, function (e) { Auth.data = prev; reject(e); });
          }
          var msg = String(j.message || '');
          if (msg.indexOf('slow_down') >= 0) { interval += 5000; return setTimeout(tick, interval); }
          if (msg.indexOf('pending') >= 0 || j._status === 400 && !/denied|expired|invalid/.test(msg)) {
            if (onTick) onTick();
            return setTimeout(tick, interval);
          }
          reject(new Error(msg || tr('Вход отклонён')));
        }, function () { if (!stopped) setTimeout(tick, interval); });
      }
      setTimeout(tick, interval);
    });
    p.stop = function () { stopped = true; };
    return p;
  };

  // Одно обновление за раз: refresh-токен одноразовый, второй параллельный запрос его бы «сжёг»
  // Refresh-токен у Twitch одноразовый: после продления действует только новый. Если ТВ выключится
  // (или уйдёт в сон) раньше, чем новый токен запишется на диск, при следующем запуске останется
  // «сожжённый» старый — и вход слетит. Поэтому: не продлеваем, пока приложение не на экране
  // (ТВ в режиме ожидания), а новый токен сразу записываем и в localStorage, и в резервную копию.
  // «Скрыто» — только если и пульт давно не трогали: некоторые прошивки VIDAA ошибочно держат
  // document.hidden = true, и тогда вход никогда бы не продлился
  var lastKey = 0;
  document.addEventListener('keydown', function () { lastKey = Date.now(); }, true);
  function asleep() { return document.hidden && Date.now() - lastKey > 30000; }
  Auth.asleep = asleep;

  Auth.refresh = function () {
    if (!Auth.data || !Auth.data.refresh) return Promise.reject(new Error(tr('Нет refresh-токена')));
    if (asleep()) return Promise.reject(new Error(tr('Не удалось обновить вход'))); // не invalid: вход не трогаем
    var acc = Auth.data;
    // общий запрос — только для того же аккаунта: после смены профиля нельзя отдать чужой токен
    if (Auth._rp && Auth._rpAcc === acc) return Auth._rp;
    // недавно не удалось (сеть/сервер) — не долбим Twitch повторами, ждём 30 с
    if (Auth._failAcc === acc && Date.now() - Auth._failAt < 30000) return Promise.reject(Auth._failErr);
    Auth._rpAcc = acc;
    var rp = Auth._rp = post(ID + 'token', { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: acc.refresh }).then(function (j) {
      if (Auth._rp === rp) Auth._rp = null;
      if (!j.access_token) {
        var e = new Error(j.message || tr('Не удалось обновить вход'));
        e.invalid = j._status === 400 || j._status === 401; // Twitch прямо отверг токен
        // для «Диагностики аккаунта»: что ответил Twitch при последнем продлении
        acc.refreshLog = { at: Date.now(), ok: false, status: j._status, msg: String(j.message || '') };
        save(); U.store.flush();
        throw e;
      }
      acc.token = j.access_token;
      if (j.refresh_token) acc.refresh = j.refresh_token;
      acc.expires = Date.now() + (j.expires_in || 3600) * 1000;
      acc.needsLogin = false;
      acc.refreshLog = { at: Date.now(), ok: true, status: j._status, msg: '' };
      Auth._failAcc = null;
      save();
      U.store.flush(); // новый refresh-токен — на диск немедленно (старый уже недействителен)
    }, function (e) {
      if (Auth._rp === rp) Auth._rp = null;
      acc.refreshLog = { at: Date.now(), ok: false, status: 0, msg: String((e && e.message) || e) };
      save();
      throw e;
    }).catch(function (e) {
      if (!e.invalid) { Auth._failAcc = acc; Auth._failAt = Date.now(); Auth._failErr = e; }
      throw e;
    });
    return rp;
  };

  // Проверка токена (и заодно логин) — заранее обновляем, если скоро истечёт.
  // Аккаунт при этом НИКОГДА не удаляем: если Twitch отверг refresh-токен (например, ТВ выключили,
  // не успев сохранить новый), помечаем «нужно войти снова» — профиль, избранное и подписки остаются.
  Auth.ensure = function () {
    if (!Auth.loggedIn()) return Promise.reject(new Error(tr('Не выполнен вход')));
    var acc = Auth.data;
    if (acc.needsLogin) return Promise.reject(new Error(tr('Вход в Twitch устарел — войдите снова')));
    if (acc.expires && acc.expires - Date.now() < 5 * 60 * 1000) {
      // приложение свёрнуто / ТВ в режиме ожидания — не продлеваем (см. Auth.refresh)
      if (asleep()) return acc.expires > Date.now() ? Promise.resolve() : Promise.reject(new Error(tr('Не удалось обновить вход')));
      return Auth.refresh().catch(function (e) {
        if (e.invalid) { markExpired(acc); throw e; }
        // сеть ещё не поднялась после сна ТВ — пока токен жив, работаем с ним
        if (acc.expires > Date.now()) return;
        throw e;
      });
    }
    return Promise.resolve();
  };

  function markExpired(acc) {
    if (acc.needsLogin) return;
    acc.needsLogin = true;
    save();
    changed();
  }
  Auth.needsLogin = function () { return !!(Auth.data && Auth.data.needsLogin); };

  Auth.loadUser = function () {
    var acc = Auth.data; // ответ относится к этому аккаунту, даже если профиль успели сменить
    return Auth.gql('query{currentUser{id login displayName profileImageURL(width:300)}}').then(function (d) {
      if (!d || !d.currentUser) throw new Error(tr('Не удалось получить профиль'));
      // пока ждали ответ, сменили профиль — ответ мог прийти по токену другого аккаунта
      if (Auth.data !== acc || (acc.user && acc.user.id !== d.currentUser.id)) return acc.user;
      acc.user = d.currentUser;
      save();
      changed();
      return d.currentUser;
    });
  };

  Auth.logout = function (silent) {
    var u = Auth.user();
    if (u) Auth.remove(u.login);
    else { Auth.data = null; save(); changed(); }
    U.store.set('followsCache', []);
    if (!silent) UI.toast(tr('Вы вышли из аккаунта'));
  };

  // GQL от имени пользователя
  Auth.gql = function (query, variables, retried) {
    return Auth.ensure().then(function () {
      return fetchTimeout('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Authorization': 'OAuth ' + Auth.data.token, 'Content-Type': 'text/plain;charset=UTF-8', 'Accept-Language': I18N.lang },
        body: JSON.stringify({ query: query, variables: variables || {} })
      });
    }).then(function (r) {
      if (r.status === 401 && !retried) {
        var acc = Auth.data;
        return Auth.refresh().then(function () { return Auth.gql(query, variables, true); }, function (e) {
          if (e.invalid && acc) markExpired(acc);
          throw e;
        });
      }
      return r.json().then(function (j) {
        if (j.errors && !j.data) throw new Error(j.errors[0].message);
        return j.data;
      });
    });
  };

  // ---------- Официальный API Twitch (Helix) ----------
  // Списки отслеживаемого берём отсюда: Twitch поддерживает его официально (права user:read:follows),
  // а внутренний GQL у сторонних приложений может отдавать пустой список без ошибки.
  Auth.helix = function (path, retried) {
    var acc;
    return Auth.ensure().then(function () {
      acc = Auth.data;
      return fetchTimeout('https://api.twitch.tv/helix/' + path, { headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + acc.token } });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        // 401 «Missing scope» — у входа нет нужного права: токен в порядке, обновлять его бесполезно
        if (r.status === 401 && !retried && !/scope/i.test(j.message || '')) {
          return Auth.refresh().then(function () { return Auth.helix(path, true); }, function (e) { if (e.invalid) markExpired(acc); throw e; });
        }
        if (!r.ok) throw new Error('Helix ' + r.status + (j.message ? ': ' + j.message : ''));
        return j;
      });
    });
  };

  // Что выдал Twitch при входе: client_id, логин, права (scopes) — для «Диагностики аккаунта»
  Auth.validate = function () {
    if (!Auth.loggedIn()) return Promise.reject(new Error(tr('Не выполнен вход')));
    return fetch(ID + 'validate', { headers: { 'Authorization': 'OAuth ' + Auth.data.token } }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error('validate ' + r.status + (j.message ? ': ' + j.message : '')); return j; });
    });
  };

  function helixFollows() {
    var u = Auth.user();
    if (!u || !u.id) return Promise.reject(new Error('no user id'));
    var all = [];
    function page(cursor) {
      return Auth.helix('channels/followed?user_id=' + encodeURIComponent(u.id) + '&first=100' + (cursor ? '&after=' + encodeURIComponent(cursor) : ''))
        .then(function (j) {
          (j.data || []).forEach(function (f) { if (f.broadcaster_login) all.push(f.broadcaster_login); });
          var next = j.pagination && j.pagination.cursor;
          if (next && (j.data || []).length && all.length < 2000) return page(next);
          return all;
        });
    }
    return page(null);
  }

  // GQL: через currentUser, а если пусто — через user(login), как страница «Отслеживаемое» на twitch.tv
  function gqlFollows() {
    return gqlFollowsVia('currentUser').then(function (list) {
      var u = Auth.user();
      return list.length || !u ? list : gqlFollowsVia('user').catch(function () { return list; });
    });
  }
  function gqlFollowsVia(root) {
    var all = [], u = Auth.user();
    var q = root === 'user'
      ? 'query($after:Cursor,$login:String!){user(login:$login){follows(first:100,after:$after,order:DESC){edges{cursor node{login}} pageInfo{hasNextPage}}}}'
      : 'query($after:Cursor){currentUser{follows(first:100,after:$after){edges{cursor node{login}} pageInfo{hasNextPage}}}}';
    function page(after) {
      return Auth.gql(q, { after: after || null, login: u ? u.login : '' })
        .then(function (d) {
          var owner = root === 'user' ? d.user : d.currentUser;
          var f = owner && owner.follows;
          var edges = (f && f.edges) || [];
          edges.forEach(function (e) { if (e.node) all.push(e.node.login); });
          if (f && f.pageInfo && f.pageInfo.hasNextPage && edges.length && all.length < 2000) return page(edges[edges.length - 1].cursor);
          return all;
        });
    }
    return page(null);
  }

  // Все каналы, которые отслеживает пользователь: сначала официальный API, потом GQL.
  // Пустой ответ одного источника не считаем окончательным — пробуем второй.
  Auth.follows = function () {
    Auth.followsDenied = false;
    return helixFollows().then(function (list) {
      return list.length ? list : gqlFollows().catch(function () { return list; });
    }, function (e) {
      // 401/403 от официального API — у входа нет права на список отслеживаемых: нужно войти заново
      if (/Helix 40[13]/.test(e && e.message)) Auth.followsDenied = true;
      return gqlFollows().catch(function () { throw e; });
    });
  };

  // порядок «по рекомендации» — как список «Отслеживаемые каналы» слева на twitch.tv; если Twitch не знает sort — без него
  var FLU = 'edges{node{id login displayName profileImageURL(width:70) stream{id title viewersCount createdAt type previewImageURL(width:440,height:248) game{id name displayName}}}}';
  function gqlFollowedLive() {
    return Auth.gql('query{currentUser{followedLiveUsers(first:100,sort:RELEVANCE){' + FLU + '}}}')
      .catch(function () { return Auth.gql('query{currentUser{followedLiveUsers(first:100){' + FLU + '}}}'); })
      .then(function (d) {
        var c = d.currentUser && d.currentUser.followedLiveUsers;
        return ((c && c.edges) || []).map(function (e) { return e.node; }).filter(function (u) { return u && u.stream; }).map(function (u) {
          var s = u.stream;
          s.broadcaster = { id: u.id, login: u.login, displayName: u.displayName, profileImageURL: u.profileImageURL };
          return s;
        });
      });
  }

  // Кто из отслеживаемых сейчас в эфире: официальный API (кто в эфире) + карточки с аватарками из GQL
  function helixFollowedLive() {
    var u = Auth.user();
    if (!u || !u.id) return Promise.reject(new Error('no user id'));
    return Auth.helix('streams/followed?user_id=' + encodeURIComponent(u.id) + '&first=100').then(function (j) {
      var logins = (j.data || []).map(function (st) { return st.user_login; }).filter(Boolean);
      if (!logins.length) return [];
      return Twitch.users(logins).then(function (us) {
        return us.filter(function (x) { return x.stream; }).map(function (x) {
          var st = x.stream; st.broadcaster = st.broadcaster || { id: x.id, login: x.login, displayName: x.displayName, profileImageURL: x.profileImageURL };
          return st;
        });
      });
    });
  }

  // Кто из отслеживаемых в эфире: оба источника параллельно. Порядок — как у Twitch (GQL, «по рекомендации»),
  // а официальный API добавляет тех, кого GQL не вернул (он у сторонних приложений бывает неполным).
  Auth.followedLive = function () {
    var g = gqlFollowedLive().then(function (l) { return { ok: true, list: l }; }, function (e) { return { ok: false, e: e, list: [] }; });
    var hx = helixFollowedLive().then(function (l) { return { ok: true, list: l }; }, function (e) { return { ok: false, e: e, list: [] }; });
    return Promise.all([g, hx]).then(function (r) {
      if (!r[0].ok && !r[1].ok) throw r[1].e || r[0].e;
      var seen = {}, out = [];
      r[0].list.concat(r[1].list).forEach(function (st) {
        var l = st.broadcaster && st.broadcaster.login;
        if (l && !seen[l]) { seen[l] = 1; out.push(st); }
      });
      return out;
    });
  };

  // Кто из подписок в эфире; если вход устарел или Twitch не ответил — по сохранённому списку подписок без входа
  Auth.followedLiveSafe = function () {
    return Auth.followedLive().catch(function () {
      var logins = Auth.cachedFollows().slice(0, 300);
      if (!logins.length) return [];
      return Twitch.users(logins).then(function (us) {
        return us.filter(function (u) { return u.stream; }).map(function (u) { var st = u.stream; st.broadcaster = st.broadcaster || u; return st; });
      });
    });
  };

  // Категории, которые отслеживает пользователь (вкладка «Категории» в «Отслеживаемом»)
  Auth.followedGames = function () {
    if (!Auth.loggedIn() || Auth.needsLogin()) return Promise.resolve([]);
    return Auth.gql('query{currentUser{followedGames(first:100,type:ALL){nodes{id name displayName viewersCount boxArtURL(width:188,height:250)}}}}')
      .then(function (d) {
        var f = d && d.currentUser && d.currentUser.followedGames;
        return (f && f.nodes) || [];
      });
  };

  // Логины для избранного: подписки аккаунта (кэш) + локальные
  Auth.cachedFollows = function () { return U.store.get('followsCache', []); };
  Auth.syncFollows = function () {
    if (!Auth.loggedIn()) return Promise.resolve([]);
    return Auth.follows().then(function (list) { U.store.set('followsCache', list); return list; });
  };

  window.Auth = Auth;
})();
