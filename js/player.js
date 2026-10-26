/* Плеер: hls.js с настройками под ТВ + сторожевой таймер от зависаний, OSD как в YouTube TV */
(function () {
  'use strict';
  var h = U.h;

  var P = {
    el: null, video: null, hls: null, item: null, playlist: null, index: -1,
    loadId: 0, osdTimer: null, osdVisible: false, stall: 0, lastTime: -1,
    netRetries: 0, mediaRetries: 0, reloads: 0, userPaused: false, pausedAt: 0,
    seekTarget: null, seekTimer: null, metaTimer: null, levels: [], clipSources: null
  };

  var $ = function (s) { return U.$(s, P.el); };

  P.init = function () {
    P.el = U.$('#player');
    P.video = U.$('#video');
    var v = P.video;
    v.addEventListener('playing', function () { spinner(false); message(null); P.stall = 0; });
    v.addEventListener('waiting', function () { spinner(true); });
    v.addEventListener('pause', updatePlayIcon);
    v.addEventListener('play', updatePlayIcon);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', function () {
      if (P.item && P.item.kind !== 'live') { saveVodPos(true); showOSD(true); }
    });
    v.addEventListener('error', function () {
      if (!P.hls && P.item) recover('Ошибка видео');
    });
    setInterval(watchdog, 1000);
  };

  // ---------- открыть / закрыть ----------

  // item: {kind:'live'|'vod'|'clip', login, id, slug, title, name, avatar, game, viewers, createdAt, length, roomId}
  P.open = function (item, playlist) {
    P.playlist = playlist || [item];
    P.index = Math.max(0, P.playlist.indexOf(item));
    if (!P.isOpen()) {
      P.el.classList.remove('hidden');
      App.openLayer({ el: P.el, inPlace: true, onKey: onKey, onClose: teardown, focus: null, noScope: true });
    }
    start(item);
  };

  P.isOpen = function () { return !P.el.classList.contains('hidden'); };

  P.close = function () { App.closeLayer(); };

  function teardown() {
    P.loadId++;
    saveVodPos();
    destroyHls();
    try { P.video.pause(); P.video.removeAttribute('src'); P.video.load(); } catch (e) { /* ignore */ }
    Chat.stop();
    clearInterval(P.metaTimer);
    clearTimeout(P.osdTimer);
    P.osdVisible = false;
    P.el.classList.remove('osd-on');
    P.el.classList.add('hidden');
    P.item = null;
    closePanel();
  }

  function start(item) {
    saveVodPos();
    P.item = item;
    P.netRetries = 0; P.mediaRetries = 0; P.reloads = 0; P.stall = 0; P.userPaused = false;
    P.seekTarget = null;
    P.levels = [];
    message(null);
    renderMeta();
    buildControls();
    setChat(item.kind === 'live' && Settings.get('chat') === 'on');
    clearInterval(P.metaTimer);
    if (item.kind === 'live') {
      refreshMeta();
      P.metaTimer = setInterval(refreshMeta, 60000);
    }
    showOSD();
    load();
  }

  function load() {
    var id = ++P.loadId;
    var it = P.item;
    P.stall = 0;
    P.failed = false;
    spinner(true);
    destroyHls();
    var pt = Settings.get('playerType');
    var p;
    if (it.kind === 'live') p = Twitch.liveUrl(it.login, pt);
    else if (it.kind === 'vod') p = Twitch.vodUrl(it.id, pt);
    else p = Twitch.clipSources(it.slug).then(function (list) { P.clipSources = list; return pickClip(list).url; });
    p.then(function (url) {
      if (id !== P.loadId) return;
      attach(url, id);
    }, function (e) {
      if (id !== P.loadId) return;
      spinner(false);
      var offline = it.kind === 'live';
      message(offline ? (it.name || it.login) + ' сейчас не в сети' : 'Не удалось открыть видео', (e && e.message) || '');
      if (offline) checkOffline();
    });
  }

  function checkOffline() {
    var it = P.item, id = P.loadId;
    Twitch.user(it.login).then(function (u) {
      if (P.item !== it || P.loadId !== id) return;
      if (u && u.stream && P.reloads++ < 3) {
        message('Сбой загрузки — повтор…');
        setTimeout(function () { if (P.item === it && P.loadId === id) load(); }, 3000);
      } else if (u && u.stream) {
        message('Не удаётся загрузить эфир', 'Нажмите OK для повтора или синюю кнопку для перезагрузки.');
        P.failed = true;
      } else {
        message((it.name || it.login) + ' сейчас не в сети', 'Нажмите «Назад», чтобы выбрать другой канал. Кнопки CH+/CH− — переключение каналов.');
      }
    }).catch(function () { /* оставляем сообщение как есть */ });
  }

  function hlsConfig(kind, startPos) {
    var lat = { low: 2, normal: 3, stable: 5 }[Settings.get('latency')] || 3;
    var live = kind === 'live';
    return {
      debug: false,
      enableWorker: true,
      lowLatencyMode: false,
      // Память ТВ ограничена — держим умеренный буфер, чтобы не ловить QuotaExceeded и подлагивания
      backBufferLength: live ? 10 : 30,
      maxBufferLength: live ? 30 : 45,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 10,
      liveSyncDurationCount: lat,
      liveMaxLatencyDurationCount: lat + 8,
      liveDurationInfinity: true,
      startFragPrefetch: true,
      startPosition: startPos > 0 ? startPos : -1,
      // ABR: осторожно повышаем качество, быстро понижаем, учитываем пропуск кадров декодером
      abrEwmaDefaultEstimate: 5000000,
      abrBandWidthFactor: 0.9,
      abrBandWidthUpFactor: 0.6,
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      capLevelOnFPSDrop: true,
      capLevelToPlayerSize: false,
      testBandwidth: true,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 6,
      levelLoadingRetryDelay: 1000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 500,
      appendErrorMaxRetry: 5
    };
  }

  function attach(url, id) {
    var v = P.video;
    var kind = P.item.kind;
    if (kind !== 'clip' && window.Hls && Hls.isSupported() && Settings.get('engine') !== 'native') {
      var saved = kind === 'vod' ? U.store.get('vodpos', {})[P.item.id] : 0;
      if (saved && P.item.length && saved > P.item.length - 30) saved = 0;
      var hls = new Hls(hlsConfig(kind, saved));
      P.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (id !== P.loadId) return;
        P.levels = hls.levels.map(function (l, i) { return { index: i, label: levelLabel(l, i === hls.levels.length - 1), height: l.height || 0, fps: l.frameRate || 0 }; });
        applyQuality();
        play();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, function () { updateQualityLabel(); });
      hls.on(Hls.Events.FRAG_BUFFERED, function () { P.netRetries = 0; });
      hls.on(Hls.Events.ERROR, function (ev, d) { onHlsError(d, id); });
      hls.attachMedia(v);
      hls.loadSource(url);
    } else {
      v.src = url;
      if (kind === 'vod') {
        var pos2 = U.store.get('vodpos', {})[P.item.id];
        if (pos2) v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); v.currentTime = pos2; });
      }
      play();
    }
  }

  function levelLabel(l, isTop) {
    if (!l.height) return 'Только звук';
    var fps = l.frameRate || 0;
    var s = l.height + 'p' + (fps >= 49 ? Math.round(fps / 10) * 10 : '');
    if ((l.attrs && l.attrs.VIDEO === 'chunked') || isTop) s += ' (источник)';
    return s;
  }

  // Предпочтение качества из настроек: 'auto' или '720p60' и т.п. Берём лучшее, что не выше.
  function prefIndex(levels, pref) {
    if (!pref || pref === 'auto') return -1;
    var m = /^(\d+)p(\d+)?/.exec(pref);
    if (!m) return -1;
    var hgt = +m[1], fps = +(m[2] || 30);
    var best = -1, bestScore = -1;
    levels.forEach(function (l, i) {
      var lh = l.height || 0, lf = l.frameRate || l.fps || 30;
      if (!lh || lh > hgt || (lh === hgt && lf > fps + 5)) return;
      var score = lh * 1000 + lf;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  function applyQuality() {
    if (!P.hls) return;
    var idx = prefIndex(P.hls.levels, Settings.get('quality'));
    if (idx >= 0) { P.hls.currentLevel = idx; }
    else {
      P.hls.currentLevel = -1;
      // для «Авто» не даём ABR уйти выше 1080p
      var cap = -1;
      P.hls.levels.forEach(function (l, i) { if (l.height && l.height <= 1080) cap = i; });
      P.hls.autoLevelCapping = cap;
    }
    updateQualityLabel();
  }

  function pickClip(list) {
    var pref = Settings.get('quality');
    var idx = prefIndex(list.map(function (c) { return { height: c.quality, frameRate: c.fps }; }), pref);
    return list[idx >= 0 ? idx : 0];
  }

  function onHlsError(d, id) {
    if (id !== P.loadId || !d.fatal) return;
    var hls = P.hls;
    var code = d.response && d.response.code;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (d.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR && (code === 404 || code === 403)) {
        // 404 — эфир закончился, 403 — истёк токен: пробуем получить новый
        if (code === 403 && P.reloads++ < 2) return load();
        destroyHls();
        spinner(false);
        if (P.item.kind === 'live') { message((P.item.name || P.item.login) + ' сейчас не в сети'); checkOffline(); }
        else message('Видео недоступно', 'Возможно, оно только для подписчиков');
        return;
      }
      if (P.netRetries++ < 6) {
        spinner(true);
        setTimeout(function () { if (id === P.loadId && P.hls === hls) hls.startLoad(); }, 1000 * P.netRetries);
      } else recover('Проблемы с сетью');
    } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
      if (P.mediaRetries++ < 3) {
        if (P.mediaRetries === 2) hls.swapAudioCodec();
        hls.recoverMediaError();
      } else recover('Ошибка декодирования');
    } else recover('Ошибка воспроизведения');
  }

  // Полная переинициализация (новый токен, новый плейлист). Для записей — с той же позиции.
  function recover(reason) {
    if (!P.item) return;
    if (P.reloads++ > 6) {
      spinner(false);
      message('Не удаётся воспроизвести', reason + '. Нажмите OK для повтора.');
      P.failed = true;
      return;
    }
    if (P.item.kind === 'vod' && P.video.currentTime > 5) {
      var all = U.store.get('vodpos', {});
      all[P.item.id] = Math.floor(P.video.currentTime);
      U.store.set('vodpos', all);
    }
    load();
  }

  function destroyHls() {
    if (P.hls) {
      try { P.hls.destroy(); } catch (e) { /* ignore */ }
      P.hls = null;
    }
  }

  function play() {
    var pr = P.video.play();
    if (pr && pr.catch) pr.catch(function () { /* автозапуск может быть отклонён — повторит сторож */ });
  }

  // Сторож: если картинка стоит, а пользователь не ставил паузу — лечим по нарастающей
  function watchdog() {
    if (!P.item || P.userPaused || P.failed) return;
    var v = P.video;
    if (P.loadId && !v.src && !P.hls) return;
    var t = v.currentTime;
    if (v.paused && v.readyState >= 3 && !v.ended) { play(); }
    if (Math.abs(t - P.lastTime) < 0.01 && !v.ended) P.stall++;
    else { P.stall = 0; spinner(false); }
    P.lastTime = t;

    if (P.stall === 4) {
      spinner(true);
      // пробуем перепрыгнуть дыру в буфере или догнать «прямой эфир»
      var b = v.buffered;
      for (var i = 0; i < b.length; i++) {
        if (b.start(i) > t && b.start(i) - t < 3) { v.currentTime = b.start(i) + 0.1; return; }
      }
      if (P.hls && P.item.kind === 'live' && P.hls.liveSyncPosition) v.currentTime = P.hls.liveSyncPosition;
      else if (P.hls) P.hls.startLoad();
    } else if (P.stall === 9 && P.hls) {
      P.hls.recoverMediaError();
    } else if (P.stall === 16) {
      P.stall = 0;
      recover('Зависание потока');
    }
  }

  function onTime() {
    if (P.osdVisible) updateProgress();
    if (P.item && P.item.kind === 'vod' && Math.floor(P.video.currentTime) % 15 === 0) saveVodPos();
  }

  function saveVodPos(ended) {
    var it = P.item;
    if (!it || it.kind !== 'vod') return;
    var t = P.video.currentTime;
    if (!t || t < 10) return;
    var all = U.store.get('vodpos', {});
    if (ended || (it.length && t > it.length - 20)) delete all[it.id];
    else all[it.id] = Math.floor(t);
    var keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]];
    U.store.set('vodpos', all);
  }

  // ---------- мета ----------

  function renderMeta() {
    var it = P.item;
    $('.osd-avatar').src = it.avatar || '';
    $('.osd-avatar').style.visibility = it.avatar ? '' : 'hidden';
    $('.osd-title').textContent = it.title || it.name || it.login || '';
    var sub = [it.name || it.login];
    if (it.game) sub.push(it.game);
    if (it.kind === 'live' && it.viewers) sub.push(U.viewers(it.viewers));
    if (it.kind !== 'live' && it.views) sub.push(U.views(it.views));
    if (it.kind !== 'live' && it.createdAt) sub.push(U.ago(it.createdAt));
    $('.osd-sub').textContent = sub.join(' • ');
    P.el.classList.toggle('is-live', it.kind === 'live');
  }

  function refreshMeta() {
    var it = P.item;
    if (!it || it.kind !== 'live') return;
    Twitch.user(it.login).then(function (u) {
      if (P.item !== it || !u) return;
      it.name = u.displayName;
      it.avatar = it.avatar || u.profileImageURL;
      it.roomId = u.id;
      if (u.stream) {
        it.title = u.stream.title;
        it.viewers = u.stream.viewersCount;
        it.createdAt = u.stream.createdAt;
        it.game = u.stream.game ? (u.stream.game.displayName || u.stream.game.name) : '';
      }
      renderMeta();
      if (Chat.active && !Chat.roomId) Chat.roomId = u.id;
    }).catch(function () { /* не критично */ });
  }

  // ---------- OSD ----------

  function ctrl(icon, label, fn, cls) {
    var b = h('div.ctl.focusable' + (cls ? '.' + cls : ''), { html: UI.icon(icon) + '<span class="ctl-label">' + U.esc(label) + '</span>' });
    b._onclick = fn;
    return b;
  }

  function buildControls() {
    var box = $('.osd-controls');
    box.innerHTML = '';
    box.setAttribute('data-group', 'osd');
    var it = P.item;
    var list = [];
    if (it.kind !== 'live') list.push(ctrl('replay10', 'Назад 10 с', function () { seekBy(-10); }));
    list.push(ctrl('pause', 'Пауза', togglePlay, 'ctl-play'));
    if (it.kind !== 'live') list.push(ctrl('forward10', 'Вперёд 10 с', function () { seekBy(10); }));
    if (it.kind === 'live') list.push(ctrl('refresh', 'Обновить', function () { P.reloads = 0; P.failed = false; load(); UI.toast('Перезагрузка потока'); }));
    list.push(ctrl('hd', 'Качество', qualityMenu, 'ctl-quality'));
    if (it.kind === 'live') list.push(ctrl('chat', 'Чат', function () { setChat(Chat.el.classList.contains('hidden')); }, 'ctl-chat'));
    list.push(ctrl(App.isFav(it.login) ? 'following' : 'heartOutline', App.isFav(it.login) ? 'В избранном' : 'В избранное', toggleFav, 'ctl-fav'));
    if (P.playlist && P.playlist.length > 1) {
      list.push(ctrl('prev', 'Предыдущий', function () { zap(-1); }));
      list.push(ctrl('next', 'Следующий', function () { zap(1); }));
    }
    list.push(ctrl('person', 'Канал', function () { var login = it.login; P.close(); App.go('channel', { login: login }); }));
    list.forEach(function (b) { box.appendChild(b); });
    var bar = $('.osd-bar');
    bar.classList.toggle('focusable', it.kind !== 'live');
    bar.setAttribute('data-nav-down', '.ctl-play');
    updatePlayIcon();
    updateQualityLabel();
  }

  function updatePlayIcon() {
    var b = $('.ctl-play');
    if (!b) return;
    var paused = P.video.paused && P.userPaused;
    b.innerHTML = UI.icon(paused ? 'play' : 'pause') + '<span class="ctl-label">' + (paused ? 'Смотреть' : 'Пауза') + '</span>';
  }

  function updateQualityLabel() {
    var b = $('.ctl-quality .ctl-label');
    if (!b) return;
    var txt = 'Качество';
    if (P.hls && P.hls.currentLevel >= 0 && P.levels[P.hls.currentLevel]) {
      txt = (P.hls.autoLevelEnabled ? 'Авто • ' : '') + P.levels[P.hls.currentLevel].label.replace(' (источник)', '');
    }
    b.textContent = txt;
  }

  function showOSD(stay) {
    P.osdVisible = true;
    P.el.classList.add('osd-on');
    $('.osd-clock').textContent = U.clock();
    updateProgress();
    if (!Nav.current || !P.el.contains(Nav.current)) {
      Nav.setScope(U.$('.player-osd', P.el));
      Nav.focus($('.ctl-play'));
    }
    clearTimeout(P.osdTimer);
    if (!stay) P.osdTimer = setTimeout(hideOSD, 5000);
  }

  function hideOSD() {
    if (P.seekTarget !== null) { P.osdTimer = setTimeout(hideOSD, 2000); return; }
    if (P.userPaused) return; // на паузе OSD остаётся, как в YouTube
    if (App.topLayer() && App.topLayer().el !== P.el) { P.osdTimer = setTimeout(hideOSD, 2000); return; }
    P.osdVisible = false;
    P.el.classList.remove('osd-on');
    if (Nav.current && P.el.contains(Nav.current)) Nav.blur();
  }

  function updateProgress() {
    var v = P.video, it = P.item;
    if (!it) return;
    if (it.kind === 'live') {
      $('.osd-time-cur').textContent = it.createdAt ? U.uptime(it.createdAt) : '';
      $('.osd-time-dur').textContent = '';
      $('.osd-bar-fill').style.width = '100%';
      $('.osd-bar-buf').style.width = '100%';
      $('.osd-bar-knob').style.left = '100%';
      return;
    }
    var dur = v.duration && isFinite(v.duration) ? v.duration : (it.length || 0);
    var cur = P.seekTarget !== null ? P.seekTarget : v.currentTime;
    var pct = dur ? Math.min(100, cur / dur * 100) : 0;
    var buf = 0;
    for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) buf = v.buffered.end(i);
    $('.osd-time-cur').textContent = U.duration(cur);
    $('.osd-time-dur').textContent = U.duration(dur);
    $('.osd-bar-fill').style.width = pct + '%';
    $('.osd-bar-knob').style.left = pct + '%';
    $('.osd-bar-buf').style.width = (dur ? Math.min(100, buf / dur * 100) : 0) + '%';
  }

  function togglePlay() {
    var v = P.video;
    if (P.failed) { P.failed = false; P.reloads = 0; load(); return; }
    if (v.paused) {
      P.userPaused = false;
      // как на Twitch: после долгой паузы в прямом эфире возвращаемся к «живой» точке
      if (P.item.kind === 'live' && P.hls && P.hls.liveSyncPosition && v.currentTime < P.hls.liveSyncPosition - 15) {
        v.currentTime = P.hls.liveSyncPosition;
      }
      if (P.item.kind === 'live' && Date.now() - P.pausedAt > 90000 && P.pausedAt) { P.pausedAt = 0; load(); }
      else play();
      showOSD();
    } else {
      P.userPaused = true;
      P.pausedAt = Date.now();
      v.pause();
      showOSD(true);
    }
    updatePlayIcon();
  }

  function seekBy(sec) {
    if (!P.item || P.item.kind === 'live') return;
    var v = P.video;
    var dur = v.duration && isFinite(v.duration) ? v.duration : (P.item.length || 0);
    var base = P.seekTarget !== null ? P.seekTarget : v.currentTime;
    P.seekTarget = Math.max(0, Math.min(dur ? dur - 1 : base + sec, base + sec));
    updateProgress();
    clearTimeout(P.seekTimer);
    P.seekTimer = setTimeout(function () {
      if (P.seekTarget !== null) { v.currentTime = P.seekTarget; P.seekTarget = null; saveVodPos(); }
    }, 700);
    showOSD();
  }

  // Ускоряющаяся перемотка при удержании кнопки
  var seekRepeat = 0, seekRepeatT = 0;
  function seekStep(dir) {
    var now = Date.now();
    seekRepeat = now - seekRepeatT < 400 ? seekRepeat + 1 : 0;
    seekRepeatT = now;
    var step = seekRepeat < 4 ? 10 : seekRepeat < 10 ? 30 : seekRepeat < 20 ? 60 : 180;
    seekBy(dir * step);
  }

  // ---------- панели ----------

  function qualityMenu() {
    var items = [];
    var pref = Settings.get('quality');
    if (P.item.kind === 'clip') {
      var cur = pickClip(P.clipSources || []);
      (P.clipSources || []).forEach(function (c) {
        items.push({ label: c.quality + 'p' + (c.fps >= 50 ? c.fps : ''), selected: c === cur, onSelect: function () {
          Settings.set('quality', c.quality + 'p' + (c.fps >= 50 ? c.fps : ''));
          var t = P.video.currentTime; P.video.src = c.url; P.video.currentTime = t; play();
        } });
      });
    } else {
      var auto = !P.hls || P.hls.autoLevelEnabled;
      var curLabel = P.hls && P.levels[P.hls.currentLevel] ? P.levels[P.hls.currentLevel].label : '';
      items.push({ label: 'Авто', sub: auto && curLabel ? 'Сейчас: ' + curLabel : 'Подбирается по скорости сети', selected: auto, onSelect: function () { Settings.set('quality', 'auto'); applyQuality(); } });
      P.levels.slice().reverse().forEach(function (l) {
        if (!l.height) return;
        items.push({ label: l.label, selected: !auto && P.hls.currentLevel === l.index, onSelect: function () {
          Settings.set('quality', l.height + 'p' + (l.fps >= 49 ? Math.round(l.fps / 10) * 10 : ''));
          P.hls.currentLevel = l.index;
          updateQualityLabel();
        } });
      });
    }
    if (!items.length) { UI.toast('Качество ещё не загружено'); return; }
    UI.menu('Качество', items, { cls: 'menu-right' });
  }

  function closePanel() { /* панель резерв под будущее */ }

  function setChat(on) {
    var it = P.item;
    if (on && it && it.kind === 'live') {
      Chat.el.classList.remove('hidden');
      Chat.el.classList.toggle('overlay-mode', Settings.get('chatMode') === 'overlay');
      P.el.classList.toggle('chat-side', Settings.get('chatMode') !== 'overlay');
      Chat.start(it.login, it.roomId);
    } else {
      Chat.el.classList.add('hidden');
      P.el.classList.remove('chat-side');
      Chat.stop();
    }
    var b = $('.ctl-chat .ctl-label');
    if (b) b.textContent = on ? 'Скрыть чат' : 'Чат';
  }

  function toggleFav() {
    var it = P.item;
    var on = App.toggleFav(it.login);
    var b = $('.ctl-fav');
    if (b) b.innerHTML = UI.icon(on ? 'following' : 'heartOutline') + '<span class="ctl-label">' + (on ? 'В избранном' : 'В избранное') + '</span>';
  }

  function zap(dir) {
    if (!P.playlist || P.playlist.length < 2) return;
    P.index = (P.index + dir + P.playlist.length) % P.playlist.length;
    var next = P.playlist[P.index];
    var z = $('.player-zap');
    z.textContent = (P.index + 1) + '/' + P.playlist.length + '  ' + (next.name || next.login) + (next.title ? ' — ' + next.title : '');
    z.classList.remove('hidden');
    clearTimeout(z._t);
    z._t = setTimeout(function () { z.classList.add('hidden'); }, 3000);
    start(next);
  }

  function spinner(on) { $('.player-spinner').classList.toggle('hidden', !on); }

  function message(title, sub) {
    var m = $('.player-message');
    if (!title) { m.classList.add('hidden'); m.textContent = ''; P.failed = false; return; }
    m.innerHTML = '<div class="pm-title">' + U.esc(title) + '</div>' + (sub ? '<div class="pm-sub">' + U.esc(sub) + '</div>' : '');
    m.classList.remove('hidden');
  }

  // ---------- клавиши ----------

  function onKey(k) {
    var it = P.item;
    if (!it) return false;
    switch (k) {
      case 'PLAYPAUSE': togglePlay(); return true;
      case 'PLAY': if (P.video.paused) togglePlay(); return true;
      case 'PAUSE': if (!P.video.paused) togglePlay(); return true;
      case 'STOP': P.close(); return true;
      case 'FF': seekStep(1); return true;
      case 'RW': seekStep(-1); return true;
      case 'CH_UP': zap(1); return true;
      case 'CH_DOWN': zap(-1); return true;
      case 'GREEN': if (it.kind === 'live') setChat(Chat.el.classList.contains('hidden')); return true;
      case 'RED': qualityMenu(); return true;
      case 'YELLOW': toggleFav(); return true;
      case 'BLUE': P.reloads = 0; load(); return true;
      case 'INFO': showOSD(); return true;
    }
    if (!P.osdVisible) {
      if (k === 'BACK') { P.close(); return true; }
      if ((k === 'LEFT' || k === 'RIGHT') && it.kind !== 'live') {
        showOSD();
        Nav.focus($('.osd-bar'));
        seekStep(k === 'LEFT' ? -1 : 1);
        return true;
      }
      if (P.failed && k === 'ENTER') { togglePlay(); return true; }
      showOSD();
      return true;
    }
    // OSD видим
    showOSD(P.userPaused);
    if (k === 'BACK') {
      if (P.userPaused) { P.close(); return true; }
      hideOSD();
      return true;
    }
    var onBar = Nav.current && Nav.current.classList.contains('osd-bar');
    if (onBar && (k === 'LEFT' || k === 'RIGHT')) { seekStep(k === 'LEFT' ? -1 : 1); return true; }
    if (onBar && k === 'ENTER') { togglePlay(); return true; }
    if (k === 'UP' && !onBar && it.kind === 'live') return true;
    return false; // остальное — стандартная навигация по кнопкам
  }

  P.hideOSD = hideOSD;
  window.Player = P;
})();
