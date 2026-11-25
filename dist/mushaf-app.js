import {arabicNumber, normalizeSearch, createSearchIndex, searchRecords, hasExplanation, recordKey} from './core.js';
import {APP_TITLE, buildMushafIndex, upperBound, pageForWord, verseForWord, renderWordText, pageRows, parseMushafLocation} from './mushaf-core.js';
import {createPageTurner} from './page-turn.js';

const $ = id => document.getElementById(id);
const PAGE_KEY = 'muyassar:last-page:v1';
const SAVED_KEY = 'bayan:bookmarks:v1';
const RESULT_PAGE_SIZE = 18;
const mobileView = () => matchMedia('(max-width: 900px)').matches;
let model, entries, entryMap, searchIndex, sourceInfo;
let currentPage = 1;
let selection = null;
let savedKeys = new Set();
let searchMode = 'search';
let results = [];
let resultLimit = RESULT_PAGE_SIZE;
let searchQuery = '';
let zoomed = false;
let searchTimer, toastTimer, resizeFrame;
let preferredSurah = null;
let pageTurner;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function actionButton(text, name, callback) {
  const button = element('button', 'action-button'); button.type = 'button';
  button.append(icon(name), document.createTextNode(text)); button.addEventListener('click', callback); return button;
}
function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function notify(text) {
  clearTimeout(toastTimer);
  const target = document.querySelector('dialog[open]') || document.body;
  target.append($('toast')); $('toast').textContent = text; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function announce(text) { $('announcement').textContent = text; }
function requireData() { if (model) return true; notify('انتظر قليلًا حتى يكتمل تحميل المصحف.'); return false; }
function surahName(number) { return model.mushaf.surahs[number - 1].name_ar; }
function referenceLabel(key) {
  const verse = model.verseMap.get(key);
  return verse ? `سورة ${surahName(verse.surah)} · الآية ${arabicNumber(verse.ayah)}` : '';
}
function appendOriginalText(target, text) {
  let cursor = 0;
  for (const match of text.matchAll(/﴿[^﴾]*﴾/gu)) {
    target.append(document.createTextNode(text.slice(cursor, match.index)));
    target.append(element('span', 'gloss-text-term', match[0])); cursor = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}
function writeLocation(mode = 'push') {
  const selected = Number.isInteger(selection?.word) ? `&word=${selection.word}` : selection?.reference ? `&verse=${selection.reference}` : '';
  const hash = `#page=${currentPage}${selected}`;
  if (location.hash === hash) return;
  history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', hash);
}

function selectedWords() {
  const set = new Set();
  for (const gloss of selection?.glosses || []) for (const i of gloss.wordIndices) set.add(i);
  return set;
}
function paintSelection() {
  const selected = selectedWords();
  $('mushaf-rows').querySelectorAll('.quran-word').forEach(node => {
    const index = Number(node.dataset.wordIndex);
    node.classList.toggle('is-selected', selected.has(index));
    if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(selected.has(index)));
  });
}

function fitRows() {
  if (!model || $('reader-layout').hidden) return;
  const rows = [...$('mushaf-rows').querySelectorAll('.quran-line')];
  const width = $('mushaf-rows').clientWidth;
  if (!width || !rows.length) return;
  const paper = $('mushaf-paper');
  const opening = currentPage <= 2;
  let size = width / (opening ? 12.2 : 16.2);
  size = Math.min((opening ? 46 : 40) * (zoomed ? 1.6 : 1), size);
  paper.style.setProperty('--mushaf-font', `${size}px`);
  for (const row of rows) row.firstElementChild.style.width = 'max-content';
  const widest = Math.max(...rows.map(row => row.firstElementChild.scrollWidth));
  if (widest > width - 2) size *= (width - 2) / widest;
  size = Math.floor(size * 10) / 10;
  paper.style.setProperty('--mushaf-font', `${size}px`);
  // A generous vertical advance prevents Quranic vowel and pause marks clipping.
  paper.style.setProperty('--row-height', `${Math.ceil(size * 1.75)}px`);
  for (const row of rows) {
    const inner = row.firstElementChild;
    const last = Number(row.dataset.lastWord);
    const endVerse = model.verseEnds.get(last);
    const endsSurah = endVerse && endVerse.ayah === model.mushaf.surahs[endVerse.surah - 1].ayah_count;
    const naturalWidth = inner.scrollWidth;
    const center = opening || (endsSurah && naturalWidth < width * .78);
    row.classList.toggle('is-centered', Boolean(center));
    inner.style.width = center ? 'max-content' : '100%';
  }
}

function renderPage() {
  const rows = pageRows(model, currentPage);
  const start = model.mushaf.page_starts[currentPage - 1];
  const end = model.mushaf.page_starts[currentPage] ?? model.mushaf.words.length;
  const pageSurahs = new Set();
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    if (row.kind === 'surah') {
      const wrapper = element('div', 'mushaf-row surah-heading-row'); wrapper.dataset.line = String(row.line); wrapper.dataset.surahHeader = String(row.surah);
      const title = element('h2', 'surah-heading', `سُورَةُ ${surahName(row.surah)}`); wrapper.append(title); fragment.append(wrapper); continue;
    }
    if (row.kind === 'basmalah') {
      const wrapper = element('div', 'mushaf-row basmalah-row', model.mushaf.words.slice(0, 4).join(' '));
      wrapper.dataset.line = String(row.line); wrapper.setAttribute('aria-label', 'بسملة افتتاح السورة'); fragment.append(wrapper); continue;
    }
    const line = element('div', 'mushaf-row quran-line'); line.dataset.line = String(row.line); line.dataset.lastWord = String(row.lastWordExclusive - 1);
    const content = element('div', 'line-content');
    for (let i = row.firstWord; i < row.lastWordExclusive; i++) {
      const verse = verseForWord(model, i); pageSurahs.add(verse.surah);
      const hasGloss = model.wordLinks.has(i);
      const word = element(hasGloss ? 'button' : 'span', `quran-word${hasGloss ? ' has-gloss' : ''}`, renderWordText(model, i));
      word.dataset.wordIndex = String(i); word.dataset.verse = verse.key;
      if (hasGloss) {
        word.type = 'button'; word.setAttribute('aria-pressed', 'false');
        word.setAttribute('aria-label', `${model.mushaf.words[i]}، ${surahName(verse.surah)}، الآية ${arabicNumber(verse.ayah)}، إظهار المعنى`);
        word.addEventListener('click', () => selectWord(i));
      }
      if (content.childNodes.length) content.append(document.createTextNode(' '));
      content.append(word);
      const verseEnd = model.verseEnds.get(i);
      if (verseEnd) {
        const marker = element('span', 'verse-end', `۝${arabicNumber(verseEnd.ayah)}`);
        marker.setAttribute('aria-label', `نهاية الآية ${arabicNumber(verseEnd.ayah)}`);
        marker.dataset.verseEnd = verseEnd.key; content.append(document.createTextNode(' '), marker);
      }
    }
    line.append(content); fragment.append(line);
  }
  $('mushaf-rows').replaceChildren(fragment);
  $('mushaf-paper').classList.toggle('is-opening', currentPage <= 2);
  const names = [...pageSurahs].map(surahName);
  $('paper-title').textContent = `${names.length === 1 ? 'سورة ' : ''}${names.join(' · ')}`;
  const printedJuzStarts = model.mushaf.hizb_starts.filter((_, i) => i % 2 === 0);
  $('juz-label').textContent = `الجزء ${arabicNumber(upperBound(printedJuzStarts, start))}`;
  $('printed-page').textContent = arabicNumber(currentPage);
  $('page-input').value = arabicNumber(currentPage);
  $('surah-select').value = String(preferredSurah || verseForWord(model, start).surah);
  $('previous-page').disabled = currentPage <= 1;
  $('next-page').disabled = currentPage >= 604;
  let count = 0; for (let i = start; i < end; i++) if (model.wordLinks.has(i)) count++;
  $('page-hint').textContent = `${arabicNumber(count)} كلمة ملوّنة في هذه الصفحة · اضغط على الكلمة لفتح شرحها`;
  document.title = `${APP_TITLE} — الصفحة ${arabicNumber(currentPage)}`;
  fitRows(); paintSelection();
}

