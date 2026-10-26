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

  function form(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(body)
    }).then(function (r) {
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
    return post(ID + 'device', { client_id: CLIENT_ID, scopes: SCOPES }).then(function (j) {
      if (j.device_code) return j;
      // если какой-то scope не принят — пробуем без них
      return post(ID + 'device', { client_id: CLIENT_ID, scopes: '' }).then(function (j2) {
        if (!j2.device_code) throw new Error(j2.message || j.message || tr('Twitch не выдал код'));
        return j2;
      });
    });
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
          scopes: SCOPES,
          device_code: dev.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }).then(function (j) {
          if (stopped) return;
          if (j.access_token) {
            Auth.data = { token: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
            return Auth.loadUser().then(function (u) { U.store.set('followsCache', []); resolve(u); }, reject);
          }
          var msg = String(j.message || '');
          if (msg.indexOf('pending') >= 0 || j._status === 400 && !/denied|expired|invalid/.test(msg)) {
            if (onTick) onTick();
            return setTimeout(tick, interval);
          }
          if (msg.indexOf('slow_down') >= 0) { interval += 5000; return setTimeout(tick, interval); }
          reject(new Error(msg || tr('Вход отклонён')));
        }, function () { if (!stopped) setTimeout(tick, interval); });
      }
      setTimeout(tick, interval);
    });
    p.stop = function () { stopped = true; };
    return p;
  };

  Auth.refresh = function () {
    if (!Auth.data || !Auth.data.refresh) return Promise.reject(new Error(tr('Нет refresh-токена')));
    return post(ID + 'token', { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: Auth.data.refresh }).then(function (j) {
      if (!j.access_token) throw new Error(j.message || tr('Не удалось обновить вход'));
      Auth.data.token = j.access_token;
      if (j.refresh_token) Auth.data.refresh = j.refresh_token;
      Auth.data.expires = Date.now() + (j.expires_in || 3600) * 1000;
      save();
    });
  };

  // Проверка токена (и заодно логин) — заранее обновляем, если скоро истечёт
  Auth.ensure = function () {
    if (!Auth.loggedIn()) return Promise.reject(new Error(tr('Не выполнен вход')));
    if (Auth.data.expires && Auth.data.expires - Date.now() < 5 * 60 * 1000) {
      return Auth.refresh().catch(function (e) { Auth.logout(true); throw e; });
    }
    return Promise.resolve();
  };

  Auth.loadUser = function () {
    return Auth.gql('query{currentUser{id login displayName profileImageURL(width:70)}}').then(function (d) {
      if (!d || !d.currentUser) throw new Error(tr('Не удалось получить профиль'));
      Auth.data.user = d.currentUser;
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
      return fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Authorization': 'OAuth ' + Auth.data.token, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ query: query, variables: variables || {} })
      });
    }).then(function (r) {
      if (r.status === 401 && !retried) return Auth.refresh().then(function () { return Auth.gql(query, variables, true); });
      return r.json().then(function (j) {
        if (j.errors && !j.data) throw new Error(j.errors[0].message);
        return j.data;
      });
    });
  };

  // Подписки пользователя: все каналы + кто сейчас в эфире
  Auth.follows = function () {
    var all = [];
    function page(after) {
      return Auth.gql('query($after:Cursor){currentUser{follows(first:100,after:$after){edges{cursor node{login}} pageInfo{hasNextPage}}}}', { after: after || null })
        .then(function (d) {
          var f = d.currentUser && d.currentUser.follows;
          var edges = (f && f.edges) || [];
          edges.forEach(function (e) { if (e.node) all.push(e.node.login); });
          if (f && f.pageInfo && f.pageInfo.hasNextPage && edges.length && all.length < 1000) return page(edges[edges.length - 1].cursor);
          return all;
        });
    }
    return page(null);
  };

  Auth.followedLive = function () {
    return Auth.gql('query{currentUser{followedLiveUsers(first:100){edges{node{id login displayName profileImageURL(width:70) stream{id title viewersCount createdAt type previewImageURL(width:440,height:248) game{id name displayName}}}}}}}')
      .then(function (d) {
        var c = d.currentUser && d.currentUser.followedLiveUsers;
        return ((c && c.edges) || []).map(function (e) { return e.node; }).filter(function (u) { return u && u.stream; }).map(function (u) {
          var s = u.stream;
          s.broadcaster = { id: u.id, login: u.login, displayName: u.displayName, profileImageURL: u.profileImageURL };
          return s;
        });
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
