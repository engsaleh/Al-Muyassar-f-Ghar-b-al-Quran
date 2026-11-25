#!/usr/bin/env python3
"""Rebuild the reviewed glossary-to-Mushaf index without changing source texts.

Default behavior is a read-only comparison against dist/data/glossary-links.json.
Use --output PATH to write an explicitly selected artifact. Python 3.10+; stdlib only.
"""
import argparse
import collections
import csv
import difflib
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
CSV = PROJECT / 'source-data/muyassar-of-ghareeb-al-quran-11.csv'
MUSHAF = PROJECT / 'source-data/mushaf/hafs.json'
OUT = PROJECT / 'dist/data/glossary-links.json'
EXPECTED_CSV_SHA256 = '2b08544e6ea2482399fe87d7330ad7db8584c0d078b2bc9302cbdb44d643b297'
EXPECTED_MUSHAF_SHA256 = 'bcfe3e9f2f3a9a57428c503c67667a5f32c2779ce20e90c7e553fae54a4abd26'


def parse_source_glosses(rows):
    """Parse original CSV rows; never strip or rewrite their text/words fields."""
    parsed = []
    seen_references = set()
    for row in rows:
        surah, ayah = int(row['surah']), int(row['ayah'])
        reference = f'{surah}:{ayah}'
        if reference in seen_references:
            raise ValueError(f'Duplicate source verse: {reference}')
        seen_references.add(reference)
        text_lines = row['text'].split('\n') if row['text'] else []
        words_lines = row['words'].split('\n') if row['words'] else []
        if len(text_lines) != len(words_lines):
            raise ValueError(f'Text/words line count mismatch: {reference}')
        for line_number, (raw_text, words_spec) in enumerate(zip(text_lines, words_lines), 1):
            quote_match = re.fullmatch(r'﴿([^﴾]*)﴾: (.*)', raw_text)
            if not quote_match:
                raise ValueError(f'Unexpected glossary line format: {reference}:{line_number}')
            simple = re.fullmatch(r'(\d+)(?:-(\d+))?', words_spec)
            cross = re.fullmatch(r'(\d+):(\d+) - (\d+):(\d+)', words_spec)
            if simple:
                first_word = int(simple[1])
                last_word = int(simple[2] or simple[1])
                first_ayah = last_ayah = ayah
            elif cross:
                first_ayah, first_word, last_ayah, last_word = map(int, cross.groups())
            else:
                raise ValueError(f'Unexpected words range: {reference}:{line_number}: {words_spec!r}')
            if first_ayah > last_ayah or first_word < 1 or last_word < 1:
                raise ValueError(f'Invalid words range: {reference}:{line_number}')
            if first_ayah == last_ayah and first_word > last_word:
                raise ValueError(f'Reversed words range: {reference}:{line_number}')
            parsed.append({
                'id': f'{reference}:{line_number}',
                'sourceReference': reference,
                'sourceLine': line_number,
                'wordsSpec': words_spec,
                'rawText': raw_text,
                'quote': quote_match[1],
                'explanation': quote_match[2],
                'span': {
                    'start': {'surah': surah, 'ayah': first_ayah, 'word': first_word},
                    'end': {'surah': surah, 'ayah': last_ayah, 'word': last_word},
                },
            })
    if len(rows) != 6236 or len(parsed) != 11364:
        raise ValueError('Unexpected pinned-resource row or glossary count')
    return parsed