function emptyMeaning() {
  const empty = element('div', 'meaning-empty');
  const symbol = element('span', 'touch-symbol'); symbol.setAttribute('aria-hidden', 'true'); symbol.append(icon('touch'));
  empty.append(symbol, element('h2', null, 'لكل كلمةٍ معنى'), element('p', null, 'اختر كلمة ملوّنة من صفحة المصحف، وسيظهر هنا شرحها من «الميسر في غريب القرآن الكريم».'));
  const guide = element('div', 'empty-guide'); guide.append(element('span'), document.createTextNode('الكلمات الملوّنة لها شرح'), element('span')); empty.append(guide); return empty;
}

function selectionText(snapshot = selection) {
  return snapshot?.rawText ?? snapshot?.glosses?.map(gloss => gloss.rawText).join('\n\n') ?? '';
}
function selectionReference(snapshot = selection) { return snapshot?.glosses?.[0]?.sourceReference || snapshot?.reference; }
function selectionReferenceLabel(snapshot) {
  const gloss = snapshot.glosses?.[0];
  if (gloss?.wordIndices?.length) {
    const first = verseForWord(model, gloss.wordIndices[0]);
    const last = verseForWord(model, gloss.wordIndices.at(-1));
    if (first.key !== last.key) return `سورة ${surahName(first.surah)} · الآيتان ${arabicNumber(first.ayah)} و${arabicNumber(last.ayah)}`;
  }
  return referenceLabel(selectionReference(snapshot));
}

