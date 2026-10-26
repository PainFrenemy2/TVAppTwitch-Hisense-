/* Языки интерфейса: русский (исходный), украинский, английский. Язык ТВ определяется сам. */
(function () {
  'use strict';

  var I18N = {};

  // Язык телевизора → один из поддерживаемых
  I18N.tvLang = function () {
    var l = String(navigator.language || navigator.userLanguage || 'ru').toLowerCase();
    if (l.indexOf('uk') === 0) return 'uk';
    if (/^(ru|be|kk)/.test(l)) return 'ru';
    return 'en';
  };

  var saved = U.store.get('settings', {}).uiLang;
  I18N.lang = saved || I18N.tvLang();
  document.documentElement.lang = I18N.lang;

  I18N.dict = function () { return (window.I18N_DATA && window.I18N_DATA[I18N.lang]) || null; };

  // tr("русская строка") → перевод на язык интерфейса
  window.tr = function (s) {
    var d = I18N.dict();
    return d && d[s] !== undefined ? d[s] : s;
  };

  // Множественное число: ru/uk — 3 формы, en — 2
  I18N.plural = function (n, forms) {
    n = Math.abs(Math.floor(n));
    if (I18N.lang === 'en') return n === 1 ? forms[0] : forms[1];
    var n10 = n % 10, n100 = n % 100;
    if (n100 > 10 && n100 < 20) return forms[2];
    if (n10 > 1 && n10 < 5) return forms[1];
    if (n10 === 1) return forms[0];
    return forms[2];
  };

  var WORDS = {
    ru: { viewer: ['зритель', 'зрителя', 'зрителей'], view: ['просмотр', 'просмотра', 'просмотров'],
      k: ' тыс.', m: ' млн', now: 'только что', ago: ' назад',
      units: [['год', 'года', 'лет'], ['месяц', 'месяца', 'месяцев'], ['неделю', 'недели', 'недель'], ['день', 'дня', 'дней'], ['час', 'часа', 'часов'], ['минуту', 'минуты', 'минут']] },
    uk: { viewer: ['глядач', 'глядачі', 'глядачів'], view: ['перегляд', 'перегляди', 'переглядів'],
      k: ' тис.', m: ' млн', now: 'щойно', ago: ' тому',
      units: [['рік', 'роки', 'років'], ['місяць', 'місяці', 'місяців'], ['тиждень', 'тижні', 'тижнів'], ['день', 'дні', 'днів'], ['годину', 'години', 'годин'], ['хвилину', 'хвилини', 'хвилин']] },
    en: { viewer: ['viewer', 'viewers'], view: ['view', 'views'],
      k: 'K', m: 'M', now: 'just now', ago: ' ago',
      units: [['year', 'years'], ['month', 'months'], ['week', 'weeks'], ['day', 'days'], ['hour', 'hours'], ['minute', 'minutes']] }
  };
  I18N.words = function () { return WORDS[I18N.lang] || WORDS.ru; };

  window.I18N = I18N;
})();
