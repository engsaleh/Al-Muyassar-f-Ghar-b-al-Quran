import {normalizeSearch} from './core.js';

export const APP_TITLE = 'الميسر في غريب القرآن';

export function upperBound(values, value) {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle] <= value) low = middle + 1; else high = middle; }
  return low;
}

function checkStarts(values, expectedLength, limit, label) {
  if (!Array.isArray(values) || values.length !== expectedLength || values[0] !== 0 || values.some((n, i) => !Number.isInteger(n) || n < 0 || n >= limit || (i > 0 && n <= values[i - 1]))) throw new Error(`Invalid ${label} boundaries.`);
}

export function buildMushafIndex(mushaf, layout, glossary) {
  const total = mushaf?.words?.length;
  if (total !== 77432 || mushaf.format !== 'quran-mushaf' || mushaf.words.some(word => typeof word !== 'string' || !word)) throw new Error('The complete, verified Hafs dataset is required.');
  checkStarts(mushaf.ayah_starts, 6236, total, 'ayah');
  checkStarts(mushaf.page_starts, 604, total, 'page');
  checkStarts(mushaf.surah_starts, 114, total, 'surah');
  checkStarts(mushaf.line_starts, 8820, total, 'line');
  if (mushaf.surahs?.length !== 114 || layout?.pages?.length !== 604 || !Array.isArray(glossary?.glosses) || !glossary.wordLinks) throw new Error('Missing layout or glossary.');

  const verses = [];
  const verseMap = new Map();
  const wordToVerse = new Uint16Array(total);
  const verseEnds = new Map();
  for (let s = 0; s < 114; s++) {
    const surah = mushaf.surahs[s];
    if (surah.number !== s + 1 || surah.first_ayah !== verses.length || mushaf.ayah_starts[surah.first_ayah] !== mushaf.surah_starts[s]) throw new Error('Surah references do not match the source.');
    for (let ayah = 1; ayah <= surah.ayah_count; ayah++) {
      const ordinal = surah.first_ayah + ayah - 1;
      const start = mushaf.ayah_starts[ordinal];
      const end = mushaf.ayah_starts[ordinal + 1] ?? total;
      const verse = {ordinal, surah: s + 1, ayah, key: `${s + 1}:${ayah}`, start, end, page: upperBound(mushaf.page_starts, start)};
      verses.push(verse); verseMap.set(verse.key, verse); verseEnds.set(end - 1, verse);
      wordToVerse.fill(ordinal, start, end);
    }
  }
  if (verses.length !== 6236) throw new Error('Incomplete verse references.');

  let cursor = 0;
  for (let p = 0; p < 604; p++) {
    const page = layout.pages[p];
    if (page.page !== p + 1 || !Array.isArray(page.lines) || !page.lines.length || page.lines[0].firstWord !== mushaf.page_starts[p]) throw new Error('Invalid page layout.');
    let previousLine = 0;
    for (const line of page.lines) {
      if (!Number.isInteger(line.line) || line.line <= previousLine || line.line > (p < 2 ? 8 : 15) || line.firstWord !== cursor || line.lastWordExclusive <= line.firstWord || !mushaf.line_starts.includes(line.firstWord)) throw new Error('Noncontiguous printed lines.');
      if (line.surahStart && mushaf.surah_starts[line.surahStart - 1] !== line.firstWord) throw new Error('Invalid surah heading position.');
      previousLine = line.line; cursor = line.lastWordExclusive;
    }
    if (cursor !== (mushaf.page_starts[p + 1] ?? total)) throw new Error('Page words do not match the source boundaries.');
  }
  if (cursor !== total) throw new Error('Missing Quran words.');

  const wordMarks = new Map();
  for (const [wordIndex, typeIndex] of mushaf.marks) {
    const type = mushaf.mark_types[typeIndex];
    if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= total || !type || !['before', 'after'].includes(type.side) || typeof type.sign !== 'string') throw new Error('Invalid Quran mark.');
    if (!wordMarks.has(wordIndex)) wordMarks.set(wordIndex, []);
    wordMarks.get(wordIndex).push(type);
  }

  const glossMap = new Map();
  const glossesByVerse = new Map();
  for (const gloss of glossary.glosses) {
    if (glossMap.has(gloss.id) || typeof gloss.rawText !== 'string' || !verseMap.has(gloss.sourceReference) || !Array.isArray(gloss.wordIndices)) throw new Error('Invalid glossary entry.');
    if (gloss.status === 'review-required' && gloss.wordIndices.length) throw new Error('An unresolved glossary entry must not highlight a word.');
    glossMap.set(gloss.id, gloss);
    if (!glossesByVerse.has(gloss.sourceReference)) glossesByVerse.set(gloss.sourceReference, []);
    glossesByVerse.get(gloss.sourceReference).push(gloss);
  }
  const wordLinks = new Map();
  for (const [key, ids] of Object.entries(glossary.wordLinks)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= total || !Array.isArray(ids) || !ids.length) throw new Error('Invalid word-to-gloss association.');
    for (const id of ids) {
      const gloss = glossMap.get(id);
      if (!gloss || gloss.status === 'review-required' || !gloss.wordIndices.includes(index)) throw new Error('Unverified word-to-gloss association.');
    }
    wordLinks.set(index, ids);
  }
  for (const gloss of glossMap.values()) for (const wordIndex of gloss.wordIndices) {
    if (!wordLinks.get(wordIndex)?.includes(gloss.id)) throw new Error('A verified gloss has an incomplete reverse mapping.');
  }
  return {mushaf, layout, glossary, verses, verseMap, wordToVerse, verseEnds, wordMarks, glossMap, glossesByVerse, wordLinks};
}