function renderMeaning() {
  $('saved-count').textContent = arabicNumber(savedKeys.size);
  const snapshot = selection;
  for (const target of [$('desktop-meaning'), $('mobile-meaning')]) {
    target.replaceChildren();
    if (!snapshot) { target.append(emptyMeaning()); continue; }
    target.append(element('p', 'selection-reference', selectionReferenceLabel(snapshot)));
    const label = Number.isInteger(snapshot.word) ? model.mushaf.words[snapshot.word] : 'شرح الآية';
    const title = element('h2', 'selection-word', label); target.append(title);
    const texts = snapshot.rawText !== undefined ? [snapshot.rawText] : snapshot.glosses.map(gloss => gloss.rawText);
    for (const text of texts) {
      const block = element('div', 'gloss-block'); const paragraph = element('p', 'gloss-body');
      appendOriginalText(paragraph, text); block.append(paragraph); target.append(block);
    }
    const actions = element('div', 'selection-actions');
    const key = selectionReference(snapshot);
    const saved = savedKeys.has(key);
    const saveButton = actionButton(saved ? 'محفوظة' : 'حفظ الآية', 'bookmark', () => toggleSaved(key));
    saveButton.classList.toggle('is-saved', saved); saveButton.setAttribute('aria-pressed', String(saved));
    const copy = actionButton('نسخ المعنى', 'copy', () => copySelection(snapshot));
    const link = actionButton('نسخ الرابط', 'link', () => copyText(location.href, 'نُسخ رابط موضع القراءة'));
    actions.append(saveButton, copy, link); target.append(actions);
    if (Number.isInteger(snapshot.word)) {
      const all = element('button', 'text-button', 'شرح كامل كلمات الآية'); all.type = 'button';
      all.addEventListener('click', () => showVerseMeaning(key)); target.append(all);
    }
    target.append(element('p', 'meaning-credit', 'المصدر: الميسر في غريب القرآن الكريم — مجمع الملك فهد لطباعة المصحف الشريف. متاح عبر إتقان لإدارة المحتوى.'));
  }
}

