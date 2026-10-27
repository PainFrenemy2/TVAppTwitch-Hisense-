/* Прогнозы (ставки баллами канала) и голосования во время эфира — как на twitch.tv.
   Раз в 30 секунд спрашиваем Twitch, идёт ли сейчас прогноз/голосование; о новом — всплывающая подсказка
   (отключается в настройках). Сделать ставку или проголосовать можно из «Параметров» плеера или кнопкой OK
   на подсказке. Для участия нужен вход в Twitch. */
(function () {
  'use strict';
  var h = U.h;

  var PRED = 'id title status predictionWindowSeconds createdAt outcomes{id title color totalPoints totalUsers} winningOutcome{id}';
  var PRED_TOP = PRED.replace('totalUsers}', 'totalUsers topPredictors{points}}');

  var Ev = { login: null, timer: null, prediction: null, poll: null, balance: null, seen: {}, banner: null, bannerTimer: null };

  function anon(query, vars) { return Twitch.gqlRaw(query, vars); }
  function asUser(query, vars) { return Auth.loggedIn() && !Auth.needsLogin() ? Auth.gql(query, vars) : anon(query, vars); }

  function loadPrediction(login) {
    var q = function (fields) { return 'query($login:String!){user(login:$login){id channel{id activePredictionEvents{' + fields + '} lockedPredictionEvents{' + fields + '}}}}'; };
    // с крупнейшими ставками, а если Twitch не знает этого поля — без них
    return asUser(q(PRED_TOP), { login: login }).catch(function () { return asUser(q(PRED), { login: login }); })
      .then(function (d) {
        var ch = d && d.user && d.user.channel;
        if (!ch) return null;
        var list = [].concat(ch.activePredictionEvents || [], ch.lockedPredictionEvents || []);
        return list[0] || null;
      }).catch(function () { return null; });
  }

  function loadPoll(login) {
    return asUser('query($login:String!){channel(name:$login){id viewablePoll{id title status remainingDurationMilliseconds choices{id title votes{total}} votes{total}}}}', { login: login })
      .then(function (d) {
        var p = d && d.channel && d.channel.viewablePoll;
        return p && p.status === 'ACTIVE' ? p : null;
      }).catch(function () { return null; });
  }

  function loadBalance(login) {
    if (!Auth.loggedIn() || Auth.needsLogin()) return Promise.resolve(null);
    return Auth.gql('query($login:String!){user(login:$login){channel{self{communityPoints{balance}}}}}', { login: login }).then(function (d) {
      var c = d && d.user && d.user.channel;
      return c && c.self && c.self.communityPoints ? c.self.communityPoints.balance : null;
    }).catch(function () { return null; });
  }

  Ev.start = function (login) {
    if (Ev.seenFor !== login) { Ev.seen = {}; Ev.seenFor = login; } // о старых событиях другого канала не помним
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
    hideBanner();
  };

  function check() {
    var login = Ev.login;
    // ТВ свернул приложение — не дёргаем Twitch впустую
    if (!login || document.hidden || Player.bgPaused) return;
    Promise.all([loadPrediction(login), loadPoll(login)]).then(function (r) {
      if (Ev.login !== login) return;
      Ev.prediction = r[0];
      Ev.poll = r[1];
      var fresh = null;
      if (Ev.prediction && Ev.prediction.status === 'ACTIVE' && !Ev.seen['p' + Ev.prediction.id]) { Ev.seen['p' + Ev.prediction.id] = 1; fresh = 'prediction'; }
      if (Ev.poll && !Ev.seen['v' + Ev.poll.id]) { Ev.seen['v' + Ev.poll.id] = 1; fresh = fresh || 'poll'; }
      if (fresh && Settings.get('eventsNotify') !== 'off') showBanner(fresh);
    });
  }

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
    if (!Ev.banner) return false;
    if (k === 'BACK') { hideBanner(); return true; } // «Назад» сначала убирает подсказку, а не закрывает эфир
    if (k !== 'ENTER') return false;
    var kind = Ev.bannerKind;
    hideBanner();
    if (kind === 'prediction') Ev.openPrediction(); else Ev.openPoll();
    return true;
  };

  // ---------- пункты для меню «Параметры» ----------
  Ev.menuItems = function () {
    var items = [];
    if (Ev.prediction) items.push({ label: tr('Прогноз'), sub: Ev.prediction.title + ' • ' + statusText(Ev.prediction.status), onSelect: Ev.openPrediction });
    if (Ev.poll) items.push({ label: tr('Голосование'), sub: Ev.poll.title, onSelect: Ev.openPoll });
    return items;
  };

  function statusText(s) {
    if (s === 'ACTIVE') return tr('Приём ставок');
    if (s === 'LOCKED') return tr('ставки закрыты');
    return tr('завершён');
  }

  function needLogin() {
    if (Auth.loggedIn() && !Auth.needsLogin()) return false;
    UI.confirm(tr('Нужен вход в Twitch'), tr('Делать прогнозы и голосовать можно только из своего аккаунта Twitch.'), tr('Войти'), function () {
      Player.close(); App.go('account', {}, { root: true });
    });
    return true;
  }

  // ---------- окно прогноза — как на twitch.tv и в приложении Twitch ----------
  // Плашка с названием и статусом, колонки исходов (синяя / розовая) с баллами, коэффициентом,
  // участниками и крупнейшей ставкой, большие проценты с цветной полоской. Данные обновляются каждые 5 с.
  var ICON = {
    points: '<svg viewBox="0 0 20 20"><path d="M10 6a4 4 0 0 1 4 4h-2a2 2 0 0 0-2-2V6z"/><path fill-rule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0z"/></svg>',
    ratio: '<svg viewBox="0 0 20 20"><path d="M5 2h10v2h3v3a4 4 0 0 1-3.7 4A5 5 0 0 1 11 13.9V16h3v2H6v-2h3v-2.1A5 5 0 0 1 5.7 11 4 4 0 0 1 2 7V4h3V2zm0 4H4v1a2 2 0 0 0 1 1.7V6zm10 2.7A2 2 0 0 0 16 7V6h-1v2.7zM7 4v4a3 3 0 0 0 6 0V4H7z"/></svg>',
    users: '<svg viewBox="0 0 20 20"><path d="M7 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM1 15c0-2.8 2.7-5 6-5s6 2.2 6 5v2H1v-2zm13 2v-2c0-1.2-.4-2.3-1.1-3.2.7-.5 1.4-.8 2.1-.8 2.2 0 4 1.6 4 3.5V17h-5z"/></svg>',
    top: '<svg viewBox="0 0 20 20"><path d="M10 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 4l1.5-1L8 7h4l3.5-4L17 4l-4 5v3H7V9L3 4zm-1 10h16v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2z"/></svg>'
  };
  var COLORS = { BLUE: '#387aff', PINK: '#f5009b' };

  var panel = null; // открытое окно: { kind, el, timer, render }

  function openPanel(kind, title, build) {
    closePanelLayer();
    var body = h('div.ev-body');
    var actions = h('div.ev-actions', { 'data-group': 'free' });
    var el = h('div.menu-panel.menu-right.ev-panel', null, [h('div.menu-title', { text: title }), body, actions]);
    var overlay = h('div.overlay', null, el);
    panel = { kind: kind, el: overlay, body: body, actions: actions, render: build };
    build(body, actions, true);
    App.openLayer({ el: overlay, root: U.$('#modal-root'), focus: U.$('.focusable', overlay),
      onClose: function () { if (panel && panel.el === overlay) { clearInterval(panel.timer); panel = null; } } });
    // пока окно открыто — живое обновление: таймер каждую секунду, проценты и баллы каждые 3 секунды
    var ticks = 0;
    panel.timer = setInterval(function () {
      if (!panel) return;
      if (++ticks % 3 === 0) refresh(kind);
      var st = U.$('.ev-status', panel.el);
      if (st) st.textContent = kind === 'prediction' ? (Ev.prediction ? predictionStatus(Ev.prediction) : '') : pollStatus(Ev.poll);
    }, 1000);
  }
  function closePanelLayer() {
    if (panel && App.topLayer() && App.topLayer().el === panel.el) App.closeLayer();
  }

  function refresh(kind) {
    var login = Ev.login;
    if (!login || !panel || document.hidden) return;
    (kind === 'prediction' ? loadPrediction(login) : loadPoll(login)).then(function (ev) {
      if (!panel || panel.kind !== kind || Ev.login !== login) return;
      if (kind === 'prediction') Ev.prediction = ev; else Ev.poll = ev;
      if (!ev) { closePanelLayer(); return; }
      panel.render(panel.body, panel.actions, false);
    });
  }

  function stat(icon, value, color) {
    return h('div.ev-stat', null, [h('span.ev-ic', { html: ICON[icon], style: 'fill:' + color }), h('span', { text: value })]);
  }

  function predictionStatus(p) {
    if (p.status === 'ACTIVE') {
      var end = new Date(p.createdAt).getTime() + (p.predictionWindowSeconds || 0) * 1000;
      var left = Math.max(0, Math.round((end - Date.now()) / 1000));
      return tr('Приём ставок') + (left ? ' • ' + tr('Осталось: ') + U.duration(left) : '');
    }
    if (p.status === 'LOCKED') return tr('Прогноз закрыт');
    var win = p.winningOutcome && p.outcomes.filter(function (o) { return o.id === p.winningOutcome.id; })[0];
    return win ? tr('Победил: ') + win.title : tr('завершён');
  }

  Ev.openPrediction = function () {
    if (!Ev.prediction) { UI.toast(tr('Сейчас прогноза нет')); return; }
    var login = Ev.login;
    loadBalance(login).then(function (balance) {
      // пока ждали баланс, плеер закрыли или переключили канал — окно не показываем
      if (Ev.login !== login || !Player.isOpen()) return;
      Ev.balance = balance;
      openPanel('prediction', tr('Прогноз'), renderPrediction);
    });
  };

  function renderPrediction(body, actions, first) {
    var p = Ev.prediction;
    if (!p) return;
    var total = 0;
    p.outcomes.forEach(function (o) { total += o.totalPoints || 0; });
    var two = p.outcomes.length === 2;
    body.innerHTML = '';
    body.appendChild(h('div.ev-head', null, [h('div.ev-title', { text: p.title }), h('div.ev-status', { text: predictionStatus(p) })]));
    var cols = h('div.ev-outcomes' + (two ? '.ev-two' : '.ev-many'));
    p.outcomes.forEach(function (o, i) {
      var color = COLORS[o.color] || (two && i === 1 ? COLORS.PINK : COLORS.BLUE);
      var pct = total ? Math.round((o.totalPoints || 0) / total * 100) : 0;
      var ratio = o.totalPoints ? U.dec(total / o.totalPoints, 2) : '—';
      var top = o.topPredictors && o.topPredictors[0] ? U.num(o.topPredictors[0].points) : '—';
      var won = p.winningOutcome && p.winningOutcome.id === o.id;
      cols.appendChild(h('div.ev-outcome' + (won ? '.ev-won' : ''), { style: '--ev:' + color }, [
        h('div.ev-name', { text: o.title, style: 'color:' + color }),
        h('div.ev-row', null, [
          h('div.ev-stats', null, [
            stat('points', U.num(o.totalPoints || 0), color),
            stat('ratio', o.totalPoints ? '1:' + ratio : '—', color),
            stat('users', U.num(o.totalUsers || 0), color),
            stat('top', top, color)
          ]),
          h('div.ev-pct', null, [h('div.ev-pct-num', { text: pct + '%', style: 'color:' + color }), h('div.ev-pill', { style: 'background:' + color })])
        ])
      ]));
    });
    body.appendChild(cols);
    // общая полоса синий/розовый — сразу видно, куда ушло больше баллов
    if (total) {
      var bar = h('div.ev-bar');
      p.outcomes.forEach(function (o, i) {
        var color = COLORS[o.color] || (two && i === 1 ? COLORS.PINK : COLORS.BLUE);
        bar.appendChild(h('i', { style: 'width:' + ((o.totalPoints || 0) / total * 100) + '%;background:' + color }));
      });
      body.appendChild(bar);
    }
    var foot = [h('div', { text: tr('Прогноз начался: ') + U.ago(p.createdAt) })];
    if (p.status === 'LOCKED') foot.push(h('div', { text: tr('Ожидание результата') }));
    if (Ev.balance !== null && Ev.balance !== undefined) foot.push(h('div.ev-balance', { text: tr('ваши баллы: ') + U.num(Ev.balance) }));
    body.appendChild(h('div.ev-foot', null, foot));

    // кнопки ставок — только пока принимаются; при обновлении данных фокус не трогаем
    if (!first && actions.children.length && p.status === 'ACTIVE') return;
    actions.innerHTML = '';
    if (p.status === 'ACTIVE') {
      p.outcomes.forEach(function (o, i) {
        var color = COLORS[o.color] || (two && i === 1 ? COLORS.PINK : COLORS.BLUE);
        var b = h('div.btn.focusable.ev-bet', { style: '--ev:' + color }, [h('span', { text: o.title })]);
        b._onclick = function () { if (!needLogin()) pickPoints(p, o, Ev.balance); };
        actions.appendChild(b);
      });
    } else {
      var c = UI.button(tr('Закрыть'), null, function () { App.closeLayer(); });
      actions.appendChild(c);
      if (!first && App.topLayer() && panel && App.topLayer().el === panel.el && (!Nav.current || !Nav.current.isConnected)) Nav.focus(c);
    }
  }

  function pickPoints(p, o, balance) {
    var amounts = [10, 50, 100, 250, 500, 1000, 5000, 10000, 50000];
    if (balance !== null && balance !== undefined) amounts = amounts.filter(function (a) { return a <= balance; });
    var items = amounts.map(function (a) { return { label: tr('Баллы: ') + U.num(a), onSelect: function () { predict(p, o, a); } }; });
    if (balance) items.push({ label: tr('Все баллы') + ': ' + U.num(balance), onSelect: function () { predict(p, o, balance); } });
    if (!items.length) { UI.toast(tr('Недостаточно баллов канала')); return; }
    UI.menu(tr('Ставка: ') + o.title, items, { cls: 'menu-right' });
  }

  function predict(p, o, points) {
    Auth.gql('mutation($input:MakePredictionInput!){makePrediction(input:$input){error{code} prediction{id}}}',
      { input: { eventID: p.id, outcomeID: o.id, points: points, transactionID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.makePrediction;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Ставка принята: ') + o.title + ' • ' + tr('Баллы: ') + U.num(points));
        if (Ev.balance) Ev.balance = Math.max(0, Ev.balance - points);
        check();
        refresh('prediction');
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял ставку') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  // ---------- голосование ----------
  Ev.openPoll = function () {
    if (!Ev.poll) { UI.toast(tr('Сейчас голосования нет')); return; }
    openPanel('poll', tr('Голосование'), renderPoll);
  };

  function pollStatus(p) {
    if (!p) return '';
    var left = p._endAt ? Math.max(0, Math.round((p._endAt - Date.now()) / 1000)) : 0;
    return left ? tr('Осталось: ') + U.duration(left) : tr('завершён');
  }

  function renderPoll(body, actions, first) {
    var p = Ev.poll;
    if (!p) return;
    var total = (p.votes && p.votes.total) || 0;
    p._endAt = p._endAt || (p.remainingDurationMilliseconds ? Date.now() + p.remainingDurationMilliseconds : 0);
    body.innerHTML = '';
    body.appendChild(h('div.ev-head', null, [h('div.ev-title', { text: p.title }), h('div.ev-status', { text: pollStatus(p) })]));
    var best = 0;
    p.choices.forEach(function (c) { best = Math.max(best, (c.votes && c.votes.total) || 0); });
    // как на Twitch: у каждого варианта полоска, заполненная на свой процент голосов
    p.choices.forEach(function (c) {
      var v = (c.votes && c.votes.total) || 0, pct = total ? Math.round(v / total * 100) : 0;
      body.appendChild(h('div.ev-choice' + (v && v === best ? '.ev-lead' : ''), null, [
        h('div.ev-choice-fill', { style: 'width:' + pct + '%' }),
        h('div.ev-choice-text', null, [h('span', { text: c.title }), h('b', { text: pct + '% (' + U.num(v) + ')' })])
      ]));
    });
    body.appendChild(h('div.ev-foot', null, h('div', { text: tr('Голосов: ') + U.num(total) })));
    if (!first && actions.children.length) return;
    actions.innerHTML = '';
    p.choices.forEach(function (c) {
      var b = h('div.btn.focusable.ev-bet', { style: '--ev:#9146ff' }, [h('span', { text: c.title })]);
      b._onclick = function () { if (!needLogin()) vote(p, c); };
      actions.appendChild(b);
    });
  }

  function vote(p, c) {
    var u = Auth.user();
    Auth.gql('mutation($input:VoteInPollInput!){voteInPoll(input:$input){error{code}}}',
      { input: { pollID: p.id, choiceID: c.id, userID: u && u.id, voteID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.voteInPoll;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Голос учтён: ') + c.title);
        check();
        refresh('poll');
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял голос') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  window.Events = Ev;
})();
