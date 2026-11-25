import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  SURAH_NAMES, recordKey, hasExplanation, validateDataset,
  createSearchIndex, searchRecords, parseReference, validSavedKeys,
} from '../dist/core.js';

const pythonExecutable = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const pythonEnvironment = {...process.env, PYTHONIOENCODING: 'utf-8'};
const resourcePath = fileURLToPath(new URL('../dist/data/entries.json', import.meta.url));
const csvPath = fileURLToPath(new URL('../source-data/muyassar-of-ghareeb-al-quran-11.csv', import.meta.url));
const payload = JSON.parse(readFileSync(resourcePath, 'utf8'));
const groups = validateDataset(payload);
const records = groups.flat();
const recordMap = new Map(records.map(record => [recordKey(record), record]));
const index = createSearchIndex(records);
const keys = result => result.map(recordKey);

test('published JSON preserves every original CSV field, including line breaks and empty explanations', () => {
  const csvBytes = readFileSync(csvPath);
  const actualHash = createHash('sha256').update(csvBytes).digest('hex');
  assert.equal(actualHash, '2b08544e6ea2482399fe87d7330ad7db8584c0d078b2bc9302cbdb44d643b297');
  assert.equal(payload.metadata.sha256, actualHash);
  const original = JSON.parse(execFileSync(pythonExecutable, ['-X', 'utf8', '-c', [
    'import csv,json,sys',
    "with open(sys.argv[1], encoding='utf-8-sig', newline='') as f:",
    '    rows = list(csv.DictReader(f))',
    "result = [{'surah':int(r['surah']), 'ayah':int(r['ayah']), 'text':r['text'], 'words':r['words']} for r in rows]",
    'print(json.dumps(result, ensure_ascii=False))',
  ].join('\n'), csvPath], {encoding: 'utf8', env: pythonEnvironment, maxBuffer: 20 * 1024 * 1024}));
  assert.deepEqual(payload.records, original);
});

test('the resource covers 114 complete surahs and distinguishes the 1,146 empty records', () => {
  assert.equal(records.length, 6236);
  assert.equal(groups.length, 114);
  assert.equal(SURAH_NAMES.length, 114);
  assert.equal(recordMap.size, 6236);
  assert.equal(records.filter(hasExplanation).length, 5090);
  assert.equal(records.filter(record => !hasExplanation(record)).length, 1146);
  assert.equal(groups[0].length, 7);
  assert.equal(groups[1].length, 286);
  assert.equal(groups[113].length, 6);
  assert.equal(recordKey(records[0]), '1:1');
  assert.equal(recordKey(records.at(-1)), '114:6');
  assert.equal(recordMap.get('1:3').text, '');
  assert.equal(recordMap.get('1:3').words, '');
  assert.equal(index.some(item => recordKey(item.record) === '1:3'), false);
  assert.equal(recordKey(records[records.indexOf(recordMap.get('1:7')) + 1]), '2:1');
});

test('common Arabic searches work with or without vocalization and keep the original source untouched', () => {
  const before = JSON.stringify(payload.records);
  const plain = searchRecords(index, 'الحمد');
  const marked = searchRecords(index, 'ٱلْحَمْدُ');
  assert.ok(keys(plain).includes('1:2'));
  assert.deepEqual(keys(marked), keys(plain));
  assert.ok(keys(searchRecords(index, 'الرحمن')).includes('1:1'));
  assert.ok(keys(searchRecords(index, 'يوم القيامة')).includes('1:4'));
  assert.deepEqual(searchRecords(index, '   '), []);
  assert.deepEqual(searchRecords(index, 'qwerty-no-such-word'), []);
  assert.equal(JSON.stringify(payload.records), before);
});

test('ordinary spelling finds Uthmani words with dagger alif without losing الرحمن matching', () => {
  assert.ok(keys(searchRecords(index, 'العالمين')).includes('1:2'), 'العالمين must find ٱلۡعَٰلَمِينَ');
  assert.ok(keys(searchRecords(index, 'الصراط')).includes('1:6'), 'الصراط must find ٱلصِّرَٰطَ');
  assert.ok(keys(searchRecords(index, 'الرحمن')).includes('1:1'), 'الرحمن still needs the unexpanded spelling');
});

test('reference parsing accepts Arabic digits and permits genuine empty records, but rejects invalid ayahs', () => {
  assert.equal(parseReference('#٢:٢٥٥', recordMap), recordMap.get('2:255'));
  assert.equal(parseReference('#۲:۲۵۵', recordMap), recordMap.get('2:255'));
  assert.equal(parseReference('1:3', recordMap), recordMap.get('1:3'));
  assert.equal(parseReference('114:6', recordMap), recordMap.get('114:6'));
  assert.deepEqual(keys(searchRecords(index, '٢:٢٥٥')), ['2:255']);
  for (const invalid of ['0:1', '1:0', '1:8', '2:287', '115:1', '114:7', 'NaN:1', '1:1x', '#reader', null]) {
    assert.equal(parseReference(invalid, recordMap), null, String(invalid));
  }
});

test('saved entries from local storage are deduplicated and cannot invent or populate explanations', () => {
  assert.deepEqual(validSavedKeys(['1:1', '1:1', '1:3', '1:2', '115:1', 1, null, {}], recordMap), ['1:1', '1:2']);
  assert.deepEqual(validSavedKeys(null, recordMap), []);
  assert.deepEqual(validSavedKeys({entry: '1:1'}, recordMap), []);
});

test('truncated, duplicated, or malformed data fails closed instead of appearing complete', () => {
  assert.throws(() => validateDataset({...payload, records: payload.records.slice(1)}));
  const duplicate = structuredClone(payload);
  duplicate.records[1] = structuredClone(duplicate.records[0]);
  assert.throws(() => validateDataset(duplicate));
  const invalidText = structuredClone(payload);
  invalidText.records[0].text = null;
  assert.throws(() => validateDataset(invalidText));
});
