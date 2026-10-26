#!/usr/bin/env python3
"""Собирает js/i18n-data.js из tools/strings.tsv (рус<TAB>укр<TAB>англ) и проверяет,
что у каждой строки tr('...') в коде есть перевод: python3 tools/build-i18n.py"""
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

data = {'uk': {k: v[0] for k, v in rows.items()}, 'en': {k: v[1] for k, v in rows.items()}}
with open(os.path.join(root, 'js/i18n-data.js'), 'w', encoding='utf-8') as out:
    out.write('/* Сгенерировано tools/build-i18n.py из tools/strings.tsv — не редактировать вручную */\n')
    out.write('window.I18N_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('ok:', len(rows), 'строк')