function selectWord(word, {open = true, historyMode = 'push'} = {}) {
  const ids = model.wordLinks.get(word);
  if (!ids) return;
  selection = {word, reference: verseForWord(model, word).key, glosses: ids.map(id => model.glossMap.get(id))};
  paintSelection(); renderMeaning(); writeLocation(historyMode);
  announce(selectionText());
  if (mobileView() && open && !$('meaning-dialog').open) $('meaning-dialog').showModal();
}

function goToPage(page, {word = null, surah = null, historyMode = 'push', openMeaning = false, scroll = false} = {}) {
  if (!model || !Number.isInteger(page) || page < 1 || page > 604) return;
  pageTurner?.cancel();
  if ($('meaning-dialog').open) $('meaning-dialog').close();
  currentPage = page; preferredSurah = surah; selection = null;
  writeStorage(PAGE_KEY, page);
  renderPage(); renderMeaning();
  if (Number.isInteger(word) && pageForWord(model, word) === page && model.wordLinks.has(word)) selectWord(word, {open: openMeaning, historyMode});
  else writeLocation(historyMode);
  announce(`الصفحة ${arabicNumber(page)}، ${$('paper-title').textContent}`);
  if (scroll) $('mushaf-reader').scrollIntoView({block: 'start', behavior: 'instant'});
}

function showVerseMeaning(key, {navigate = false, open = true} = {}) {
  const entry = entryMap.get(key); const verse = model.verseMap.get(key);
  if (!verse) return;
  if (navigate) goToPage(verse.page, {surah: verse.surah, scroll: true});
  if (!hasExplanation(entry)) { notify('لا يوجد شرح لهذه الآية في مورد الغريب.'); return; }
  selection = {word: null, reference: key, rawText: entry.text, glosses: []};
  paintSelection(); renderMeaning(); writeLocation('replace');
  if (mobileView() && open && !$('meaning-dialog').open) $('meaning-dialog').showModal();
}

function toggleSaved(key) {
  if (!hasExplanation(entryMap.get(key))) return;
  const had = savedKeys.has(key); if (had) savedKeys.delete(key); else savedKeys.add(key);
  const persisted = writeStorage(SAVED_KEY, [...savedKeys]); renderMeaning();
  notify(persisted ? (had ? 'أُزيلت الآية من المحفوظات' : 'حُفظت الآية ومعانيها') : 'حُفظ التغيير لهذه الجلسة؛ تعذّر الحفظ الدائم في المتصفح.');
}

async function copyText(text, success) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = element('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select();
      const ok = document.execCommand('copy'); area.remove(); if (!ok) throw new Error('Copy unavailable');
    }
    notify(success);
  } catch { notify('تعذّر النسخ. يمكنك تحديد النص ونسخه يدويًا.'); }
}
function copySelection(snapshot) {
  const text = `${selectionReferenceLabel(snapshot)}\n\n${selectionText(snapshot)}\n\nالمصدر: الميسر في غريب القرآن الكريم — مجمع الملك فهد لطباعة المصحف الشريف\nمتاح عبر إتقان لإدارة المحتوى\nCC BY-NC-ND\nhttps://cms.itqan.dev/gallery/asset/145`;
  copyText(text, 'نُسخ المعنى مع نسبته إلى المصدر');
}