export function pageForWord(index, wordIndex) {
  if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= index.mushaf.words.length) return null;
  return upperBound(index.mushaf.page_starts, wordIndex);
}

export function verseForWord(index, wordIndex) {
  return Number.isInteger(wordIndex) && wordIndex >= 0 && wordIndex < index.mushaf.words.length ? index.verses[index.wordToVerse[wordIndex]] : null;
}

export function renderWordText(index, wordIndex) {
  const word = index.mushaf.words[wordIndex];
  if (typeof word !== 'string') throw new Error('Unknown word.');
  const marks = index.wordMarks.get(wordIndex) || [];
  const before = marks.filter(mark => mark.side === 'before').map(mark => mark.sign);
  const after = marks.filter(mark => mark.side === 'after').map(mark => mark.sign).join('');
  return `${before.length ? before.join(' ') + ' ' : ''}${word}${after}`;
}

export function pageRows(index, pageNumber) {
  const page = index.layout.pages[pageNumber - 1];
  if (!page) return [];
  const rows = new Map();
  const add = row => { if (rows.has(row.line) || row.line < 1) throw new Error('Overlapping printed rows.'); rows.set(row.line, row); };
  for (const line of page.lines) {
    if (line.surahStart) {
      const surah = line.surahStart;
      if (surah === 1 || surah === 9) add({kind: 'surah', surah, line: line.line - 1});
      else { add({kind: 'surah', surah, line: line.line - 2}); add({kind: 'basmalah', surah, line: line.line - 1}); }
    }
    add({...line, kind: 'text'});
  }
  const result = [...rows.values()].sort((a, b) => a.line - b.line);
  const expected = pageNumber <= 2 ? 8 : 15;
  if (result.length !== expected || result.some((row, i) => row.line !== i + 1)) throw new Error('The printed page has missing rows.');
  return result;
}

export function parseMushafLocation(hash, index) {
  const value = normalizeSearch(String(hash || '').replace(/^#/, ''));
  const legacy = value.match(/^(\d{1,3}):(\d{1,3})$/);
  if (legacy) {
    const verse = index.verseMap.get(`${Number(legacy[1])}:${Number(legacy[2])}`);
    return verse ? {page: verse.page, word: null, verse: verse.key} : null;
  }
  const params = new URLSearchParams(value);
  const rawPage = normalizeSearch(params.get('page') ?? '');
  if (!rawPage || !/^\d{1,3}$/.test(rawPage)) return null;
  const page = Number(rawPage);
  if (page < 1 || page > 604) return null;
  let word = null;
  if (params.has('word')) {
    const rawWord = normalizeSearch(params.get('word') ?? '');
    if (!/^\d+$/.test(rawWord)) return null;
    word = Number(rawWord);
    if (pageForWord(index, word) !== page || !index.wordLinks.has(word)) return null;
  }
  let verse = null;
  if (params.has('verse')) {
    const rawVerse = normalizeSearch(params.get('verse') ?? '');
    const reference = rawVerse.match(/^(\d{1,3}):(\d{1,3})$/);
    if (!reference) return null;
    const candidate = index.verseMap.get(`${Number(reference[1])}:${Number(reference[2])}`);
    if (!candidate) return null;
    const pageStart = index.mushaf.page_starts[page - 1];
    const pageEnd = index.mushaf.page_starts[page] ?? index.mushaf.words.length;
    // Both ranges are half-open. A verse may begin on an earlier page,
    // but must still contain at least one word on the requested page.
    if (candidate.start >= pageEnd || candidate.end <= pageStart) return null;
    if (word !== null && (word < candidate.start || word >= candidate.end)) return null;
    verse = candidate.key;
  }
  return {page, word, verse};
}
