#!/usr/bin/env python3
"""Собирает переводы интерфейса: python3 tools/build-i18n.py

tools/strings.tsv     — рус<TAB>укр<TAB>англ (основные языки)
tools/i18n/<код>.tsv  — рус<TAB>перевод (остальные языки twitch.tv)

На выходе js/i18n/<код>.js — по файлу на язык (ТВ грузит только нужный).
Проверяет, что у каждой строки tr('...') в коде есть перевод на украинский и английский;
для остальных языков недостающие строки берутся из английского (выводится список)."""
import glob, json, os, re, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = {}
for line in open(os.path.join(root, 'tools/strings.tsv'), encoding='utf-8'):
    line = line.rstrip('\n')
    if not line:
        continue
    ru, uk, en = line.split('\t')
    rows[ru] = (uk, en)

used = set()
for f in glob.glob(os.path.join(root, 'js/*.js')):
    for m in re.finditer(r"tr\('((?:[^'\\\n]|\\.)*)'\)", open(f, encoding='utf-8').read()):
        used.add(m.group(1).replace("\\'", "'"))
missing = sorted(used - set(rows))
if missing:
    print('Нет перевода для:', *missing, sep='\n  ')
    sys.exit(1)
unused = sorted(set(rows) - used)
if unused:
    print('Не используются в коде (можно удалить из strings.tsv):', *unused, sep='\n  ')

en = {k: v[1] for k, v in rows.items()}
langs = {'uk': {k: v[0] for k, v in rows.items()}, 'en': en}
for path in sorted(glob.glob(os.path.join(root, 'tools/i18n/*.tsv'))):
    code = os.path.splitext(os.path.basename(path))[0]
    d = {}
    for n, line in enumerate(open(path, encoding='utf-8'), 1):
        line = line.rstrip('\n')
        if not line:
            continue
        parts = line.split('\t')
        if len(parts) != 2:
            print(f'{code}.tsv:{n}: нужно 2 колонки'); sys.exit(1)
        if parts[0] in rows:
            d[parts[0]] = parts[1]
    lack = [k for k in rows if k not in d]
    if lack:
        print(f'{code}: нет {len(lack)} строк — будут на английском')
    langs[code] = {k: d.get(k, en[k]) for k in rows}

os.makedirs(os.path.join(root, 'js/i18n'), exist_ok=True)
for old in glob.glob(os.path.join(root, 'js/i18n/*.js')):
    os.remove(old)
for code, d in langs.items():
    with open(os.path.join(root, f'js/i18n/{code}.js'), 'w', encoding='utf-8') as out:
        out.write('/* Сгенерировано tools/build-i18n.py — не редактировать вручную */\n')
        out.write('window.I18N_DATA[' + json.dumps(code) + '] = ' + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('ok:', len(rows), 'строк,', len(langs) + 1, 'языков')