function jumpToSurah(number) {
  const word = model.mushaf.surah_starts[number - 1];
  const page = pageForWord(model, word); if (!page) return;
  $('index-dialog').close(); goToPage(page, {surah: number, scroll: true});
  const header = $('mushaf-rows').querySelector(`[data-surah-header="${number}"]`);
  if (header && mobileView()) header.scrollIntoView({block: 'center', behavior: 'instant'});
}
function renderSurahIndex() {
  if (!model) return;
  const query = normalizeSearch($('surah-query').value);
  const fragment = document.createDocumentFragment();
  for (const surah of model.mushaf.surahs) {
    if (query && !normalizeSearch(surah.name_ar).includes(query) && String(surah.number) !== query) continue;
    const page = pageForWord(model, model.mushaf.surah_starts[surah.number - 1]);
    const button = element('button', 'surah-list-item'); button.type = 'button';
    button.classList.toggle('is-active', Number($('surah-select').value) === surah.number);
    const number = element('span', 'surah-index-number', arabicNumber(surah.number));
    const copy = element('span'); copy.append(element('span', 'surah-index-name', surah.name_ar), element('span', 'surah-index-meta', `صفحة ${arabicNumber(page)} · ${arabicNumber(surah.ayah_count)} ${surah.ayah_count < 11 ? 'آيات' : 'آية'}`));
    button.append(number, copy); button.addEventListener('click', () => jumpToSurah(surah.number)); fragment.append(button);
  }
  if (!fragment.childNodes.length) fragment.append(element('p', 'search-empty', 'لم نجد سورة بهذا الاسم.'));
  $('surah-list').replaceChildren(fragment);
}

function openSearch(mode = 'search') {
  if (!requireData()) return;
  clearTimeout(searchTimer); searchMode = mode; resultLimit = RESULT_PAGE_SIZE; searchQuery = ''; $('global-query').value = '';
  $('search-form').hidden = mode === 'saved';
  $('search-title').textContent = mode === 'saved' ? 'آياتك المحفوظة' : 'ابحث في غريب القرآن';
  $('search-eyebrow').textContent = mode === 'saved' ? 'للرجوع إلى المعاني لاحقًا' : 'الكلمات وشروحها';
  results = mode === 'saved' ? entries.filter(entry => savedKeys.has(recordKey(entry))) : [];
  renderSearchResults(); $('search-dialog').showModal();
  if (mode === 'search') $('global-query').focus();
}
function performSearch({direct = false} = {}) {
  if (!model) return;
  searchQuery = $('global-query').value.trim(); resultLimit = RESULT_PAGE_SIZE;
  if (direct) {
    const match = normalizeSearch(searchQuery).match(/^(\d{1,3})\s*[:/]\s*(\d{1,3})$/);
    if (match) {
      const key = `${Number(match[1])}:${Number(match[2])}`;
      if (model.verseMap.has(key)) { $('search-dialog').close(); showVerseMeaning(key, {navigate: true}); return; }
    }
  }
  results = searchQuery ? searchRecords(searchIndex, searchQuery) : [];
  renderSearchResults();
}
function openSearchResult(entry) {
  $('search-dialog').close();
  const key = recordKey(entry); const verse = model.verseMap.get(key);
  const query = normalizeSearch(searchQuery);
  const glosses = model.glossesByVerse.get(key) || [];
  const candidates = query ? glosses.filter(gloss => normalizeSearch(gloss.rawText.replace(/\u0670/g, 'ا')).includes(query) || normalizeSearch(gloss.rawText).includes(query)) : [];
  const chosen = candidates.find(gloss => gloss.wordIndices.length) || (query ? null : glosses.find(gloss => gloss.wordIndices.length));
  if (chosen) { const word = chosen.wordIndices[0]; goToPage(pageForWord(model, word), {word, openMeaning: true, surah: verse.surah, scroll: true}); }
  else showVerseMeaning(key, {navigate: true});
}
function renderSearchResults() {
  const isSaved = searchMode === 'saved';
  $('search-description').textContent = isSaved ? `${arabicNumber(results.length)} آية محفوظة على هذا المتصفح.` : searchQuery ? `${arabicNumber(results.length)} آية تطابق «${searchQuery}». افتح النتيجة في المصحف.` : 'ابحث دون الحاجة إلى التشكيل، ثم افتح النتيجة في صفحة المصحف.';
  const fragment = document.createDocumentFragment();
  for (const entry of results.slice(0, resultLimit)) {
    const key = recordKey(entry); const verse = model.verseMap.get(key);
    const button = element('button', 'search-result'); button.type = 'button';
    const reference = element('div', 'result-reference'); reference.append(element('span', null, referenceLabel(key)), element('small', null, `ص ${arabicNumber(verse.page)}`));
    button.append(reference, element('p', 'result-preview', entry.text));
    button.addEventListener('click', () => openSearchResult(entry)); fragment.append(button);
  }
  if (!results.length) fragment.append(element('p', 'search-empty', isSaved ? 'لم تحفظ أي آية بعد. افتح معنى كلمة، ثم اختر «حفظ الآية».' : searchQuery ? 'لم نعثر على نتيجة. جرّب كلمة أخرى من الكلمات أو الشروح.' : 'مثلًا: الحمد، العالمين، يوم الدين.'));
  $('search-results').replaceChildren(fragment); $('more-results').hidden = resultLimit >= results.length;
}

