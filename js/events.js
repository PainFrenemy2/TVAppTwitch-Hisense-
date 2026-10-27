/* Прогнозы (ставки баллами канала) и голосования во время эфира — как на twitch.tv.
   Раз в 30 секунд спрашиваем Twitch, идёт ли сейчас прогноз/голосование; о новом — всплывающая подсказка
   (отключается в настройках), а в правом верхнем углу видео — значок события; «Вверх» или OK на подсказке
   открывает окно. Для участия нужен вход в Twitch. Закончившееся событие ещё минуту показывает итог. */
(function () {
  'use strict';
  var h = U.h;

  var PRED = 'id title status predictionWindowSeconds createdAt outcomes{id title color totalPoints totalUsers} winningOutcome{id}';
  var PRED_TOP = PRED.replace('totalUsers}', 'totalUsers topPredictors{points}}');
  var KEEP_ENDED = 60000;

  var Ev = { login: null, timer: null, prediction: null, poll: null, balance: null, seen: {}, banner: null, bannerTimer: null };
  var noTop = false; // Twitch не знает поля topPredictors — больше не спрашиваем

  function anon(query, vars) { return Twitch.gqlRaw(query, vars); }
  function asUser(query, vars) { return Auth.loggedIn() && !Auth.needsLogin() ? Auth.gql(query, vars) : anon(query, vars); }

  function loadPrediction(login) {
    var q = function (fields) { return 'query($login:String!){user(login:$login){id channel{id activePredictionEvents{' + fields + '} lockedPredictionEvents{' + fields + '}}}}'; };
    // с крупнейшими ставками, а если Twitch не знает этого поля — без них (и запоминаем это)
    var first = noTop ? asUser(q(PRED), { login: login }) : asUser(q(PRED_TOP), { login: login }).catch(function (e) {
      // без крупнейших ставок — только если Twitch действительно не знает это поле, а не из-за сбоя сети
      if (!/topPredictors/.test((e && e.message) || '')) throw e;
      noTop = true;
      return asUser(q(PRED), { login: login });
    });
    return first.then(function (d) {
      var ch = d && d.user && d.user.channel;
      if (!ch) return null;
      var list = [].concat(ch.activePredictionEvents || [], ch.lockedPredictionEvents || []);
      return list[0] || null;
    });
  }

  // Закончившийся прогноз пропадает из активных — один раз спрашиваем итоговые, чтобы показать победителя
  function loadResolved(login, id) {
    return asUser('query($login:String!){user(login:$login){channel{resolvedPredictionEvents(first:3){edges{node{' + PRED + '}}}}}}', { login: login })
      .then(function (d) {
        var c = d && d.user && d.user.channel, conn = c && c.resolvedPredictionEvents;
        var list = conn && conn.edges ? conn.edges.map(function (e) { return e.node; }) : [];
        return list.filter(function (p) { return p && p.id === id; })[0] || null;
      }).catch(function () { return null; });
  }

  function loadPoll(login) {
    return asUser('query($login:String!){channel(name:$login){id viewablePoll{id title status remainingDurationMilliseconds choices{id title votes{total}} votes{total}}}}', { login: login })
      .then(function (d) { return (d && d.channel && d.channel.viewablePoll) || null; });
  }

  // Баллы канала и сундучок с бонусом (как на twitch.tv: «Нажмите, чтобы получить бонус»).
  // Бонус забираем сами (настройка «Автосбор бонусных баллов»), в углу плеера мелькает «+50».
  function loadPoints(login) {
    if (!Auth.loggedIn() || Auth.needsLogin()) return Promise.resolve(null);
    return Auth.gql('query($login:String!){user(login:$login){channel{id self{communityPoints{balance availableClaim{id}}}}}}', { login: login }).then(function (d) {
      var c = d && d.user && d.user.channel, cp = c && c.self && c.self.communityPoints;
      return cp ? { channelID: c.id, balance: cp.balance, claim: cp.availableClaim && cp.availableClaim.id } : null;
    });
  }
  function claimBonus(login, pts) {
    Auth.gql('mutation($input:ClaimCommunityPointsInput!){claimCommunityPoints(input:$input){currentPoints error{code}}}',
      { input: { channelID: pts.channelID, claimID: pts.claim } }).then(function (d) {
      var r = d && d.claimCommunityPoints;
      if (!r || r.error || Ev.login !== login) return;
      var before = Ev.balance;
      if (typeof r.currentPoints === 'number') Ev.balance = r.currentPoints;
      flashCorner(typeof before === 'number' && Ev.balance > before ? '+' + U.num(Ev.balance - before) : '+');
    }).catch(function () {});
  }

  function loadBalance(login) {
    if (!Auth.loggedIn() || Auth.needsLogin()) return Promise.resolve(null);
    return Auth.gql('query($login:String!){user(login:$login){channel{self{communityPoints{balance}}}}}', { login: login }).then(function (d) {
      var c = d && d.user && d.user.channel;
      return c && c.self && c.self.communityPoints ? c.self.communityPoints.balance : null;
    }).catch(function () { return null; });
  }

  // Новое состояние события с учётом прошлого: закончившееся (пропало из ответа или не ACTIVE)
  // держим минуту с итогом; у голосования сохраняем момент окончания, чтобы таймер не прыгал.
  function mergePrediction(prev, next) {
    if (next) return next;
    if (!prev) return null;
    if (!prev._endedAt) {
      prev._endedAt = Date.now();
      if (prev.status === 'ACTIVE' || prev.status === 'LOCKED') prev.status = 'ENDED';
      var login = Ev.login;
      loadResolved(login, prev.id).then(function (res) {
        if (!res || Ev.login !== login || !Ev.prediction || Ev.prediction.id !== res.id) return;
        res._endedAt = prev._endedAt;
        Ev.prediction = res;
        if (panel && panel.kind === 'prediction') panel.update();
      });
    }
    return Date.now() - prev._endedAt < KEEP_ENDED ? prev : null;
  }
  // голосования, итог которых уже показали минуту, — больше не возвращаем, даже если Twitch их ещё отдаёт
  var pollsDone = {};
  function mergePoll(prev, next) {
    if (next && pollsDone[next.id]) return null;
    if (next && next.status === 'ACTIVE') {
      next._endAt = prev && prev.id === next.id && prev._endAt ? prev._endAt
        : (next.remainingDurationMilliseconds ? Date.now() + next.remainingDurationMilliseconds : 0);
      return next;
    }
    var ended = next || prev;
    if (!ended) return null;
    if (prev && prev.id === ended.id && prev._endedAt) ended._endedAt = prev._endedAt;
    ended._endedAt = ended._endedAt || Date.now();
    ended._endAt = 0;
    if (ended.status === 'ACTIVE') ended.status = 'COMPLETED';
    if (Date.now() - ended._endedAt < KEEP_ENDED) return ended;
    pollsDone[ended.id] = 1;
    return null;
  }

  Ev.start = function (login) {
    if (Ev.seenFor !== login) { Ev.seen = {}; pollsDone = {}; Ev.seenFor = login; } // о старых событиях другого канала не помним
    Ev.stop();
    Ev.login = login;
    check();
    Ev.timer = setInterval(check, 30000);
  };

  Ev.stop = function () {
    closePanelLayer();
    clearInterval(Ev.timer);
    Ev.timer = null;
    Ev.login = null;
    Ev.prediction = null;
    Ev.poll = null;
    Ev.balance = null;
    hideBanner();
    removeCorner();
  };

  // какой канал сейчас проверяем: при переключении канала новая проверка не ждёт старую
  var checking = null;
  function check() {
    var login = Ev.login;
    // ТВ свернул приложение или запрос по этому каналу ещё идёт — не дёргаем Twitch впустую
    if (!login || document.hidden || Player.bgPaused || checking === login) return;
    checking = login;
    Promise.all([loadPrediction(login).catch(function () { return undefined; }), loadPoll(login).catch(function () { return undefined; }),
      loadPoints(login).catch(function () { return null; })]).then(function (r) {
      if (checking === login) checking = null;
      if (Ev.login !== login) return;
      var pts = r[2];
      if (pts) {
        Ev.balance = pts.balance;
        if (pts.claim && Settings.get('autoClaim') !== 'off' && Ev.claimed !== pts.claim) { Ev.claimed = pts.claim; claimBonus(login, pts); }
      }
      // undefined — ошибка сети: оставляем то, что было
      if (r[0] !== undefined) Ev.prediction = mergePrediction(Ev.prediction, r[0]);
      if (r[1] !== undefined) Ev.poll = mergePoll(Ev.poll, r[1]);
      var fresh = null;
      if (Ev.prediction && Ev.prediction.status === 'ACTIVE' && !Ev.seen['p' + Ev.prediction.id]) { Ev.seen['p' + Ev.prediction.id] = 1; fresh = 'prediction'; }
      if (Ev.poll && Ev.poll.status === 'ACTIVE' && !Ev.seen['v' + Ev.poll.id]) { Ev.seen['v' + Ev.poll.id] = 1; fresh = fresh || 'poll'; }
      if (fresh && Settings.get('eventsNotify') !== 'off' && !panel) showBanner(fresh);
      if (panel) panel.update();
      renderCorner();
    });
  }

  // ---------- значок в правом верхнем углу видео (как сундучок баллов на twitch.tv) ----------
  // Идёт прогноз/голосование — значок виден всегда: тип события, мини-полоса синий/розовый и «▲»
  // (кнопка «Вверх» открывает окно). Баллы канала — пока открыта панель плеера или сразу после бонуса.
  var corner = null;
  function cornerEvent() {
    var p = Ev.prediction, v = Ev.poll;
    if (p && p.status === 'ACTIVE') return 'prediction';
    if (v && v.status === 'ACTIVE') return 'poll';
    return p ? 'prediction' : v ? 'poll' : null;
  }
  function renderCorner() {
    if (!Ev.login) return;
    if (!corner) {
      corner = { el: h('div.ev-corner'), pts: h('span.evc-pts'), ev: h('span.evc-ev'), plus: h('span.evc-plus') };
      corner.el.appendChild(corner.ev);
      corner.el.appendChild(h('span.evc-pt', null, [h('span.ev-ic', { html: ICON.points }), corner.pts, corner.plus]));
      var box = U.$('.video-box', Player.el) || Player.el;
      box.appendChild(corner.el);
    }
    var kind = cornerEvent(), ev = kind === 'prediction' ? Ev.prediction : Ev.poll;
    corner.el.classList.toggle('has-ev', !!kind);
    corner.el.classList.toggle('has-pts', typeof Ev.balance === 'number');
    corner.pts.textContent = typeof Ev.balance === 'number' ? U.num(Ev.balance) : '';
    var key = kind ? kind + ev.id + ev.status : '';
    if (corner.key !== key) {
      corner.key = key;
      corner.ev.innerHTML = '';
      if (kind) {
        corner.ev.appendChild(h('span.evc-kind', { text: kind === 'prediction' ? tr('Прогноз') : tr('Голосование') }));
        corner.bar = kind === 'prediction' && ev.outcomes.length === 2 ? h('span.evc-bar', null, [h('i', { style: 'background:' + COLORS.BLUE }), h('i', { style: 'background:' + COLORS.PINK })]) : null;
        if (corner.bar) corner.ev.appendChild(corner.bar);
        if (ev.status === 'ACTIVE') corner.ev.appendChild(h('span.evc-up', { text: '▲' }));
      }
    }
    if (corner.bar) {
      var a = ev.outcomes[0].totalPoints || 0, b = ev.outcomes[1].totalPoints || 0;
      var pa = a + b ? a / (a + b) * 100 : 50;
      corner.bar.firstChild.style.width = pa + '%';
      corner.bar.lastChild.style.width = (100 - pa) + '%';
    }
  }
  function flashCorner(text) {
    renderCorner();
    if (!corner) return;
    corner.plus.textContent = text;
    corner.el.classList.add('flash');
    clearTimeout(corner.flashT);
    corner.flashT = setTimeout(function () { if (corner) corner.el.classList.remove('flash'); }, 6000);
  }
  function removeCorner() {
    if (corner) { clearTimeout(corner.flashT); if (corner.el.parentNode) corner.el.parentNode.removeChild(corner.el); }
    corner = null;
  }
  Ev.renderCorner = renderCorner;

  // ---------- подсказка в углу плеера ----------
  function showBanner(kind) {
    hideBanner();
    var ev = kind === 'prediction' ? Ev.prediction : Ev.poll;
    if (!ev) return;
    var mini = null;
    if (kind === 'prediction' && ev.outcomes && ev.outcomes.length === 2) {
      var t = (ev.outcomes[0].totalPoints || 0) + (ev.outcomes[1].totalPoints || 0);
      var a = t ? Math.round((ev.outcomes[0].totalPoints || 0) / t * 100) : 50;
      mini = h('div.event-split', null, [
        h('span', { text: ev.outcomes[0].title + ' ' + a + '%', style: 'color:' + COLORS.BLUE }),
        h('div.ev-bar', null, [h('i', { style: 'width:' + a + '%;background:' + COLORS.BLUE }), h('i', { style: 'width:' + (100 - a) + '%;background:' + COLORS.PINK })]),
        h('span', { text: (100 - a) + '% ' + ev.outcomes[1].title, style: 'color:' + COLORS.PINK })
      ]);
    }
    Ev.banner = h('div.event-banner', null, [
      h('div.event-kind', { text: kind === 'prediction' ? tr('Прогноз') : tr('Голосование') }),
      h('div.event-title', { text: ev.title || '' }),
      mini,
      h('div.event-hint', { text: tr('OK — участвовать') })
    ]);
    Ev.bannerKind = kind;
    Player.el.appendChild(Ev.banner);
    Ev.bannerTimer = setTimeout(hideBanner, 15000);
  }
  function hideBanner() {
    clearTimeout(Ev.bannerTimer);
    if (Ev.banner && Ev.banner.parentNode) Ev.banner.parentNode.removeChild(Ev.banner);
    Ev.banner = null;
  }
  // OK, пока видна подсказка (и панель плеера скрыта) — открыть прогноз/голосование
  Ev.onKey = function (k) {
    var ck = cornerEvent();
    if (k === 'UP' && ck) { hideBanner(); if (ck === 'prediction') Ev.openPrediction(); else Ev.openPoll(); return true; }
    if (!Ev.banner) return false;
    if (k === 'BACK') { hideBanner(); return true; } // «Назад» сначала убирает подсказку, а не закрывает эфир
    if (k !== 'ENTER') return false;
    var kind = Ev.bannerKind;
    hideBanner();
    if (kind === 'prediction') Ev.openPrediction(); else Ev.openPoll();
    return true;
  };

  function needLogin() {
    if (Auth.loggedIn() && !Auth.needsLogin()) return false;
    UI.confirm(tr('Нужен вход в Twitch'), tr('Делать прогнозы и голосовать можно только из своего аккаунта Twitch.'), tr('Войти'), function () {
      Player.close(); App.go('account', {}, { root: true });
    });
    return true;
  }

  // ---------- окно прогноза / голосования — как на twitch.tv и в приложении Twitch ----------
  // Плашка с названием и статусом, колонки исходов (синяя / розовая) с баллами, коэффициентом,
  // участниками и крупнейшей ставкой, большие проценты с цветной полоской. Окно прокручивается
  // (Twitch разрешает до 10 исходов). Обновляется вживую: таймер — каждую секунду, данные — каждые 3 с;
  // числа меняются на месте, окно целиком перестраивается, только когда меняется состав или статус.
  var ICON = {
    points: '<svg viewBox="0 0 20 20"><path d="M10 6a4 4 0 0 1 4 4h-2a2 2 0 0 0-2-2V6z"/><path fill-rule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0z"/></svg>',
    ratio: '<svg viewBox="0 0 20 20"><path d="M5 2h10v2h3v3a4 4 0 0 1-3.7 4A5 5 0 0 1 11 13.9V16h3v2H6v-2h3v-2.1A5 5 0 0 1 5.7 11 4 4 0 0 1 2 7V4h3V2zm0 4H4v1a2 2 0 0 0 1 1.7V6zm10 2.7A2 2 0 0 0 16 7V6h-1v2.7zM7 4v4a3 3 0 0 0 6 0V4H7z"/></svg>',
    users: '<svg viewBox="0 0 20 20"><path d="M7 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM1 15c0-2.8 2.7-5 6-5s6 2.2 6 5v2H1v-2zm13 2v-2c0-1.2-.4-2.3-1.1-3.2.7-.5 1.4-.8 2.1-.8 2.2 0 4 1.6 4 3.5V17h-5z"/></svg>',
    top: '<svg viewBox="0 0 20 20"><path d="M10 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 4l1.5-1L8 7h4l3.5-4L17 4l-4 5v3H7V9L3 4zm-1 10h16v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2z"/></svg>'
  };
  var COLORS = { BLUE: '#387aff', PINK: '#f5009b' };

  var panel = null; // открытое окно: { kind, el, body, actions, key, actKey, refs, update, timer }

  function isTop() { return !!panel && App.topLayer() && App.topLayer().el === panel.el; }

  function openPanel(kind, title) {
    closePanelLayer();
    hideBanner();
    // шапка (название, статус, таймер) закреплена сверху; прокручиваются только исходы и кнопки
    var head = h('div.ev-head', null, [h('div.ev-title'), h('div.ev-status')]);
    var body = h('div.ev-body');
    var actions = h('div.ev-actions', { 'data-group': 'free' });
    var scroll = h('div.v-scroll.ev-scroll', { 'data-pad': '1' }, h('div.ev-content', null, [body, actions]));
    var overlay = h('div.overlay', null, h('div.menu-panel.menu-right.ev-panel', null, [
      h('div.menu-title', { text: title }), h('div.ev-headbox', null, head), h('div.ev-scrollbox', null, scroll)]));
    panel = { kind: kind, el: overlay, head: head, body: body, actions: actions, key: '', actKey: '', refs: null, busy: false };
    panel.update = function () { if (kind === 'prediction') renderPrediction(); else renderPoll(); };
    panel.update();
    App.openLayer({ el: overlay, root: U.$('#modal-root'), focus: U.$('.focusable', overlay),
      onClose: function () { if (panel && panel.el === overlay) { clearInterval(panel.timer); panel = null; } } });
    var ticks = 0;
    panel.timer = setInterval(function () {
      if (!panel) return;
      if (++ticks % 3 === 0) refresh(kind);
      var st = U.$('.ev-status', panel.el);
      if (st) st.textContent = kind === 'prediction' ? (Ev.prediction ? predictionStatus(Ev.prediction) : '') : pollStatus(Ev.poll);
    }, 1000);
  }
  function closePanelLayer() {
    if (isTop()) App.closeLayer();
  }

  function refresh(kind) {
    var login = Ev.login;
    if (!login || !panel || document.hidden || panel.busy) return; // ответ ещё не пришёл — не копим запросы
    var pnl = panel;
    pnl.busy = true;
    (kind === 'prediction' ? loadPrediction(login) : loadPoll(login)).then(function (ev) {
      pnl.busy = false;
      if (panel !== pnl || Ev.login !== login) return;
      if (kind === 'prediction') Ev.prediction = mergePrediction(Ev.prediction, ev); else Ev.poll = mergePoll(Ev.poll, ev);
      if (!(kind === 'prediction' ? Ev.prediction : Ev.poll)) { closePanelLayer(); return; }
      pnl.update();
    }, function () { pnl.busy = false; });
  }

  // кнопки внизу окна: меняем их, только когда окно наверху — иначе (открыт список баллов)
  // отложим до следующего обновления, чтобы не выдернуть элемент, на который вернётся фокус
  function setActions(key, make) {
    if (panel.actKey === key) return;
    var hadFocus = !panel.actKey || (Nav.current && panel.actions.contains(Nav.current)) || !Nav.current || !Nav.current.isConnected;
    if (panel.actKey && !isTop()) return;
    panel.actKey = key;
    panel.actions.innerHTML = '';
    make(panel.actions);
    // фокус на первой кнопке; если исходы короткие — окно прокручено к началу, чтобы цифры были видны,
    // а если длинные (много исходов) — прокрутка идёт к самой кнопке, чтобы фокус не оказался за экраном
    var firstBtn = U.$('.focusable', panel.actions);
    var box = U.$('.ev-scrollbox', panel.el);
    if (firstBtn && box && panel.body.offsetHeight < box.clientHeight * 0.6) firstBtn.setAttribute('data-top', '1');
    // много исходов — фокус на первом исходе вверху списка (а не на кнопке внизу)
    var target = U.$('.ev-pick', panel.el) || firstBtn || U.$('.focusable', panel.el);
    if (panel.refs && isTop() && hadFocus && target) Nav.focus(target);
  }

  function stat(icon, value, color) {
    var v = h('span', { text: value });
    return { el: h('div.ev-stat', null, [h('span.ev-ic', { html: ICON[icon], style: 'fill:' + color }), v]), v: v };
  }

  function predictionStatus(p) {
    if (p.status === 'ACTIVE') {
      var end = new Date(p.createdAt).getTime() + (p.predictionWindowSeconds || 0) * 1000;
      var left = Math.max(0, Math.round((end - Date.now()) / 1000));
      return tr('Приём ставок') + (left ? ' • ' + tr('Осталось: ') + U.duration(left) : '');
    }
    if (p.status === 'LOCKED') return tr('Прогноз закрыт');
    var win = p.winningOutcome && p.outcomes.filter(function (o) { return o.id === p.winningOutcome.id; })[0];
    return win ? tr('Победил: ') + win.title : tr('Прогноз завершён');
  }

  Ev.openPrediction = function () {
    if (!Ev.prediction) { UI.toast(tr('Сейчас прогноза нет')); return; }
    var login = Ev.login;
    loadBalance(login).then(function (balance) {
      // пока ждали баланс, плеер закрыли или переключили канал — окно не показываем
      if (Ev.login !== login || !Player.isOpen()) return;
      Ev.balance = balance;
      openPanel('prediction', tr('Прогноз'));
    });
  };

  function outcomeColor(p, o, i) { return COLORS[o.color] || (p.outcomes.length === 2 && i === 1 ? COLORS.PINK : COLORS.BLUE); }

  function renderPrediction() {
    var p = Ev.prediction;
    if (!p || !panel) return;
    var total = 0;
    p.outcomes.forEach(function (o) { total += o.totalPoints || 0; });
    var key = p.id + ':' + p.status + ':' + p.outcomes.map(function (o) { return o.id; }).join(',') + ':' + (p.winningOutcome ? p.winningOutcome.id : '');
    if (panel.key !== key) {
      // состав или статус поменялся — строим заново
      panel.key = key;
      var two = p.outcomes.length === 2;
      var refs = panel.refs = { outcomes: [], bar: [] };
      var body = panel.body;
      // фокус стоял на строке исхода — после перестройки вернём его туда же (или на победителя)
      // окно не наверху (открыт выбор суммы) — фокус вернётся на запомненный в слое элемент
      var layer = App.layers.filter(function (l) { return l.el === panel.el; })[0];
      var picks = U.$$('.ev-pick', body), focusIdx = picks.indexOf(Nav.current);
      var layerIdx = layer && !isTop() ? picks.indexOf(layer.lastFocus) : -1;
      body.innerHTML = '';
      U.$('.ev-title', panel.head).textContent = p.title;
      U.$('.ev-status', panel.head).textContent = predictionStatus(p);
      var cols = h('div.ev-outcomes' + (two ? '.ev-two' : '.ev-many') + (p.status === 'ACTIVE' ? '' : '.ev-closed'));
      p.outcomes.forEach(function (o, i) {
        var color = outcomeColor(p, o, i);
        var s1 = stat('points', '', color), s2 = stat('ratio', '', color), s3 = stat('users', '', color), s4 = stat('top', '', color);
        var pct = h('div.ev-pct-num', { style: 'color:' + color });
        var won = p.winningOutcome && p.winningOutcome.id === o.id;
        // много исходов — сами строки исходов выбираются и нажимаются (OK → ставка): фокус всегда рядом с цифрами
        // строки выбираются в любом состоянии — так список можно листать и после закрытия ставок; ставка — только пока приём открыт
        var rowBet = !two;
        var oc = h('div.ev-outcome' + (won ? '.ev-won' : '') + (rowBet ? '.focusable.ev-pick' : ''), rowBet ? { style: '--ev:' + color } : null, [
          h('div.ev-name', { text: o.title, style: 'color:' + color }),
          h('div.ev-row', null, [
            h('div.ev-stats', null, [s1.el, s2.el, s3.el, s4.el]),
            h('div.ev-pct', null, [pct, h('div.ev-pill', { style: 'background:' + color })])
          ])
        ]);
        if (rowBet) {
          if (i === 0) oc.setAttribute('data-top', '1');
          oc._onclick = p.status === 'ACTIVE' ? function () { if (!needLogin()) pickPoints(p.id, o, Ev.balance); }
            : function () { UI.toast(predictionStatus(p)); };
        }
        cols.appendChild(oc);
        refs.outcomes.push({ points: s1.v, ratio: s2.v, users: s3.v, top: s4.v, pct: pct });
      });
      body.appendChild(cols);
      // общая полоса синий/розовый — сразу видно, куда ушло больше баллов
      var bar = h('div.ev-bar');
      p.outcomes.forEach(function (o, i) {
        var seg = h('i', { style: 'background:' + outcomeColor(p, o, i) });
        refs.bar.push(seg);
        bar.appendChild(seg);
      });
      body.appendChild(bar);
      refs.foot = h('div.ev-foot');
      body.appendChild(refs.foot);
      var rows = U.$$('.ev-pick', body);
      if (focusIdx >= 0 && isTop() && (!Nav.current || !Nav.current.isConnected)) {
        Nav.focus(U.$('.ev-pick.ev-won', body) || rows[Math.min(focusIdx, rows.length - 1)] || U.$('.focusable', panel.el));
      } else if (layerIdx >= 0 && rows.length) layer.lastFocus = U.$('.ev-pick.ev-won', body) || rows[Math.min(layerIdx, rows.length - 1)];
    }
    // числа — на месте, без перестройки DOM
    var refs2 = panel.refs;
    p.outcomes.forEach(function (o, i) {
      var r = refs2.outcomes[i];
      r.points.textContent = U.num(o.totalPoints || 0);
      r.ratio.textContent = o.totalPoints ? '1:' + U.dec(total / o.totalPoints, 2) : '—';
      r.users.textContent = U.num(o.totalUsers || 0);
      r.top.textContent = o.topPredictors && o.topPredictors[0] ? U.num(o.topPredictors[0].points) : '—';
      r.pct.textContent = (total ? Math.round((o.totalPoints || 0) / total * 100) : 0) + '%';
      refs2.bar[i].style.width = (total ? (o.totalPoints || 0) / total * 100 : 100 / p.outcomes.length) + '%';
    });
    var foot = tr('Прогноз начался: ') + U.ago(p.createdAt);
    if (p.status === 'LOCKED') foot += '\n' + tr('Ожидание результата');
    if (Ev.balance !== null && Ev.balance !== undefined) foot += '\n' + tr('ваши баллы: ') + U.num(Ev.balance);
    refs2.foot.textContent = foot;

    // кнопки ставок — только пока приём открыт
    var many = p.outcomes.length !== 2;
    setActions(p.id + ':' + (p.status === 'ACTIVE' ? (many ? 'rows' : 'bet') : 'close'), function (box) {
      if (p.status === 'ACTIVE' && many) return; // ставки — прямо на строках исходов
      if (p.status === 'ACTIVE') {
        p.outcomes.forEach(function (o, i) {
          var b = h('div.btn.focusable.ev-bet', { style: '--ev:' + outcomeColor(p, o, i) }, [h('span', { text: o.title })]);
          b._onclick = function () { if (!needLogin()) pickPoints(p.id, o, Ev.balance); };
          box.appendChild(b);
        });
      } else box.appendChild(UI.button(tr('Закрыть'), null, function () { App.closeLayer(); }));
    });
  }

  function pickPoints(eventId, o, balance) {
    var amounts = [10, 50, 100, 250, 500, 1000, 5000, 10000, 50000];
    if (balance !== null && balance !== undefined) amounts = amounts.filter(function (a) { return a <= balance; });
    var items = amounts.map(function (a) { return { label: tr('Баллы: ') + U.num(a), onSelect: function () { predict(eventId, o, a); } }; });
    if (balance) items.push({ label: tr('Все баллы') + ': ' + U.num(balance), onSelect: function () { predict(eventId, o, balance); } });
    if (!items.length) { UI.toast(tr('Недостаточно баллов канала')); return; }
    UI.menu(tr('Ставка: ') + o.title, items, { cls: 'menu-right' });
  }

  function predict(eventId, o, points) {
    // пока выбирали сумму, Twitch мог закрыть приём ставок
    var p = Ev.prediction;
    if (!p || p.id !== eventId || p.status !== 'ACTIVE') { UI.toast(tr('Прогноз закрыт')); if (panel) panel.update(); return; }
    Auth.gql('mutation($input:MakePredictionInput!){makePrediction(input:$input){error{code} prediction{id}}}',
      { input: { eventID: eventId, outcomeID: o.id, points: points, transactionID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.makePrediction;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Ставка принята: ') + o.title + ' • ' + tr('Баллы: ') + U.num(points));
        if (Ev.balance) Ev.balance = Math.max(0, Ev.balance - points);
        renderCorner();
        refresh('prediction');
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял ставку') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  // ---------- голосование ----------
  Ev.openPoll = function () {
    if (!Ev.poll) { UI.toast(tr('Сейчас голосования нет')); return; }
    openPanel('poll', tr('Голосование'));
  };

  function pollStatus(p) {
    if (!p) return '';
    if (p.status !== 'ACTIVE') return tr('Голосование завершено');
    var left = p._endAt ? Math.max(0, Math.round((p._endAt - Date.now()) / 1000)) : 0;
    return left ? tr('Осталось: ') + U.duration(left) : tr('Ожидание результата');
  }

  function renderPoll() {
    var p = Ev.poll;
    if (!p || !panel) return;
    var total = (p.votes && p.votes.total) || 0;
    var key = p.id + ':' + p.choices.map(function (c) { return c.id; }).join(',');
    if (panel.key !== key) {
      panel.key = key;
      var refs = panel.refs = { choices: [] };
      var body = panel.body;
      body.innerHTML = '';
      U.$('.ev-title', panel.head).textContent = p.title;
      U.$('.ev-status', panel.head).textContent = pollStatus(p);
      // как на Twitch: у каждого варианта полоска, заполненная на свой процент голосов
      p.choices.forEach(function (c) {
        var fill = h('div.ev-choice-fill'), val = h('b');
        var row = h('div.ev-choice', null, [fill, h('div.ev-choice-text', null, [h('span', { text: c.title }), val])]);
        body.appendChild(row);
        refs.choices.push({ row: row, fill: fill, val: val });
      });
      refs.foot = h('div.ev-foot');
      body.appendChild(refs.foot);
    }
    var best = 0;
    p.choices.forEach(function (c) { best = Math.max(best, (c.votes && c.votes.total) || 0); });
    p.choices.forEach(function (c, i) {
      var v = (c.votes && c.votes.total) || 0, pct = total ? Math.round(v / total * 100) : 0, r = panel.refs.choices[i];
      r.fill.style.width = pct + '%';
      r.val.textContent = pct + '% (' + U.num(v) + ')';
      r.row.classList.toggle('ev-lead', !!v && v === best);
    });
    panel.refs.foot.textContent = tr('Голосов: ') + U.num(total);
    setActions(p.id + ':' + (p.status === 'ACTIVE' ? 'vote' : 'close'), function (box) {
      if (p.status === 'ACTIVE') {
        p.choices.forEach(function (c) {
          var b = h('div.btn.focusable.ev-bet', { style: '--ev:#9146ff' }, [h('span', { text: c.title })]);
          b._onclick = function () { if (!needLogin()) vote(p.id, c); };
          box.appendChild(b);
        });
      } else box.appendChild(UI.button(tr('Закрыть'), null, function () { App.closeLayer(); }));
    });
  }

  function vote(pollId, c) {
    var p = Ev.poll, u = Auth.user();
    if (!p || p.id !== pollId || p.status !== 'ACTIVE') { UI.toast(tr('Голосование завершено')); return; }
    Auth.gql('mutation($input:VoteInPollInput!){voteInPoll(input:$input){error{code}}}',
      { input: { pollID: pollId, choiceID: c.id, userID: u && u.id, voteID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.voteInPoll;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Голос учтён: ') + c.title);
        refresh('poll');
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял голос') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  window.Events = Ev;
})();
