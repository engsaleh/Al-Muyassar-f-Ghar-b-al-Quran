# Mushaf source assets

The unmodified original `hafs.json` is from Quran.ws / quran-ws/quran-text, with source format `quran-mushaf` version 1.0. The deployed copy is `../../dist/data/mushaf.json` and has identical bytes. Its SHA-256 is `bcfe3e9f2f3a9a57428c503c67667a5f32c2779ce20e90c7e553fae54a4abd26`.

The full source URLs, provenance (including the v3 provenance limitation), file hashes, licensing distinctions, and validation report are in `../../dist/data/mushaf-source.json`. `LICENSE.txt` is the upstream license copied verbatim, including the publisher's Quran text and font usage terms. Quran.ws's data work is CC BY 4.0; this does not replace KFGQPC publisher terms or the separate glossary license.

`verification.json` records comparison of all 6,236 ayahs against the original KFGQPC Hafs v2.0 CSV: page, start line, and end line all match. The source archive/CSV is identified by URL and SHA-256 in the deployed source manifest. The large archive is not bundled.

## Indices and verse lookup

`words` contains 77,432 Quran word strings. `surah_starts` (114), `ayah_starts` (6,236), `page_starts` (604), and `line_starts` (8,820) contain zero-based word indices. They have no terminal sentinel. Use `words.length` as the last end. For a 1-based surah and ayah:

```js
const ayahIndex = mushaf.surahs[surah - 1].first_ayah + ayah - 1;
const firstWord = mushaf.ayah_starts[ayahIndex];
const lastWordExclusive = mushaf.ayah_starts[ayahIndex + 1] ?? mushaf.words.length;
const globalWord = firstWord + position - 1;
```

`position` is 1-based within the ayah. Verse-end numerals and separated marks are not words. `numbering` is cross-riwayah numbering and is not the glossary position. The word segmentation count differs from some older corpora, so use the separately verified glossary mapping.

## Marks

`marks` contains 4,517 pairs `[wordIndex, markTypeIndex]`. Each refers to `mark_types`, whose objects have `kind`, `side`, and `sign`. Preserve the source order if multiple marks target a word. Append `side: "after"` directly to the word, with no added space. For `side: "before"`, display the sign before the word with a separating space. Do not count the signs as word positions. Keep the original font with the text; it covers source-specific Quranic Unicode characters.

## Printed row numbers

The deployed `../../dist/data/page-lines.json` has `pages`, each with `page` and `lines`. A line is `{line, firstWord, lastWordExclusive, surahStart}`. The two word indices form a half-open interval. `line` is the actual printed row number, not its zero-based position in the array. `surahStart` is a 1-based surah number or null.

Text rows omit headings and uncounted basmalas. For each `surahStart`, place its heading at `line - 2` and the basmala at `line - 1`, except surahs 1 and 9: each has only a heading at `line - 1`. Fatiha's first ayah is the basmala; Tawbah has none.

Pages 1 and 2 use 8 rows in this source: Fatiha text rows 2–8; Baqarah page 2 text rows 3–8. Pages 3–604 use exactly 15 rows after adding headings and basmalas. Page 604 text rows are 3, 4, 7, 8, 9, 12, 13, 14, 15. Do not compress those gaps away.

## Bundled files

- Original `hafs.json` and its identical deployed copy.
- Deployed `page-lines.json`, derived from the documented source boundaries.
- Original unmodified `UthmanicHafs-v-3.0.ttf` under `dist/fonts`.
- Upstream license and this source verification report.
