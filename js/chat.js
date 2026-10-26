/* Чат Twitch только для чтения: анонимное подключение к IRC через WebSocket + эмоуты Twitch, 7TV, BTTV, FFZ */
(function () {
  'use strict';
  var h = U.h;

  var MAX_LINES = 80;
  var DEFAULT_COLORS = ['#FF0000', '#0000FF', '#00FF00', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57',
    '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];

  var Chat = {
    ws: null, channel: null, roomId: null, el: null, list: null, state: null,
    queue: [], flushTimer: null, retry: 0, active: false, emotes: {}
  };

  Chat.init = function () {
    Chat.el = U.$('#chat');
    Chat.list = U.$('.chat-list', Chat.el);
    Chat.state = U.$('.chat-state', Chat.el);
  };

  Chat.start = function (login, roomId) {
    if (Chat.active && Chat.channel === login) return;
    Chat.stop();
    Chat.active = true;
    Chat.channel = login.toLowerCase();
    Chat.roomId = roomId || null;
    Chat.list.innerHTML = '';
    Chat.retry = 0;
    Chat.emotes = {};
    Chat.system(tr('Подключение к чату…'), 'chat-connecting');
    connect();
    loadThirdPartyEmotes(Chat.roomId);
  };

  Chat.stop = function () {
    Chat.active = false;
    Chat.queue = [];
    if (Chat.ws) {
      try { Chat.ws.onclose = null; Chat.ws.close(); } catch (e) { /* уже закрыт */ }
      Chat.ws = null;
    }
  };

  function connect() {
    var ch = Chat.channel;
    var ws;
    try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { return reconnect(); }
    Chat.ws = ws;
    ws.onopen = function () {
      Chat.retry = 0;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + ch);
    };
    ws.onmessage = function (ev) {
      var lines = String(ev.data).split('\r\n');
      for (var i = 0; i < lines.length; i++) if (lines[i]) handle(lines[i]);
    };
    ws.onclose = function () { if (Chat.active && Chat.channel === ch) reconnect(); };
    ws.onerror = function () { /* onclose сработает следом */ };
  }

  function reconnect() {
    if (!Chat.active) return;
    Chat.retry++;
    Chat.state.textContent = tr('переподключение…');
    var ch = Chat.channel;
    setTimeout(function () { if (Chat.active && Chat.channel === ch) connect(); }, Math.min(15000, 1000 * Chat.retry));
  }

  function parseTags(s) {
    var o = {};
    s.split(';').forEach(function (p) {
      var i = p.indexOf('=');
      o[p.slice(0, i)] = p.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
    });
    return o;
  }

  // Подключились — убираем «Подключение к чату…», чтобы строка не висела
  function connected() {
    Chat.state.textContent = '';
    Chat.queue = Chat.queue.filter(function (m) { return m.cls !== 'chat-connecting'; });
    U.$$('.chat-connecting', Chat.list).forEach(function (el) { el.remove(); });
  }

  function handle(line) {
    if (line.indexOf('PING') === 0) { Chat.ws.send('PONG :tmi.twitch.tv'); return; }
    var tags = {};
    if (line[0] === '@') {
      var sp = line.indexOf(' ');
      tags = parseTags(line.slice(1, sp));
      line = line.slice(sp + 1);
    }
    var m = /^:(\S+) (\S+)(?: (\S+))?(?: :([\s\S]*))?$/.exec(line);
    if (!m) return;
    var prefix = m[1], cmd = m[2], text = m[4] || '';
    if (cmd === 'PRIVMSG' || cmd === 'ROOMSTATE' || cmd === '366') connected();
    if (cmd === 'PRIVMSG') {
      var nick = tags['display-name'] || prefix.split('!')[0];
      var action = false;
      if (text.indexOf('\u0001ACTION ') === 0) { action = true; text = text.slice(8, -1); }
      push({ nick: nick, color: tags.color, text: text, emotes: tags.emotes, badges: tags.badges, action: action, bits: tags.bits });
    } else if (cmd === 'ROOMSTATE') {
      if (tags['room-id'] && !Chat.roomId) { Chat.roomId = tags['room-id']; loadThirdPartyEmotes(Chat.roomId); }
      Chat.state.textContent = '';
    } else if (cmd === '366') {
      Chat.state.textContent = '';
      Chat.system(tr('Добро пожаловать в чат!'));
    } else if (cmd === 'USERNOTICE') {
      if (tags['system-msg']) Chat.system(tags['system-msg'] + (text ? ' — ' + text : ''), 'notice');
    } else if (cmd === 'CLEARCHAT' && !text) {
      Chat.list.innerHTML = '';
      Chat.system(tr('Чат очищен модератором'));
    } else if (cmd === 'RECONNECT') {
      try { Chat.ws.close(); } catch (e) { /* ignore */ }
    }
  }

  // Сообщения пачкой раз в 250 мс — меньше перерисовок, плеер не тормозит на активных чатах
  function push(msg) {
    Chat.queue.push(msg);
    if (Chat.queue.length > MAX_LINES) Chat.queue.splice(0, Chat.queue.length - MAX_LINES);
    if (!Chat.flushTimer) Chat.flushTimer = setTimeout(flush, 250);
  }

  function flush() {
    Chat.flushTimer = null;
    if (!Chat.active || Chat.el.classList.contains('hidden')) { Chat.queue = []; return; }
    var frag = document.createDocumentFragment();
    Chat.queue.forEach(function (m) { frag.appendChild(render(m)); });
    Chat.queue = [];
    Chat.list.appendChild(frag);
    var extra = Chat.list.children.length - MAX_LINES;
    while (extra-- > 0) Chat.list.removeChild(Chat.list.firstChild);
  }

  // Системные строки идут через ту же очередь, чтобы не обгонять сообщения
  Chat.system = function (text, cls) {
    if (!Chat.active) return;
    push({ system: text, cls: cls });
  };

  function color(nick, c) {
    if (c) return c;
    var s = 0;
    for (var i = 0; i < nick.length; i++) s += nick.charCodeAt(i);
    return DEFAULT_COLORS[s % DEFAULT_COLORS.length];
  }

  function emoteImg(url, name) {
    return '<img class="emote" src="' + url + '" alt="' + U.esc(name) + '">';
  }

  function render(m) {
    if (m.system) return h('div.chat-line.chat-system' + (m.cls ? '.' + m.cls : ''), { text: m.system });
    var chars = Array.from ? Array.from(m.text) : m.text.split('');
    var ranges = [];
    if (m.emotes) {
      m.emotes.split('/').forEach(function (e) {
        var p = e.split(':');
        if (p.length < 2) return;
        p[1].split(',').forEach(function (r) {
          var se = r.split('-');
          ranges.push({ id: p[0], s: +se[0], e: +se[1] });
        });
      });
      ranges.sort(function (a, b) { return a.s - b.s; });
    }
    var html = '', pos = 0;
    ranges.forEach(function (r) {
      if (r.s < pos) return;
      html += words(chars.slice(pos, r.s).join(''));
      html += emoteImg('https://static-cdn.jtvnw.net/emoticons/v2/' + r.id + '/default/dark/1.0', chars.slice(r.s, r.e + 1).join(''));
      pos = r.e + 1;
    });
    html += words(chars.slice(pos).join(''));

    var badges = '';
    if (m.badges) {
      if (m.badges.indexOf('broadcaster') >= 0) badges += '<span class="cb cb-host">●</span>';
      else if (m.badges.indexOf('moderator') >= 0) badges += '<span class="cb cb-mod">⚔</span>';
      else if (m.badges.indexOf('vip') >= 0) badges += '<span class="cb cb-vip">◆</span>';
      if (m.badges.indexOf('subscriber') >= 0) badges += '<span class="cb cb-sub">★</span>';
    }
    var c = color(m.nick, m.color);
    var line = document.createElement('div');
    line.className = 'chat-line' + (m.action ? ' action' : '');
    line.innerHTML = badges + '<span class="chat-nick" style="color:' + U.esc(c) + '">' + U.esc(m.nick) + '</span>' +
      (m.action ? ' ' : '<span class="chat-colon">: </span>') +
      '<span class="chat-text"' + (m.action ? ' style="color:' + U.esc(c) + '"' : '') + '>' + html + '</span>';
    return line;
  }

  // Текст: экранируем и подставляем эмоуты 7TV/BTTV/FFZ по словам
  function words(s) {
    if (!s) return '';
    return s.split(' ').map(function (w) {
      var e = Chat.emotes[w] || (Chat.globalEmotes && Chat.globalEmotes[w]);
      return e ? emoteImg(e, w) : U.esc(w);
    }).join(' ');
  }

  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  // Сторонние эмоуты — как в расширениях, которыми пользуется большинство зрителей Twitch
  var globalLoaded = false;
  function loadThirdPartyEmotes(roomId) {
    var add = function (name, url) { if (name && url && !Chat.emotes[name]) Chat.emotes[name] = url; };
    if (!globalLoaded) {
      globalLoaded = true;
      Chat.globalEmotes = {};
      getJSON('https://api.betterttv.net/3/cached/emotes/global').then(function (l) {
        l.forEach(function (e) { Chat.globalEmotes[e.code] = 'https://cdn.betterttv.net/emote/' + e.id + '/1x'; });
      }).catch(function () {});
      getJSON('https://7tv.io/v3/emote-sets/global').then(function (s) {
        (s.emotes || []).forEach(function (e) { Chat.globalEmotes[e.name] = 'https://cdn.7tv.app/emote/' + e.id + '/1x.webp'; });
      }).catch(function () {});
    }
    if (!roomId) return;
    getJSON('https://api.betterttv.net/3/cached/users/twitch/' + roomId).then(function (d) {
      [].concat(d.channelEmotes || [], d.sharedEmotes || []).forEach(function (e) { add(e.code, 'https://cdn.betterttv.net/emote/' + e.id + '/1x'); });
    }).catch(function () {});
    getJSON('https://7tv.io/v3/users/twitch/' + roomId).then(function (d) {
      var set = d.emote_set && d.emote_set.emotes;
      (set || []).forEach(function (e) { add(e.name, 'https://cdn.7tv.app/emote/' + e.id + '/1x.webp'); });
    }).catch(function () {});
    getJSON('https://api.frankerfacez.com/v1/room/id/' + roomId).then(function (d) {
      var sets = d.sets || {};
      Object.keys(sets).forEach(function (k) {
        (sets[k].emoticons || []).forEach(function (e) { add(e.name, e.urls && (e.urls['1'] || e.urls[1])); });
      });
    }).catch(function () {});
  }

  window.Chat = Chat;
})();
