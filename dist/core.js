export const SURAH_NAMES = [
  'الفاتحة','البقرة','آل عمران','النساء','المائدة','الأنعام','الأعراف','الأنفال','التوبة','يونس','هود','يوسف','الرعد','إبراهيم','الحجر','النحل','الإسراء','الكهف','مريم','طه','الأنبياء','الحج','المؤمنون','النور','الفرقان','الشعراء','النمل','القصص','العنكبوت','الروم','لقمان','السجدة','الأحزاب','سبأ','فاطر','يس','الصافات','ص','الزمر','غافر','فصلت','الشورى','الزخرف','الدخان','الجاثية','الأحقاف','محمد','الفتح','الحجرات','ق','الذاريات','الطور','النجم','القمر','الرحمن','الواقعة','الحديد','المجادلة','الحشر','الممتحنة','الصف','الجمعة','المنافقون','التغابن','الطلاق','التحريم','الملك','القلم','الحاقة','المعارج','نوح','الجن','المزمل','المدثر','القيامة','الإنسان','المرسلات','النبأ','النازعات','عبس','التكوير','الانفطار','المطففين','الانشقاق','البروج','الطارق','الأعلى','الغاشية','الفجر','البلد','الشمس','الليل','الضحى','الشرح','التين','العلق','القدر','البينة','الزلزلة','العاديات','القارعة','التكاثر','العصر','الهمزة','الفيل','قريش','الماعون','الكوثر','الكافرون','النصر','المسد','الإخلاص','الفلق','الناس'
];

export const arabicNumber = value => new Intl.NumberFormat('ar', {useGrouping: false, numberingSystem: 'arab'}).format(value);
export const recordKey = record => `${record.surah}:${record.ayah}`;
export const hasExplanation = record => Boolean(record && typeof record.text === 'string' && record.text.trim());

// Search-only normalization. Never apply this to displayed or saved source text.
export function normalizeSearch(value) {
  return String(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0)).toLowerCase().trim();
}

export function validateDataset(payload) {
  if (!payload || !Array.isArray(payload.records) || !payload.metadata || payload.records.length !== 6236) throw new Error('The complete source dataset is required.');
  const seen = new Set();
  const groups = Array.from({length: 114}, () => []);
  for (const record of payload.records) {
    if (!Number.isInteger(record.surah) || record.surah < 1 || record.surah > 114 || !Number.isInteger(record.ayah) || record.ayah < 1 || record.ayah > 286 || typeof record.text !== 'string' || typeof record.words !== 'string') throw new Error('Invalid source record.');
    const key = recordKey(record);
    if (seen.has(key)) throw new Error('Duplicate source reference.');
    seen.add(key);
    groups[record.surah - 1].push(record);
  }
  for (const group of groups) {
    group.sort((a, b) => a.ayah - b.ayah);
    if (!group.length || group.some((record, index) => record.ayah !== index + 1)) throw new Error('Incomplete surah sequence.');
  }
  return groups;
}

export function createSearchIndex(records) {
  return records.filter(hasExplanation).map(record => {
    const searchable = `${SURAH_NAMES[record.surah - 1]} ${recordKey(record)} ${record.text}`;
    // Both variants are necessary: العالمين expands the dagger alif, الرحمن does not.
    const expandedAlif = searchable.replace(/\u0670/g, 'ا');
    return {record, search: `${normalizeSearch(searchable)}\n${normalizeSearch(expandedAlif)}`};
  });
}

export function searchRecords(index, query) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const direct = normalized.match(/^(\d+)\s*[:/]\s*(\d+)$/);
  if (direct) return index.filter(item => item.record.surah === Number(direct[1]) && item.record.ayah === Number(direct[2])).map(item => item.record);
  const tokens = normalized.split(/\s+/);
  return index.filter(item => tokens.every(token => item.search.includes(token))).map(item => item.record);
}

export function parseReference(value, recordMap) {
  const match = normalizeSearch(String(value).replace(/^#/, '')).match(/^(\d{1,3}):(\d{1,3})$/);
  if (!match) return null;
  return recordMap.get(`${Number(match[1])}:${Number(match[2])}`) || null;
}

export function validSavedKeys(value, recordMap) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(key => typeof key === 'string' && recordMap.has(key) && hasExplanation(recordMap.get(key))))];
}