function applyURL() {
  if (!model) return;
  const parsed = parseMushafLocation(location.hash, model);
  if (!parsed) return;
  goToPage(parsed.page, {word: parsed.word, historyMode: 'replace', openMeaning: true});
  if (parsed.verse) {
    const verse = model.verseMap.get(parsed.verse);
    preferredSurah = verse.surah; $('surah-select').value = String(verse.surah);
    if (!Number.isInteger(parsed.word)) showVerseMeaning(parsed.verse);
  }
}

async function getJSON(path) {
  const response = await fetch(path); if (!response.ok) throw new Error(`Resource HTTP ${response.status}: ${path}`); return response.json();
}
async function loadApp() {
  $('loading-state').hidden = false; $('error-state').hidden = true; $('reader-layout').hidden = true;
  try {
    const [mushaf, layout, links, glossaryEntries, provenance, font] = await Promise.all([
      getJSON('./data/mushaf.json'), getJSON('./data/page-lines.json'), getJSON('./data/glossary-links.json'), getJSON('./data/entries.json'), getJSON('./data/mushaf-source.json'), document.fonts.load('32px MushafHafs'),
    ]);
    if (!font.length || !document.fonts.check('32px MushafHafs')) throw new Error('The matching Quran font is not available.');
    model = buildMushafIndex(mushaf, layout, links); sourceInfo = provenance;
    entries = glossaryEntries.records; entryMap = new Map(entries.map(entry => [recordKey(entry), entry])); searchIndex = createSearchIndex(entries);
    const saved = readStorage(SAVED_KEY, []); savedKeys = new Set(Array.isArray(saved) ? saved.filter(key => typeof key === 'string' && hasExplanation(entryMap.get(key))) : []);
    $('surah-select').replaceChildren(...mushaf.surahs.map(surah => { const option = element('option', null, `سورة ${surah.name_ar}`); option.value = String(surah.number); return option; }));
    $('mapping-summary').textContent = `تتضمن الخريطة ${arabicNumber(links.metadata.linkedGlossCount)} شرحًا مرتبطًا بـ${arabicNumber(links.metadata.highlightedWordCount)} كلمة. وقد روجعت المواضع مقابل نص المصحف مع حفظ الشروح الأصلية.`;
    $('loading-state').hidden = true; $('reader-layout').hidden = false;
    const parsed = parseMushafLocation(location.hash, model);
    const storedPage = readStorage(PAGE_KEY, 1);
    const fallback = Number.isInteger(storedPage) && storedPage >= 1 && storedPage <= 604 ? storedPage : 1;
    goToPage(parsed?.page || fallback, {word: parsed?.word ?? null, historyMode: 'replace', openMeaning: true});
    if (parsed?.verse) {
      preferredSurah = model.verseMap.get(parsed.verse).surah;
      $('surah-select').value = String(preferredSurah);
      if (!Number.isInteger(parsed.word)) showVerseMeaning(parsed.verse);
    }
    renderSurahIndex();
  } catch (error) {
    model = null; $('loading-state').hidden = true; $('reader-layout').hidden = true; $('error-state').hidden = false;
    console.error('Muyassar could not load verified source data:', error);
  }
}

