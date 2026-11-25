import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  buildMushafIndex, pageForWord, verseForWord,
  renderWordText, pageRows, parseMushafLocation,
} from '../dist/mushaf-core.js';

const pythonExecutable = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const pythonEnvironment = {...process.env, PYTHONIOENCODING: 'utf-8'};
const root = new URL('../', import.meta.url);
const readJSON = name => JSON.parse(readFileSync(new URL(`dist/data/${name}`, root), 'utf8'));
const mushaf = readJSON('mushaf.json');
const layout = readJSON('page-lines.json');
const glossary = readJSON('glossary-links.json');
const source = readJSON('mushaf-source.json');
const entries = readJSON('entries.json');
const index = buildMushafIndex(mushaf, layout, glossary);
const entryMap = new Map(entries.records.map(entry => [`${entry.surah}:${entry.ayah}`, entry]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('all 77,432 original words appear exactly once across all 604 printed pages', () => {
  assert.equal(mushaf.words.length, 77432);
  assert.equal(layout.pages.length, 604);
  const coverage = new Uint8Array(mushaf.words.length);
  let nextWord = 0;
  let textLineCount = 0;
  let displayedVerseEnds = 0;
  for (let pageNumber = 1; pageNumber <= 604; pageNumber++) {
    const rows = pageRows(index, pageNumber);
    const expectedRows = pageNumber <= 2 ? 8 : 15;
    assert.equal(rows.length, expectedRows, `Page ${pageNumber} printed row count`);
    assert.deepEqual(rows.map(row => row.line), Array.from({length: expectedRows}, (_, i) => i + 1));
    assert.equal(nextWord, mushaf.page_starts[pageNumber - 1]);
    for (const row of rows.filter(row => row.kind === 'text')) {
      textLineCount++;
      assert.equal(row.firstWord, nextWord);
      for (let word = row.firstWord; word < row.lastWordExclusive; word++) {
        coverage[word]++;
        assert.equal(pageForWord(index, word), pageNumber);
        if (index.verseEnds.has(word)) displayedVerseEnds++;
      }
      nextWord = row.lastWordExclusive;
    }
    assert.equal(nextWord, mushaf.page_starts[pageNumber] ?? 77432);
  }
  assert.equal(nextWord, 77432);
  assert.equal(textLineCount, 8820);
  assert.equal(displayedVerseEnds, 6236);
  assert.ok(coverage.every(count => count === 1));
});

test('every Quran word belongs to exactly one of the 6,236 verse boundaries', () => {
  assert.equal(index.verses.length, 6236);
  assert.equal(index.verseMap.size, 6236);
  assert.equal(index.verseEnds.size, 6236);
  const coverage = new Uint8Array(77432);
  for (const verse of index.verses) {
    assert.equal(verse.start, mushaf.ayah_starts[verse.ordinal]);
    assert.equal(verse.end, mushaf.ayah_starts[verse.ordinal + 1] ?? 77432);
    assert.ok(verse.end > verse.start);
    assert.equal(index.verseEnds.get(verse.end - 1), verse);
    assert.equal(verseForWord(index, verse.start), verse);
    assert.equal(verseForWord(index, verse.end - 1), verse);
    for (let word = verse.start; word < verse.end; word++) coverage[word]++;
  }
  assert.ok(coverage.every(count => count === 1));
  assert.equal(verseForWord(index, 0).key, '1:1');
  assert.equal(verseForWord(index, 77431).key, '114:6');
  assert.equal(verseForWord(index, -1), null);
  assert.equal(verseForWord(index, 77432), null);
});

test('each of the 11,364 glosses preserves the precise raw text and words spec from the original CSV', () => {
  const csvPath = fileURLToPath(new URL('source-data/muyassar-of-ghareeb-al-quran-11.csv', root));
  const original = JSON.parse(execFileSync(pythonExecutable, ['-X', 'utf8', '-c', [
    'import csv,json,sys',
    "with open(sys.argv[1], encoding='utf-8-sig', newline='') as f:",
    '    rows = list(csv.DictReader(f))',
    "result = [{'surah':int(r['surah']), 'ayah':int(r['ayah']), 'text':r['text'], 'words':r['words']} for r in rows]",
    'print(json.dumps(result, ensure_ascii=False))',
  ].join('\n'), csvPath], {encoding: 'utf8', env: pythonEnvironment, maxBuffer: 20 * 1024 * 1024}));
  assert.deepEqual(entries.records, original);
  assert.equal(glossary.glosses.length, 11364);
  let expectedGlossCount = 0;
  for (const entry of original) if (entry.text) expectedGlossCount += entry.text.split('\n').length;
  assert.equal(expectedGlossCount, 11364);
  const seenLines = new Set();
  for (const gloss of glossary.glosses) {
    const entry = entryMap.get(gloss.sourceReference);
    assert.ok(entry, gloss.id);
    assert.equal(gloss.rawText, entry.text.split('\n')[gloss.sourceLine - 1], `${gloss.id} text`);
    assert.equal(gloss.wordsSpec, entry.words.split('\n')[gloss.sourceLine - 1], `${gloss.id} words`);
    const lineKey = `${gloss.sourceReference}:${gloss.sourceLine}`;
    assert.equal(seenLines.has(lineKey), false, lineKey);
    seenLines.add(lineKey);
  }
  assert.equal(seenLines.size, expectedGlossCount);
});

test('only verified associations highlight words, and both review-required glosses remain excluded', () => {
  assert.equal(index.wordLinks.size, 18064);
  assert.equal(glossary.metadata.highlightedWordCount, 18064);
  assert.equal(glossary.metadata.linkedGlossCount, 11362);
  const review = glossary.glosses.filter(gloss => gloss.status === 'review-required');
  assert.deepEqual(review.map(gloss => gloss.id).sort(), ['2:236:7', '30:54:3']);
  const linkedIds = new Set();
  let assignments = 0;
  for (const [word, ids] of index.wordLinks) {
    assert.ok(Number.isInteger(word) && word >= 0 && word < 77432);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      const gloss = index.glossMap.get(id);
      assert.ok(['verified', 'verified-position-override'].includes(gloss.status), id);
      assert.ok(gloss.wordIndices.includes(word), id);
      linkedIds.add(id);
      assignments++;
    }
  }
  assert.equal(assignments, 18066);
  assert.equal(linkedIds.size, 11362);
  for (const gloss of review) {
    assert.deepEqual(gloss.wordIndices, []);
    assert.equal(linkedIds.has(gloss.id), false);
    assert.ok(glossary.reviewNotes.some(note => note.id === gloss.id && note.kind === 'unresolved-ambiguity'));
  }
});

test('the two cross-ayah explanations cover their original ranges, including both verse markers', () => {
  const cases = [
    {id: '42:1:1', words: [62181, 62182], verses: ['42:1', '42:2'], spec: '1:1 - 2:1'},
    {id: '53:19:1', words: [67914, 67915, 67916], verses: ['53:19', '53:19', '53:20'], spec: '19:2 - 20:1'},
  ];
  for (const expected of cases) {
    const gloss = index.glossMap.get(expected.id);
    assert.deepEqual(gloss.wordIndices, expected.words);
    assert.equal(gloss.wordsSpec, expected.spec);
    assert.deepEqual(gloss.wordIndices.map(word => verseForWord(index, word).key), expected.verses);
    for (const word of gloss.wordIndices) assert.ok(index.wordLinks.get(word).includes(gloss.id));
  }
  const crossVerse = glossary.glosses.filter(gloss => new Set(gloss.wordIndices.map(word => verseForWord(index, word).key)).size > 1);
  assert.deepEqual(crossVerse.map(gloss => gloss.id), cases.map(item => item.id));
});

test('both words with two explanations retain both original glosses', () => {
  const multiple = [...index.wordLinks].filter(([, ids]) => ids.length > 1);
  assert.equal(multiple.length, 2);
  assert.deepEqual(index.wordLinks.get(4888), ['2:246:2', '2:246:3']);
  assert.deepEqual(index.wordLinks.get(53400), ['32:4:1', '32:4:2']);
  for (const [word, ids] of multiple) {
    assert.equal(ids.length, 2);
    const texts = ids.map(id => index.glossMap.get(id).rawText);
    assert.notEqual(texts[0], texts[1]);
    for (const id of ids) assert.ok(index.glossMap.get(id).wordIndices.includes(word));
  }
});

test('the 2:138 correction changes only the association and keeps the declared source position documented', () => {
  const gloss = index.glossMap.get('2:138:2');
  const note = glossary.reviewNotes.find(item => item.id === gloss.id && item.kind === 'position-override');
  assert.equal(gloss.status, 'verified-position-override');
  assert.equal(gloss.matchMethod, 'reviewed-position-override');
  assert.equal(gloss.wordsSpec, '1');
  assert.deepEqual(gloss.declaredWordIndices, [2453]);
  assert.deepEqual(gloss.wordIndices, [2459]);
  assert.deepEqual(note.originalWordIndices, [2453]);
  assert.deepEqual(note.wordIndices, [2459]);
  assert.ok(note.reason.length > 0);
  assert.equal(index.wordLinks.get(2453)?.includes(gloss.id) ?? false, false);
  assert.ok(index.wordLinks.get(2459).includes(gloss.id));
  assert.equal(gloss.rawText, entryMap.get('2:138').text.split('\n')[1]);
  assert.equal(entryMap.get('2:138').words.split('\n')[1], '1');
  assert.equal(verseForWord(index, 2459).key, '2:138');
});

test('page and word links accept real positions and fail closed for malformed or mismatched positions', () => {
  assert.deepEqual(parseMushafLocation('#page=1&word=0', index), {page: 1, word: 0, verse: null});
  assert.deepEqual(parseMushafLocation('#page=١&word=٠', index), {page: 1, word: 0, verse: null});
  assert.deepEqual(parseMushafLocation('#page=604', index), {page: 604, word: null, verse: null});
  assert.deepEqual(parseMushafLocation('#١:٣', index), {page: 1, word: null, verse: '1:3'});
  const unlinked = mushaf.words.findIndex((_, word) => !index.wordLinks.has(word));
  const invalid = [
    '', '#reader', '#page=0', '#page=605', '#page=1.5', '#page=NaN', '#page=',
    '#page=1&word=', '#page=1&word=-1', '#page=1&word=0.5', '#page=1&word=77432',
    '#page=2&word=0', '#page=1&word=29', '#1:8', '#115:1', '#114:7',
    `#page=${pageForWord(index, unlinked)}&word=${unlinked}`,
  ];
  for (const hash of invalid) assert.equal(parseMushafLocation(hash, index), null, hash);
});

test('full-verse links retain their canonical reference and reject contradictory page or word locations', () => {
  assert.deepEqual(parseMushafLocation('#page=1&verse=1:2', index), {page: 1, word: null, verse: '1:2'});
  assert.deepEqual(parseMushafLocation('#page=1&verse=1:3', index), {page: 1, word: null, verse: '1:3'});
  assert.deepEqual(parseMushafLocation('#page=1&word=0&verse=1:1', index), {page: 1, word: 0, verse: '1:1'});
  assert.deepEqual(parseMushafLocation('#page=604&verse=114:6', index), {page: 604, word: null, verse: '114:6'});
  assert.deepEqual(parseMushafLocation('#page=١&verse=١:٢', index), {page: 1, word: null, verse: '1:2'});
  assert.deepEqual(parseMushafLocation(`#page=${encodeURIComponent('١')}&verse=${encodeURIComponent('١:٢')}`, index), {page: 1, word: null, verse: '1:2'});
  assert.deepEqual(parseMushafLocation('#page=1&verse=001%3A002', index), {page: 1, word: null, verse: '1:2'});
  for (const hash of [
    '#page=1&verse=', '#page=1&verse=1', '#page=1&verse=1:0', '#page=1&verse=1:8',
    '#page=1&verse=115:1', '#page=1&verse=1:1x', '#page=1&verse=1.5:1',
    '#page=2&verse=1:1', '#page=604&verse=1:1', '#page=1&word=0&verse=1:2',
  ]) assert.equal(parseMushafLocation(hash, index), null, hash);
});

test('a full-verse link accepts a continuation page but excludes a verse ending at that page boundary', () => {
  // The verified source has no split ayahs at page starts, so use only a
  // synthetic boundary here to cover future layouts without changing text.
  const splitPageStarts = [...mushaf.page_starts];
  splitPageStarts[1] = 2;
  const splitIndex = {...index, mushaf: {...mushaf, page_starts: splitPageStarts}};
  assert.deepEqual(parseMushafLocation('#page=2&verse=1:1', splitIndex), {page: 2, word: null, verse: '1:1'});
  assert.deepEqual(parseMushafLocation('#page=2&word=2&verse=1:1', splitIndex), {page: 2, word: 2, verse: '1:1'});
  assert.equal(parseMushafLocation('#page=3&verse=1:1', splitIndex), null);
  assert.equal(parseMushafLocation('#page=2&word=0&verse=1:1', splitIndex), null);
  const touchingPageStarts = [...mushaf.page_starts];
  touchingPageStarts[1] = index.verseMap.get('1:1').end;
  const touchingIndex = {...index, mushaf: {...mushaf, page_starts: touchingPageStarts}};
  assert.equal(parseMushafLocation('#page=2&verse=1:1', touchingIndex), null);
});

test('rendered Quran words keep their exact original codepoints and every recorded mark in its original order', () => {
  assert.equal(sha256(readFileSync(new URL('dist/data/mushaf.json', root))), glossary.metadata.mushafSha256);
  assert.equal(sha256(readFileSync(new URL('dist/data/page-lines.json', root))), source.layout.sha256);
  const expectedMarks = new Map();
  for (const [word, type] of mushaf.marks) {
    if (!expectedMarks.has(word)) expectedMarks.set(word, []);
    expectedMarks.get(word).push(mushaf.mark_types[type]);
  }
  assert.equal(mushaf.marks.length, 4517);
  const snapshot = JSON.stringify(mushaf.words);
  for (let word = 0; word < mushaf.words.length; word++) {
    const marks = expectedMarks.get(word) || [];
    const before = marks.filter(mark => mark.side === 'before').map(mark => mark.sign);
    const after = marks.filter(mark => mark.side === 'after').map(mark => mark.sign).join('');
    const actual = renderWordText(index, word);
    const prefix = before.length ? `${before.join(' ')} ` : '';
    assert.equal(actual, `${prefix}${mushaf.words[word]}${after}`, String(word));
    assert.equal(actual.slice(prefix.length, actual.length - after.length || undefined), mushaf.words[word], String(word));
  }
  assert.equal(JSON.stringify(mushaf.words), snapshot);
});

test('the unmodified Hafs font covers every word, pause mark, verse marker, and Arabic numeral', () => {
  const fontPath = fileURLToPath(new URL('dist/fonts/UthmanicHafs-v-3.0.ttf', root));
  assert.equal(sha256(readFileSync(fontPath)), source.font.sha256);
  const report = JSON.parse(execFileSync(pythonExecutable, ['-X', 'utf8', '-c', [
    'import json,sys',
    'from fontTools.ttLib import TTFont',
    "m=json.load(open(sys.argv[1], encoding='utf-8'))",
    'font=TTFont(sys.argv[2])',
    'cmap=font.getBestCmap()',
    "groups={'words':set(''.join(m['words'])), 'marks':set(''.join(t['sign'] for t in m['mark_types'])), 'verse_marker_and_digits':set(' ۝٠١٢٣٤٥٦٧٨٩')}",
    "report={k:{'count':len(v), 'missing':[f'U+{ord(c):04X}' for c in sorted(v) if ord(c) not in cmap or cmap.get(ord(c))=='.notdef']} for k,v in groups.items()}",
    'print(json.dumps(report))',
  ].join('\n'), fileURLToPath(new URL('dist/data/mushaf.json', root)), fontPath], {encoding: 'utf8', env: pythonEnvironment}));
  assert.deepEqual(report.words, {count: 64, missing: []});
  assert.deepEqual(report.marks, {count: 9, missing: []});
  assert.deepEqual(report.verse_marker_and_digits, {count: 12, missing: []});
});
