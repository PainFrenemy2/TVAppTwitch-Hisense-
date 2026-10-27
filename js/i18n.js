/* Языки интерфейса — те же, что у twitch.tv. Исходные строки — на русском, переводы — в js/i18n/<код>.js
   (собираются tools/build-i18n.py). Грузится только файл выбранного языка. Язык ТВ определяется сам. */
(function () {
  'use strict';

  var I18N = {};

  // [код, название на самом языке]
  I18N.LANGS = [
    ['ru', 'Русский'], ['uk', 'Українська'], ['en', 'English'], ['bg', 'Български'], ['cs', 'Čeština'], ['da', 'Dansk'],
    ['de', 'Deutsch'], ['el', 'Ελληνικά'], ['es', 'Español'], ['fi', 'Suomi'], ['fr', 'Français'], ['hu', 'Magyar'],
    ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['nl', 'Nederlands'], ['no', 'Norsk'], ['pl', 'Polski'],
    ['pt', 'Português'], ['ro', 'Română'], ['sk', 'Slovenčina'], ['sv', 'Svenska'], ['th', 'ภาษาไทย'], ['tr', 'Türkçe'],
    ['vi', 'Tiếng Việt'], ['zh-cn', '中文 简体'], ['zh-tw', '中文 繁體']
  ];
  var CODES = {};
  I18N.LANGS.forEach(function (l) { CODES[l[0]] = 1; });

  // Язык телевизора → один из поддерживаемых
  I18N.tvLang = function () {
    var l = String(navigator.language || navigator.userLanguage || 'en').toLowerCase().replace('_', '-');
    if (/^(be|kk)/.test(l)) return 'ru';
    if (/^(nb|nn)/.test(l)) return 'no';
    if (/^zh-(tw|hk|mo|hant)/.test(l)) return 'zh-tw';
    if (l.indexOf('zh') === 0) return 'zh-cn';
    var base = l.split('-')[0];
    return CODES[base] ? base : 'en';
  };

  var saved = U.store.get('settings', {}).uiLang;
  I18N.lang = saved && CODES[saved] ? saved : I18N.tvLang();
  document.documentElement.lang = I18N.lang;

  // Подключаем переводы до следующих скриптов (document.write во время разбора страницы — синхронно)
  window.I18N_DATA = window.I18N_DATA || {};
  if (I18N.lang !== 'ru') {
    document.write('<script src="js/i18n/' + I18N.lang + '.js?v=' + (window.APP_V || '10') + '"><\/script>');
  }

  // английский — запасной перевод для строк, которых ещё нет на выбранном языке (собирается в каждый файл)
  I18N.dict = function () { return window.I18N_DATA[I18N.lang] || null; };

  // tr("русская строка") → перевод на язык интерфейса
  window.tr = function (s) {
    var d = I18N.dict();
    return d && d[s] !== undefined ? d[s] : s;
  };

  // Множественное число по правилам языка; forms — 1, 2 или 3 формы
  I18N.plural = function (n, forms) {
    n = Math.abs(Math.floor(n));
    var L = I18N.lang, n10 = n % 10, n100 = n % 100;
    if (forms.length === 1) return forms[0];
    if (L === 'ru' || L === 'uk') {
      if (n100 > 10 && n100 < 20) return forms[2];
      if (n10 > 1 && n10 < 5) return forms[1];
      if (n10 === 1) return forms[0];
      return forms[2];
    }
    if (L === 'pl') {
      if (n === 1) return forms[0];
      if (n10 > 1 && n10 < 5 && !(n100 > 11 && n100 < 15)) return forms[1];
      return forms[2];
    }
    if (L === 'cs' || L === 'sk') return n === 1 ? forms[0] : (n > 1 && n < 5 ? forms[1] : forms[2]);
    if (L === 'ro') return n === 1 ? forms[0] : (n === 0 || (n100 > 0 && n100 < 20) ? forms[1] : forms[2]);
    if (L === 'fr') return n <= 1 ? forms[0] : forms[1];
    return n === 1 ? forms[0] : forms[1];
  };

  // Слова для чисел и «… назад». pre/ago — до и после числа (в немецком «vor 5 Minuten»).
  // units: год, месяц, неделя, день, час, минута
  var WORDS = {
    ru: { viewer: ['зритель', 'зрителя', 'зрителей'], view: ['просмотр', 'просмотра', 'просмотров'], k: ' тыс.', m: ' млн', now: 'только что', ago: ' назад',
      units: [['год', 'года', 'лет'], ['месяц', 'месяца', 'месяцев'], ['неделю', 'недели', 'недель'], ['день', 'дня', 'дней'], ['час', 'часа', 'часов'], ['минуту', 'минуты', 'минут']] },
    uk: { viewer: ['глядач', 'глядачі', 'глядачів'], view: ['перегляд', 'перегляди', 'переглядів'], k: ' тис.', m: ' млн', now: 'щойно', ago: ' тому',
      units: [['рік', 'роки', 'років'], ['місяць', 'місяці', 'місяців'], ['тиждень', 'тижні', 'тижнів'], ['день', 'дні', 'днів'], ['годину', 'години', 'годин'], ['хвилину', 'хвилини', 'хвилин']] },
    en: { viewer: ['viewer', 'viewers'], view: ['view', 'views'], k: 'K', m: 'M', now: 'just now', ago: ' ago',
      units: [['year', 'years'], ['month', 'months'], ['week', 'weeks'], ['day', 'days'], ['hour', 'hours'], ['minute', 'minutes']] },
    bg: { viewer: ['зрител', 'зрители'], view: ['гледане', 'гледания'], k: ' хил.', m: ' млн', now: 'току-що', pre: 'преди ', ago: '',
      units: [['година', 'години'], ['месец', 'месеца'], ['седмица', 'седмици'], ['ден', 'дни'], ['час', 'часа'], ['минута', 'минути']] },
    cs: { viewer: ['divák', 'diváci', 'diváků'], view: ['zhlédnutí', 'zhlédnutí', 'zhlédnutí'], k: ' tis.', m: ' mil.', now: 'právě teď', pre: 'před ', ago: '',
      units: [['rokem', 'lety', 'lety'], ['měsícem', 'měsíci', 'měsíci'], ['týdnem', 'týdny', 'týdny'], ['dnem', 'dny', 'dny'], ['hodinou', 'hodinami', 'hodinami'], ['minutou', 'minutami', 'minutami']] },
    da: { viewer: ['seer', 'seere'], view: ['visning', 'visninger'], k: ' t', m: ' mio.', now: 'lige nu', pre: 'for ', ago: ' siden',
      units: [['år', 'år'], ['måned', 'måneder'], ['uge', 'uger'], ['dag', 'dage'], ['time', 'timer'], ['minut', 'minutter']] },
    de: { viewer: ['Zuschauer', 'Zuschauer'], view: ['Aufruf', 'Aufrufe'], k: ' Tsd.', m: ' Mio.', now: 'gerade eben', pre: 'vor ', ago: '',
      units: [['Jahr', 'Jahren'], ['Monat', 'Monaten'], ['Woche', 'Wochen'], ['Tag', 'Tagen'], ['Stunde', 'Stunden'], ['Minute', 'Minuten']] },
    el: { viewer: ['θεατής', 'θεατές'], view: ['προβολή', 'προβολές'], k: ' χιλ.', m: ' εκ.', now: 'μόλις τώρα', pre: 'πριν από ', ago: '',
      units: [['έτος', 'έτη'], ['μήνα', 'μήνες'], ['εβδομάδα', 'εβδομάδες'], ['ημέρα', 'ημέρες'], ['ώρα', 'ώρες'], ['λεπτό', 'λεπτά']] },
    es: { viewer: ['espectador', 'espectadores'], view: ['visualización', 'visualizaciones'], k: ' mil', m: ' M', now: 'ahora mismo', pre: 'hace ', ago: '',
      units: [['año', 'años'], ['mes', 'meses'], ['semana', 'semanas'], ['día', 'días'], ['hora', 'horas'], ['minuto', 'minutos']] },
    fi: { viewer: ['katsoja', 'katsojaa'], view: ['katselukerta', 'katselukertaa'], k: ' t.', m: ' milj.', now: 'juuri nyt', ago: ' sitten',
      units: [['vuosi', 'vuotta'], ['kuukausi', 'kuukautta'], ['viikko', 'viikkoa'], ['päivä', 'päivää'], ['tunti', 'tuntia'], ['minuutti', 'minuuttia']] },
    fr: { viewer: ['spectateur', 'spectateurs'], view: ['vue', 'vues'], k: ' k', m: ' M', now: 'à l’instant', pre: 'il y a ', ago: '',
      units: [['an', 'ans'], ['mois', 'mois'], ['semaine', 'semaines'], ['jour', 'jours'], ['heure', 'heures'], ['minute', 'minutes']] },
    hu: { viewer: ['néző'], view: ['megtekintés'], k: ' E', m: ' M', now: 'épp most', ago: '',
      units: [['éve'], ['hónapja'], ['hete'], ['napja'], ['órája'], ['perce']] },
    it: { viewer: ['spettatore', 'spettatori'], view: ['visualizzazione', 'visualizzazioni'], k: ' mila', m: ' Mln', now: 'proprio ora', ago: ' fa',
      units: [['anno', 'anni'], ['mese', 'mesi'], ['settimana', 'settimane'], ['giorno', 'giorni'], ['ora', 'ore'], ['minuto', 'minuti']] },
    ja: { viewer: ['人の視聴者'], view: ['回視聴'], wan: '万', now: 'たった今', ago: '前', sep: '',
      units: [['年'], ['か月'], ['週間'], ['日'], ['時間'], ['分']] },
    ko: { viewer: ['명 시청 중'], view: ['회 시청'], wan: '만', now: '방금', ago: ' 전', sep: '',
      units: [['년'], ['개월'], ['주'], ['일'], ['시간'], ['분']] },
    nl: { viewer: ['kijker', 'kijkers'], view: ['weergave', 'weergaven'], k: 'K', m: ' mln', now: 'zojuist', ago: ' geleden',
      units: [['jaar', 'jaar'], ['maand', 'maanden'], ['week', 'weken'], ['dag', 'dagen'], ['uur', 'uur'], ['minuut', 'minuten']] },
    no: { viewer: ['seer', 'seere'], view: ['visning', 'visninger'], k: 'k', m: ' mill.', now: 'akkurat nå', ago: ' siden',
      units: [['år', 'år'], ['måned', 'måneder'], ['uke', 'uker'], ['dag', 'dager'], ['time', 'timer'], ['minutt', 'minutter']] },
    pl: { viewer: ['widz', 'widzów', 'widzów'], view: ['wyświetlenie', 'wyświetlenia', 'wyświetleń'], k: ' tys.', m: ' mln', now: 'przed chwilą', ago: ' temu',
      units: [['rok', 'lata', 'lat'], ['miesiąc', 'miesiące', 'miesięcy'], ['tydzień', 'tygodnie', 'tygodni'], ['dzień', 'dni', 'dni'], ['godzinę', 'godziny', 'godzin'], ['minutę', 'minuty', 'minut']] },
    pt: { viewer: ['espectador', 'espectadores'], view: ['visualização', 'visualizações'], k: ' mil', m: ' mi', now: 'agora mesmo', pre: 'há ', ago: '',
      units: [['ano', 'anos'], ['mês', 'meses'], ['semana', 'semanas'], ['dia', 'dias'], ['hora', 'horas'], ['minuto', 'minutos']] },
    ro: { viewer: ['spectator', 'spectatori', 'de spectatori'], view: ['vizualizare', 'vizualizări', 'de vizualizări'], k: ' K', m: ' mil.', now: 'chiar acum', pre: 'acum ', ago: '',
      units: [['an', 'ani', 'de ani'], ['lună', 'luni', 'de luni'], ['săptămână', 'săptămâni', 'de săptămâni'], ['zi', 'zile', 'de zile'], ['oră', 'ore', 'de ore'], ['minut', 'minute', 'de minute']] },
    sk: { viewer: ['divák', 'diváci', 'divákov'], view: ['zhliadnutie', 'zhliadnutia', 'zhliadnutí'], k: ' tis.', m: ' mil.', now: 'práve teraz', pre: 'pred ', ago: '',
      units: [['rokom', 'rokmi', 'rokmi'], ['mesiacom', 'mesiacmi', 'mesiacmi'], ['týždňom', 'týždňami', 'týždňami'], ['dňom', 'dňami', 'dňami'], ['hodinou', 'hodinami', 'hodinami'], ['minútou', 'minútami', 'minútami']] },
    sv: { viewer: ['tittare', 'tittare'], view: ['visning', 'visningar'], k: ' tn', m: ' mn', now: 'just nu', pre: 'för ', ago: ' sedan',
      units: [['år', 'år'], ['månad', 'månader'], ['vecka', 'veckor'], ['dag', 'dagar'], ['timme', 'timmar'], ['minut', 'minuter']] },
    th: { viewer: ['ผู้ชม'], view: ['ครั้ง'], k: 'K', m: 'M', now: 'เมื่อสักครู่', ago: 'ที่แล้ว',
      units: [['ปี'], ['เดือน'], ['สัปดาห์'], ['วัน'], ['ชั่วโมง'], ['นาที']] },
    tr: { viewer: ['izleyici'], view: ['görüntüleme'], k: ' B', m: ' Mn', now: 'az önce', ago: ' önce',
      units: [['yıl'], ['ay'], ['hafta'], ['gün'], ['saat'], ['dakika']] },
    vi: { viewer: ['người xem'], view: ['lượt xem'], k: ' N', m: ' Tr', now: 'vừa xong', ago: ' trước',
      units: [['năm'], ['tháng'], ['tuần'], ['ngày'], ['giờ'], ['phút']] },
    'zh-cn': { viewer: ['位观众'], view: ['次观看'], wan: '万', now: '刚刚', ago: '前', sep: '',
      units: [['年'], ['个月'], ['周'], ['天'], ['小时'], ['分钟']] },
    'zh-tw': { viewer: ['位觀眾'], view: ['次觀看'], wan: '萬', now: '剛剛', ago: '前', sep: '',
      units: [['年'], ['個月'], ['週'], ['天'], ['小時'], ['分鐘']] }
  };
  I18N.words = function () { return WORDS[I18N.lang] || WORDS.en; };

  window.I18N = I18N;
})();