$('surah-select').addEventListener('change', event => jumpToSurah(Number(event.target.value)));
$('page-form').addEventListener('submit', event => {
  event.preventDefault(); if (!requireData()) return;
  const value = normalizeSearch($('page-input').value);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 604) { notify('أدخل رقم صفحة من ١ إلى ٦٠٤.'); $('page-input').value = arabicNumber(currentPage); return; }
  goToPage(Number(value)); $('page-input').blur();
});
$('previous-page').addEventListener('click', () => pageTurner.turn(-1));
$('next-page').addEventListener('click', () => pageTurner.turn(1));
$('zoom-button').addEventListener('click', () => { pageTurner.cancel(); zoomed = !zoomed; $('paper-scroll').classList.toggle('is-zoomed', zoomed); $('zoom-button').setAttribute('aria-pressed', String(zoomed)); $('zoom-button').querySelector('span').textContent = zoomed ? 'الحجم العادي' : 'تكبير القراءة'; $('turn-guide').querySelector('span').textContent = zoomed ? 'حرّك الصفحة لقراءة أطرافها، واستخدم الأزرار للتقليب' : 'اسحب الصفحة يمينًا للتالية، ويسارًا للسابقة'; fitRows(); });
$('open-index').addEventListener('click', () => { if (!requireData()) return; $('surah-query').value = ''; renderSurahIndex(); $('index-dialog').showModal(); });
$('surah-query').addEventListener('input', renderSurahIndex);
$('open-search').addEventListener('click', () => openSearch('search'));
$('open-saved').addEventListener('click', () => openSearch('saved'));
['open-source', 'sidebar-source', 'footer-source'].forEach(id => $(id).addEventListener('click', () => $('source-dialog').showModal()));
$('search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); performSearch({direct: true}); });
$('global-query').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(performSearch, 220); });
$('more-results').addEventListener('click', () => { const oldLimit = resultLimit; resultLimit += RESULT_PAGE_SIZE; renderSearchResults(); $('search-results').children[oldLimit]?.focus(); });
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { if (dialog.contains($('toast'))) { $('toast').hidden = true; document.body.append($('toast')); } });
});
window.addEventListener('popstate', applyURL); window.addEventListener('hashchange', applyURL);
window.addEventListener('keydown', event => {
  if (!model || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.key === 'ArrowLeft' && currentPage < 604) { event.preventDefault(); pageTurner.turn(1); }
  if (event.key === 'ArrowRight' && currentPage > 1) { event.preventDefault(); pageTurner.turn(-1); }
});
window.addEventListener('storage', event => {
  if (!model || (event.key !== null && event.key !== SAVED_KEY)) return;
  const saved = readStorage(SAVED_KEY, []); savedKeys = new Set(Array.isArray(saved) ? saved.filter(key => hasExplanation(entryMap.get(key))) : []);
  renderMeaning();
  if (searchMode === 'saved' && $('search-dialog').open) {
    results = entries.filter(entry => savedKeys.has(recordKey(entry)));
    renderSearchResults();
  }
});
const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(fitRows); }); observer.observe($('paper-scroll'));
matchMedia('(max-width: 900px)').addEventListener('change', event => { if (!event.matches && $('meaning-dialog').open) $('meaning-dialog').close(); });
$('retry').addEventListener('click', loadApp);
pageTurner = createPageTurner({
  paper: $('mushaf-paper'), deck: $('paper-deck'), surface: $('paper-scroll'),
  getPage: () => model ? currentPage : null,
  canSwipe: () => Boolean(model) && !zoomed && !document.querySelector('dialog[open]'),
  commit: (page, options) => goToPage(page, options),
  onBusy: busy => {
    $('previous-page').disabled = busy || currentPage <= 1;
    $('next-page').disabled = busy || currentPage >= 604;
    $('zoom-button').disabled = busy;
  },
});
loadApp();
