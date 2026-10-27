/* Прогнозы (ставки баллами канала) и голосования во время эфира — как на twitch.tv.
   Раз в 30 секунд спрашиваем Twitch, идёт ли сейчас прогноз/голосование; о новом — всплывающая подсказка
   (отключается в настройках). Сделать ставку или проголосовать можно из «Параметров» плеера или кнопкой OK
   на подсказке. Для участия нужен вход в Twitch. */
(function () {
  'use strict';
  var h = U.h;

  var PRED = 'id title status predictionWindowSeconds createdAt outcomes{id title color totalPoints totalUsers} winningOutcome{id}';

  var Ev = { login: null, timer: null, prediction: null, poll: null, balance: null, seen: {}, banner: null, bannerTimer: null };

  function anon(query, vars) { return Twitch.gqlRaw(query, vars); }
  function asUser(query, vars) { return Auth.loggedIn() && !Auth.needsLogin() ? Auth.gql(query, vars) : anon(query, vars); }

  function loadPrediction(login) {
    return asUser('query($login:String!){user(login:$login){id channel{id activePredictionEvents{' + PRED + '} lockedPredictionEvents{' + PRED + '}}}}', { login: login })
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
    Ev.stop();
    Ev.login = login;
    check();
    Ev.timer = setInterval(check, 30000);
  };

  Ev.stop = function () {
    clearInterval(Ev.timer);
    Ev.timer = null;
    Ev.login = null;
    Ev.prediction = null;
    Ev.poll = null;
    hideBanner();
  };

  function check() {
    var login = Ev.login;
    if (!login) return;
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
    Ev.banner = h('div.event-banner', null, [
      h('div.event-kind', { text: kind === 'prediction' ? tr('Прогноз') : tr('Голосование') }),
      h('div.event-title', { text: ev.title || '' }),
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
    if (!Ev.banner || k !== 'ENTER') return false;
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
    if (s === 'ACTIVE') return tr('приём ставок');
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

  // ---------- прогноз ----------
  Ev.openPrediction = function () {
    var p = Ev.prediction;
    if (!p) { UI.toast(tr('Сейчас прогноза нет')); return; }
    var total = 0;
    p.outcomes.forEach(function (o) { total += o.totalPoints || 0; });
    loadBalance(Ev.login).then(function (balance) {
      Ev.balance = balance;
      var title = p.title + (balance !== null ? ' • ' + tr('ваши баллы: ') + U.num(balance) : '');
      UI.menu(title, p.outcomes.map(function (o) {
        var pct = total ? Math.round((o.totalPoints || 0) / total * 100) : 0;
        var ratio = o.totalPoints ? (total / o.totalPoints).toFixed(2) : '—';
        return {
          label: o.title,
          sub: pct + '% • ' + U.num(o.totalPoints || 0) + tr(' баллов') + ' • 1:' + ratio + ' • ' + U.num(o.totalUsers || 0) + tr(' участников'),
          onSelect: function () {
            if (p.status !== 'ACTIVE') { UI.toast(tr('Ставки уже закрыты')); return; }
            if (needLogin()) return;
            pickPoints(p, o, balance);
          }
        };
      }), { cls: 'menu-right' });
    });
  };

  function pickPoints(p, o, balance) {
    var amounts = [10, 50, 100, 250, 500, 1000, 5000, 10000, 50000];
    if (balance !== null) amounts = amounts.filter(function (a) { return a <= balance; });
    var items = amounts.map(function (a) { return { label: U.num(a) + tr(' баллов'), onSelect: function () { predict(p, o, a); } }; });
    if (balance) items.push({ label: tr('Все баллы') + ' — ' + U.num(balance), onSelect: function () { predict(p, o, balance); } });
    if (!items.length) { UI.toast(tr('Недостаточно баллов канала')); return; }
    UI.menu(tr('Ставка: ') + o.title, items, { cls: 'menu-right' });
  }

  function predict(p, o, points) {
    Auth.gql('mutation($input:MakePredictionInput!){makePrediction(input:$input){error{code} prediction{id}}}',
      { input: { eventID: p.id, outcomeID: o.id, points: points, transactionID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.makePrediction;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Ставка принята: ') + U.num(points) + tr(' баллов') + ' → ' + o.title);
        check();
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял ставку') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  // ---------- голосование ----------
  Ev.openPoll = function () {
    var p = Ev.poll;
    if (!p) { UI.toast(tr('Сейчас голосования нет')); return; }
    var total = (p.votes && p.votes.total) || 0;
    var left = p.remainingDurationMilliseconds ? Math.ceil(p.remainingDurationMilliseconds / 1000) : 0;
    UI.menu(p.title + (left ? ' • ' + U.duration(left) : ''), p.choices.map(function (c) {
      var v = (c.votes && c.votes.total) || 0;
      return {
        label: c.title,
        sub: (total ? Math.round(v / total * 100) : 0) + '% • ' + U.num(v),
        onSelect: function () { if (!needLogin()) vote(p, c); }
      };
    }), { cls: 'menu-right' });
  };

  function vote(p, c) {
    var u = Auth.user();
    Auth.gql('mutation($input:VoteInPollInput!){voteInPoll(input:$input){error{code}}}',
      { input: { pollID: p.id, choiceID: c.id, userID: u && u.id, voteID: U.uid(32) } })
      .then(function (d) {
        var r = d && d.voteInPoll;
        if (!r || r.error) throw new Error(r && r.error ? r.error.code : '');
        UI.toast(tr('Голос учтён: ') + c.title);
        check();
      })
      .catch(function (e) { UI.toast(tr('Twitch не принял голос') + (e && e.message ? ': ' + e.message : ''), 5000); });
  }

  window.Events = Ev;
})();