def build_mapping():
    """Return the complete reviewed mapping; perform no filesystem writes."""
    if hashlib.sha256(CSV.read_bytes()).hexdigest() != EXPECTED_CSV_SHA256:
        raise ValueError('The glossary source changed; review alignment before rebuilding')
    if hashlib.sha256(MUSHAF.read_bytes()).hexdigest() != EXPECTED_MUSHAF_SHA256:
        raise ValueError('The Mushaf source changed; review alignment before rebuilding')
    p = json.loads(MUSHAF.read_text(encoding='utf-8'))
    starts = p['ayah_starts'] + [len(p['words'])]
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        csv_rows = list(csv.DictReader(f))
    source_glosses = parse_source_glosses(csv_rows)
    source_line_map = {f"{r['surah']}:{r['ayah']}:{i+1}": line for r in csv_rows for i,line in enumerate(r['text'].split('\n') if r['text'] else [])}

    def verse_bounds(surah, ayah):
        if not 1 <= surah <= 114 or not 1 <= ayah <= p['surahs'][surah-1]['ayah_count']:
            raise ValueError('Invalid verse reference')
        i = p['surahs'][surah-1]['first_ayah'] + ayah - 1
        return starts[i], starts[i+1]

    def span_indices(span):
        b, e = span['start'], span['end']
        assert b['surah'] == e['surah'] and b['ayah'] <= e['ayah']
        result = []
        for ayah in range(b['ayah'], e['ayah']+1):
            lo, hi = verse_bounds(b['surah'], ayah)
            first = b['word'] if ayah == b['ayah'] else 1
            last = e['word'] if ayah == e['ayah'] else hi-lo
            assert 1 <= first <= last <= hi-lo, (span,hi-lo)
            result.extend(range(lo+first-1,lo+last))
        return result

    # These functions produce comparison strings only. They never touch stored or displayed text.
    LEGACY_SIGNS = str.maketrans({'ٗ':'ً','ࣰ':'ً','ٞ':'ٌ','ࣱ':'ٌ','ٖ':'ٍ','ࣲ':'ٍ','ۡ':'ْ','ٱ':'ا','۞':'','ـ':''})
    def compare_surface(text):
        return re.sub(r'\s+','',unicodedata.normalize('NFD',text.translate(LEGACY_SIGNS)))
    def compare_letters(text):
        return ''.join(c for c in compare_surface(text) if not unicodedata.category(c).startswith('M') and c not in '\u06e5\u06e6')

    review_notes = []
    links = collections.defaultdict(list)
    glosses = []
    methods = collections.Counter()
    for item in source_glosses:
        assert item['rawText'] == source_line_map[item['id']]
        indices = span_indices(item['span'])
        original_indices = indices[:]
        actual = ' '.join(p['words'][i] for i in indices)
        quote = item['quote']
        gloss = {k: item[k] for k in ['id','sourceReference','sourceLine','wordsSpec','rawText']}
        method = None
        status = 'verified'

        if item['id'] == '2:138:2':
            start,end = verse_bounds(2,138)
            corrected = start+6
            assert indices == [2453] and corrected == 2459
            assert p['words'][corrected] == 'صِبۡغَةࣰ'
            assert compare_surface(quote) == compare_surface(p['words'][corrected])
            assert compare_surface(quote) != compare_surface(actual)
            indices = [corrected]
            method = 'reviewed-position-override'
            status = 'verified-position-override'
            gloss['declaredWordIndices'] = original_indices
            review_notes.append({'id':item['id'],'kind':'position-override','sourceReference':item['sourceReference'],'sourceLine':item['sourceLine'],'wordsSpec':item['wordsSpec'],'originalWordIndices':original_indices,'wordIndices':indices,'sourceQuote':quote,'declaredText':actual,'matchedText':p['words'][corrected],'reason':'الموضع المعلن 1 يحمل صِبۡغَةَ، بينما الاقتباس المضبوط صِبۡغَةٗ يطابق الكلمة 7 وحدها بعد توحيد رموز التنوين للمقارنة. صحّحت طبقة الربط فقط، وبقي نص المورد وحقل words الأصلي كما هما.'})
        elif item['id'] in {'2:236:7','30:54:3'}:
            indices = []
            method = 'ambiguous-repeated-word'
            status = 'review-required'
            gloss['declaredWordIndices'] = original_indices
            if item['id'] == '2:236:7':
                candidates = [4703,4706]
                assert all(p['words'][i] == 'قَدَرُهُۥ' for i in candidates)
                reason = 'حقل words يشير إلى الكلمة 17، وترتيب أسطر الشرح بعد الكلمة 19 يرجّح 20، لكن قَدَرُهُۥ متطابقة حرفيًا في الموضعين ولا يكفي النص لحسم المقصود. حُفظ السطر للمراجعة ولم يُربط آليًا. الكلمة 17 لها شرح العبارة 15–17 من سطر مستقل موثوق.'
            else:
                candidates = [52722,52727]
                assert p['words'][candidates[0]] == 'قُوَّةࣰ' and p['words'][candidates[1]] == 'قُوَّةࣲ'
                reason = 'حقل words يشير إلى الكلمة 11 قُوَّةࣰ، بينما ضبط الاقتباس قُوَّةٖ يطابق الكلمة 16 قُوَّةࣲ. ترتيب الشروح والمعنى العام لا يحسمان إن كان المقصود خطأً في الضبط أو في الموضع. حُفظ السطر للمراجعة ولم يُنقل إلى موضع آخر بالتخمين.'
            review_notes.append({'id':item['id'],'kind':'unresolved-ambiguity','sourceReference':item['sourceReference'],'sourceLine':item['sourceLine'],'wordsSpec':item['wordsSpec'],'originalWordIndices':original_indices,'candidateWordIndices':candidates,'sourceQuote':quote,'candidateTexts':[p['words'][i] for i in candidates],'reason':reason})
        elif compare_surface(quote) == compare_surface(actual):
            method = 'surface-equivalent'
        elif compare_letters(quote) == compare_letters(actual):
            # The declared range has identical letters. Differences were audited below as
            # liaison shaddah/kasrah, madd/silah, dagger alif or Quranic reading signs.
            eq,ea = compare_surface(quote),compare_surface(actual)
            differences = [(tag,eq[i:j],ea[u:v]) for tag,i,j,u,v in difflib.SequenceMatcher(None,eq,ea).get_opcodes() if tag != 'equal']
            approved = {
                (("insert", "", "ّ"),), (("delete", "ّ", ""),),
                (("insert", "", "ٓ"),), (("insert", "", "ِ"),),
                (("insert", "", "ۥ"),), (("insert", "", "ٰ"),),
                (("delete", "ٰ", ""),), (("replace", "ۜ", "ۣ"),),
                (("delete", "ِ", ""),), (("delete", "ۜ", ""),)
            }
            assert tuple(differences) in approved, (item['id'],differences)
            method = 'audited-diacritic-variant'
        elif compare_letters(actual) == 'و' + compare_letters(quote):
            # 76 source quotations omit only the initial conjunction waw. The original
            # declared token positions still identify the complete printed word(s).
            method = 'source-omits-leading-waw'
        elif item['id'] == '2:72:1':
            assert quote == 'فَٱدَّٰرَٰٔتُمۡ' and actual == 'فَٱدَّٰرَٰءۡتُمۡ'
            method = 'audited-hamza-encoding-variant'
            review_notes.append({'id':item['id'],'kind':'comparison-encoding','sourceQuote':quote,'matchedText':actual,'reason':'همزة فوق الألف في الاقتباس مقابل همزة مفردة في الإصدار الأحدث. أُجيز الموضع المعلن بعد فحص الكلمة؛ لم يُعدّل النص.'})
        elif item['id'] == '3:75:3':
            assert quote == '\\ٱلۡأُمِّيِّـۧنَ' and actual == 'ٱلۡأُمِّيِّـۧنَ'
            method = 'audited-source-punctuation'
            review_notes.append({'id':item['id'],'kind':'source-typography','sourceQuote':quote,'matchedText':actual,'reason':'شرطة مائلة عكسية زائدة داخل اقتباس المصدر؛ أحرف الكلمة تطابق الموضع المعلن. بقي السطر الأصلي حرفيًا.'})
        elif item['id'] == '5:66:3':
            assert quote == 'مُقۡتَصِدَةٞ.' and actual == 'مُّقۡتَصِدَةࣱ'
            method = 'audited-source-punctuation'
            review_notes.append({'id':item['id'],'kind':'source-typography','sourceQuote':quote,'matchedText':actual,'reason':'نقطة داخل اقتباس المصدر؛ أحرف الكلمة تطابق الموضع المعلن مع اختلاف شدة السياق ورمز التنوين. بقي السطر الأصلي حرفيًا.'})
        else:
            raise AssertionError((item['id'],quote,actual))
        gloss['wordIndices'] = indices
        gloss['status'] = status
        gloss['matchMethod'] = method
        methods[method] += 1
        for word_index in indices:
            assert 0 <= word_index < len(p['words'])
            links[str(word_index)].append(item['id'])
        glosses.append(gloss)

    id_map = {g['id']:g for g in glosses}
    assert len(id_map) == len(glosses) == 11364
    assert all(g['rawText'] == source_line_map[g['id']] for g in glosses)
    assert all(g['status'] != 'review-required' or g['wordIndices'] == [] for g in glosses)
    assert all(id_map[gid]['status'].startswith('verified') for ids in links.values() for gid in ids)
    assert len([g for g in glosses if g['status']=='review-required']) == 2
    assert set(links['2453']) == {'2:138:1'} and links['2459'] == ['2:138:2']
    assert '2:236:7' not in {gid for ids in links.values() for gid in ids}
    for gid in ['42:1:1','53:19:1']:
        assert len(id_map[gid]['wordIndices']) == (2 if gid == '42:1:1' else 3)

    metadata = {
        'schemaVersion':1,
        'generatedAt':datetime.now(timezone.utc).isoformat(),
        'glossarySource':'https://storage.cms.itqan.dev/media/uploads/assets/145/versions/317/muyassar-of-ghareeb-al-quran-11.csv',
        'glossaryVersion':'1.1.0',
        'glossarySha256':hashlib.sha256(CSV.read_bytes()).hexdigest(),
        'mushafSource':'https://text.quran.ws/files/mushaf/hafs.json',
        'mushafSha256':hashlib.sha256(MUSHAF.read_bytes()).hexdigest(),
        'indexBase':0,
        'mushafWordCount':len(p['words']),
        'glossCount':len(glosses),
        'linkedGlossCount':sum(bool(g['wordIndices']) for g in glosses),
        'highlightedWordCount':len(links),
        'wordAssignmentCount':sum(len(ids) for ids in links.values()),
        'reviewRequiredCount':2,
        'positionOverrideCount':1,
        'crossVerseGlossCount':2,
        'wordsWithMultipleGlosses':sum(len(ids)>1 for ids in links.values()),
        'matchMethods':dict(methods),
        'policy':'تعرض النصوص الأصلية دون تعديل. الربط قائم على نطاقات المورد وفحص الكلمات؛ توحيد الرموز خاص بالمقارنة فقط. التصحيح الوحيد لطبقة المواضع موثق، والشروح الملتبسة مستبعدة من الربط الآلي حتى مراجعتها.'
    }
    result = {'metadata':metadata,'glosses':glosses,'wordLinks':dict(links),'reviewNotes':review_notes}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Verify the existing artifact without writing (default)')
    mode.add_argument('--output', type=Path, help='Write a rebuilt artifact to this explicit path; relative paths use the repository root')
    args = parser.parse_args()
    if not __debug__:
        parser.error('Run without -O: the reviewed alignment assertions must remain enabled')
    result = build_mapping()
    if args.output is None:
        if not OUT.is_file():
            raise ValueError(f'Existing mapping is missing: {OUT}')
        existing = json.loads(OUT.read_text(encoding='utf-8'))
        # Build time does not change the mapping. All other metadata, provenance,
        # raw source strings, word indices, review notes and statuses must match.
        result['metadata']['generatedAt'] = existing.get('metadata', {}).get('generatedAt')
        if result != existing:
            sections = [key for key in sorted(set(result) | set(existing)) if result.get(key) != existing.get(key)]
            raise ValueError('Existing mapping differs from reviewed sources/rules in: ' + ', '.join(sections))
        print(json.dumps({'status': 'verified', 'written': False, 'glossCount': result['metadata']['glossCount'], 'linkedGlossCount': result['metadata']['linkedGlossCount'], 'highlightedWordCount': result['metadata']['highlightedWordCount'], 'reviewRequiredCount': result['metadata']['reviewRequiredCount']}, ensure_ascii=False))
        return 0
    destination = args.output if args.output.is_absolute() else PROJECT / args.output
    destination = destination.resolve()
    if destination in {CSV.resolve(), MUSHAF.resolve()}:
        raise ValueError('Output cannot replace an original source file')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    reloaded = json.loads(destination.read_text(encoding='utf-8'))
    if result != reloaded:
        raise ValueError('Saved artifact failed round-trip verification')
    print(json.dumps({'status': 'written', 'path': str(destination), 'glossCount': len(result['glosses']), 'highlightedWordCount': len(result['wordLinks'])}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (AssertionError, ValueError, OSError, KeyError) as error:
        print(f'Glossary alignment verification failed: {error}', file=sys.stderr)
        raise SystemExit(1)
