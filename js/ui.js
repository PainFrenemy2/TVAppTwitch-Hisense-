/* Компоненты интерфейса в стиле YouTube TV: карточки, полки, сетки, тосты, диалоги */
(function () {
  'use strict';
  var h = U.h;

  var ICONS = {
    search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
    home: '<path d="M12 3 3 10.5V21h6.5v-6h5v6H21V10.5L12 3z"/>',
    browse: '<path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/>',
    following: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    heartOutline: '<path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>',
    settings: '<path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.92 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.72 8.47a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
    replay10: '<path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" font-family="Inter,Arial" font-weight="700">10</text>',
    forward10: '<path d="M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6v4l5-5-5-5v4c-4.4 0-8 3.6-8 8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" font-family="Inter,Arial" font-weight="700">10</text>',
    hd: '<path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-8 12H9.5v-2h-2v2H6V9h1.5v2.5h2V9H11v6zm2-6h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4V9zm1.5 4.5h2v-3h-2v3z"/>',
    chat: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>',
    refresh: '<path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
    person: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
    live: '<circle cx="12" cy="12" r="5"/>',
    back: '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>',
    backspace: '<path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"/>',
    space: '<path d="M18 9v4H6V9H4v6h16V9z"/>',
    clip: '<path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4h-4z"/>',
    video: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    next: '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>',
    prev: '<path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>',
    history: '<path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>',
    tv: '<path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 1.99-2L23 5a2 2 0 0 0-2-2zm0 14H3V5h18v12z"/>'
  };

  var UI = { ICONS: ICONS };

  UI.icon = function (name, cls) {
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };

  // Ленивая загрузка картинок: src ставим только когда карточка рядом с экраном
  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var img = e.target;
          if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
          io.unobserve(img);
        }
      });
    }, { rootMargin: '400px 1200px 600px 1200px' });
  }

  UI.img = function (cls, src, alt) {
    var img = h('img.' + cls, { alt: alt || '', draggable: 'false' });
    img.onerror = function () { img.classList.add('broken'); };
    img.onload = function () { img.classList.add('loaded'); };
    if (!src) { img.classList.add('broken'); return img; }
    if (io) { img.dataset.src = src; io.observe(img); } else img.src = src;
    return img;
  };

  function gameName(g) { return g ? (g.displayName || g.name || '') : ''; }

  // ---------- карточки ----------

  UI.streamCard = function (s, onSelect) {
    var b = s.broadcaster || {};
    var card = h('div.card.card-video.focusable', null, [
      h('div.thumb', null, [
        UI.img('thumb-img', s.previewImageURL ? s.previewImageURL + (s.previewImageURL.indexOf('?') < 0 ? '?t=' + Math.floor(Date.now() / 120000) : '') : ''),
        h('div.badge.badge-live', { text: s.type === 'rerun' ? tr('ПОВТОР') : tr('В ЭФИРЕ') }),
        h('div.badge.badge-bl', { text: U.viewers(s.viewersCount) })
      ]),
      h('div.meta', null, [
        UI.img('avatar', b.profileImageURL),
        h('div.meta-text', null, [
          h('div.title', { text: s.title || b.displayName || '' }),
          h('div.sub', { text: (b.displayName || b.login || '') + (gameName(s.game) ? ' • ' + gameName(s.game) : '') })
        ])
      ])
    ]);
    card._data = s;
    card._onclick = function () { Preview.stop(); onSelect(s, card); };
    // постоял на карточке — в ней начинается живое превью без звука, как в YouTube
    card._onfocus = function () {
      if (!b.login) return;
      var thumb = U.$('.thumb', card);
      var v = U.$('video', thumb);
      if (!v) { v = h('video.thumb-video', { playsinline: '' }); thumb.insertBefore(v, thumb.children[1] || null); }
      Preview.start(v, b.login);
    };
    card._onblur = function () { Preview.stop(); };
    return card;
  };

  UI.videoCard = function (v, onSelect) {
    var o = v.owner || {};
    var card = h('div.card.card-video.focusable', null, [
      h('div.thumb', null, [
        UI.img('thumb-img', v.previewThumbnailURL),
        h('div.badge.badge-br', { text: U.duration(v.lengthSeconds) }),
        v.broadcastType === 'HIGHLIGHT' ? h('div.badge.badge-tl', { text: tr('ЛУЧШЕЕ') }) : null,
        h('div.progress', null, h('div.progress-fill', { style: 'width:' + UI.vodProgress(v) + '%' }))
      ]),
      h('div.meta', null, [
        UI.img('avatar', o.profileImageURL),
        h('div.meta-text', null, [
          h('div.title', { text: v.title || '' }),
          h('div.sub', { text: (o.displayName ? o.displayName + ' • ' : '') + U.ago(v.createdAt) })
        ])
      ])
    ]);
    card._data = v;
    card._onclick = function () { onSelect(v, card); };
    return card;
  };

  UI.vodProgress = function (v) {
    var pos = U.store.get('vodpos', {})[v.id];
    if (!pos || !v.lengthSeconds) return 0;
    return Math.min(100, Math.round(pos / v.lengthSeconds * 100));
  };

  UI.clipCard = function (c, onSelect) {
    var b = c.broadcaster || {};
    var card = h('div.card.card-video.focusable', null, [
      h('div.thumb', null, [
        UI.img('thumb-img', c.thumbnailURL),
        h('div.badge.badge-tl', { text: tr('КЛИП') }),
        h('div.badge.badge-br', { text: U.duration(c.durationSeconds) })
      ]),
      h('div.meta', null, [
        UI.img('avatar', b.profileImageURL),
        h('div.meta-text', null, [
          h('div.title', { text: c.title || '' }),
          h('div.sub', { text: (b.displayName ? b.displayName + ' • ' : '') + U.views(c.viewCount) })
        ])
      ])
    ]);
    card._data = c;
    card._onclick = function () { onSelect(c, card); };
    return card;
  };

  UI.gameCard = function (g, onSelect) {
    var card = h('div.card.card-game.focusable', null, [
      h('div.box', null, UI.img('box-img', g.boxArtURL)),
      h('div.title', { text: gameName(g) }),
      h('div.sub', { text: U.viewers(g.viewersCount) })
    ]);
    card._data = g;
    card._onclick = function () { onSelect(g, card); };
    return card;
  };

  UI.channelCard = function (u, onSelect) {
    var live = !!u.stream;
    var card = h('div.card.card-channel.focusable' + (live ? '.is-live' : ''), null, [
      h('div.ch-avatar', { 'data-letter': String(u.displayName || u.login || '?').charAt(0).toUpperCase() }, [
        UI.img('ch-img', u.profileImageURL),
        live ? h('div.ch-live', { text: tr('В ЭФИРЕ') }) : null
      ]),
      h('div.title', { text: u.displayName || u.login }),
      h('div.sub', { text: live ? (gameName(u.stream.game) || tr('В эфире')) : (u.followers ? U.num(u.followers.totalCount) + tr(' фолловеров') : tr('Не в сети')) })
    ]);
    card._data = u;
    card._onclick = function () { onSelect(u, card); };
    return card;
  };

  // ---------- полки и сетки ----------

  // Горизонтальная полка (как ряды в YouTube TV)
  UI.shelf = function (title, opts) {
    opts = opts || {};
    var track = h('div.shelf-track');
    var el = h('section.row.shelf' + (opts.cls ? '.' + opts.cls : ''), { 'data-group': 'shelf' }, [
      title ? h('h2.shelf-title', null, [title, opts.badge ? h('span.shelf-badge', { text: opts.badge }) : null]) : null,
      h('div.shelf-viewport', null, track)
    ]);
    el.track = track;
    el.add = function (cards) { cards.forEach(function (c) { track.appendChild(c); }); };
    if (opts.loadMore) UI.pager(el, track, opts.loadMore);
    return el;
  };

  // Сетка карточек с подгрузкой
  UI.grid = function (cls, loadMore) {
    var el = h('div.grid' + (cls ? '.' + cls : ''), { 'data-group': 'free' });
    el.add = function (cards) {
      cards.forEach(function (c) { c.classList.add('row'); el.appendChild(c); });
    };
    if (loadMore) UI.pager(el, el, loadMore);
    return el;
  };

  // Подгрузка: loadMore() должен вернуть Promise<cards[]> или null, если всё загружено
  UI.pager = function (host, container, loadMore) {
    host.setAttribute('data-more', '1');
    var busy = false, done = false;
    host._items = function () { return Array.prototype.slice.call(container.children); };
    host._loadMore = function () {
      if (busy) return busy;
      if (done) return Promise.resolve([]);
      var p = loadMore();
      if (!p) { done = true; return Promise.resolve([]); }
      busy = p.then(function (cards) {
        busy = false;
        if (!cards || !cards.length) { done = true; return []; }
        (host.add || function (cs) { cs.forEach(function (c) { container.appendChild(c); }); })(cards);
        return cards;
      }, function (e) { busy = false; throw e; });
      return busy;
    };
  };

  UI.loading = function () {
    return h('div.loading', null, h('div.spinner'));
  };

  UI.empty = function (text, sub) {
    return h('div.empty', null, [h('div.empty-title', { text: text }), sub ? h('div.empty-sub', { text: sub }) : null]);
  };

  UI.error = function (e, retry) {
    var btn = h('div.btn.focusable', { text: tr('Повторить') });
    btn._onclick = retry;
    return h('div.empty.row', null, [
      h('div.empty-title', { text: tr('Не удалось загрузить') }),
      h('div.empty-sub', { text: (e && e.message) || tr('Проверьте подключение к интернету') }),
      retry ? btn : null
    ]);
  };

  UI.button = function (label, icon, onClick, cls) {
    var b = h('div.btn.focusable' + (cls ? '.' + cls : ''), { html: (icon ? UI.icon(icon) : '') + '<span>' + U.esc(label) + '</span>' });
    b._onclick = onClick;
    return b;
  };

  // ---------- тосты ----------
  var toastTimer;
  UI.toast = function (text, ms) {
    var t = U.$('#toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2500);
  };

  // ---------- модальное меню (выбор из списка, справа как в YouTube) ----------
  // items: [{label, sub, selected, onSelect}]
  UI.menu = function (title, items, opts) {
    opts = opts || {};
    var list = h('div.menu-list' + (items.some(function (i) { return i.selected; }) ? '' : '.no-checks'), { 'data-group': 'free' });
    var selectedEl = null;
    items.forEach(function (it) {
      var row = h('div.menu-item.focusable' + (it.selected ? '.selected' : ''), null, [
        h('div.menu-check', { html: it.selected ? '&#10003;' : '' }),
        h('div.menu-label', null, [it.label, it.sub ? h('div.menu-sub', { text: it.sub }) : null])
      ]);
      row._onclick = function () {
        App.closeLayer();
        if (it.onSelect) it.onSelect();
      };
      if (it.selected) selectedEl = row;
      list.appendChild(row);
    });
    var panel = h('div.menu-panel' + (opts.cls ? '.' + opts.cls : ''), null, [
      h('div.menu-title', { text: title }),
      h('div.menu-scroll.v-scroll.v-center', null, list)
    ]);
    var overlay = h('div.overlay', null, panel);
    App.openLayer({
      el: overlay,
      root: U.$('#modal-root'),
      focus: selectedEl || list.firstChild
    });
  };

  // Подтверждение
  UI.confirm = function (title, text, okLabel, onOk) {
    var ok = UI.button(okLabel || tr('Да'), null, function () { App.closeLayer(); onOk(); }, 'primary');
    var cancel = UI.button(tr('Отмена'), null, function () { App.closeLayer(); });
    var box = h('div.dialog', null, [
      h('div.dialog-title', { text: title }),
      text ? h('div.dialog-text', { text: text }) : null,
      h('div.dialog-buttons', null, [cancel, ok])
    ]);
    App.openLayer({ el: h('div.overlay.center', null, box), root: U.$('#modal-root'), focus: cancel });
  };

  window.UI = UI;
})();
