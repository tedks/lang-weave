#!/usr/bin/env python3
"""One-off source conversion; requires the separately SHA-verified wordfreq 3.1.1 wheel.

Read the shipped {fr,en} array on stdin and write deterministic CSV on stdout.
This is deliberately outside build.mjs: ordinary builds use only committed inputs.
"""
import csv
import json
import re
import sys
from importlib.metadata import version

from wordfreq import zipf_frequency

if version('wordfreq') != '3.1.1':
    raise SystemExit('wordfreq 3.1.1 required')

words = json.load(sys.stdin)
writer = csv.writer(sys.stdout, lineterminator='\n')
writer.writerow(['fr', 'zipf_es', 'zipf_en', 'target_zipf_en', 'band'])
for index, word in enumerate(words):
    target = re.sub(r'^(el|la|los|las) ', '', word['fr'])
    english = re.sub(r'\s*\([^)]*\)', '', word['en'].split('/')[0]).strip()
    english = re.sub(r'^(the|a|an|to) ', '', english)
    es = zipf_frequency(target, 'es', wordlist='large')
    en = zipf_frequency(english, 'en', wordlist='large')
    target_en = zipf_frequency(target, 'en', wordlist='large')
    score = min(es, en)
    band = 0 if index < 30 else 1 if score >= 5.5 else 2 if score >= 4.5 else 3 if score >= 3.5 else 4
    writer.writerow([word['fr'], f'{es:.2f}', f'{en:.2f}', f'{target_en:.2f}', band])
