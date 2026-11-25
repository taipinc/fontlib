// Unicode blocks used to group the glyph map. Not exhaustive: anything outside these
// ranges falls under "Other".

const BLOCKS: [number, number, string][] = [
  [0x0020, 0x007f, 'Basic Latin'],
  [0x0080, 0x00ff, 'Latin-1 Supplement'],
  [0x0100, 0x017f, 'Latin Extended-A'],
  [0x0180, 0x024f, 'Latin Extended-B'],
  [0x0250, 0x02af, 'IPA Extensions'],
  [0x02b0, 0x02ff, 'Spacing Modifiers'],
  [0x0300, 0x036f, 'Combining Marks'],
  [0x0370, 0x03ff, 'Greek'],
  [0x0400, 0x052f, 'Cyrillic'],
  [0x0530, 0x058f, 'Armenian'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
  [0x0700, 0x074f, 'Syriac'],
  [0x0750, 0x077f, 'Arabic Supplement'],
  [0x0900, 0x097f, 'Devanagari'],
  [0x0980, 0x09ff, 'Bengali'],
  [0x0a00, 0x0dff, 'Indic Scripts'],
  [0x0e00, 0x0e7f, 'Thai'],
  [0x0e80, 0x0eff, 'Lao'],
  [0x0f00, 0x0fff, 'Tibetan'],
  [0x10a0, 0x10ff, 'Georgian'],
  [0x1100, 0x11ff, 'Hangul Jamo'],
  [0x1e00, 0x1eff, 'Latin Extended Additional'],
  [0x1f00, 0x1fff, 'Greek Extended'],
  [0x2000, 0x206f, 'General Punctuation'],
  [0x2070, 0x209f, 'Super- and Subscripts'],
  [0x20a0, 0x20cf, 'Currency'],
  [0x20d0, 0x20ff, 'Combining Marks for Symbols'],
  [0x2100, 0x214f, 'Letterlike Symbols'],
  [0x2150, 0x218f, 'Number Forms'],
  [0x2190, 0x21ff, 'Arrows'],
  [0x2200, 0x22ff, 'Math Operators'],
  [0x2300, 0x23ff, 'Technical'],
  [0x2400, 0x24ff, 'Enclosed and Control Pictures'],
  [0x2500, 0x259f, 'Box Drawing and Blocks'],
  [0x25a0, 0x25ff, 'Geometric Shapes'],
  [0x2600, 0x27bf, 'Symbols and Dingbats'],
  [0x27c0, 0x2bff, 'Math and Arrows Supplement'],
  [0x2c60, 0x2c7f, 'Latin Extended-C'],
  [0x2de0, 0x2dff, 'Cyrillic Extended-A'],
  [0x2e00, 0x2e7f, 'Supplemental Punctuation'],
  [0x2e80, 0x2fdf, 'CJK Radicals'],
  [0x3000, 0x303f, 'CJK Symbols and Punctuation'],
  [0x3040, 0x309f, 'Hiragana'],
  [0x30a0, 0x30ff, 'Katakana'],
  [0x3100, 0x33ff, 'CJK Compatibility and Kana'],
  [0x3400, 0x4dbf, 'CJK Extension A'],
  [0x4e00, 0x9fff, 'CJK Ideographs'],
  [0xa640, 0xa69f, 'Cyrillic Extended-B'],
  [0xa720, 0xa7ff, 'Latin Extended-D'],
  [0xab30, 0xab6f, 'Latin Extended-E'],
  [0xac00, 0xd7af, 'Hangul Syllables'],
  [0xe000, 0xf8ff, 'Private Use'],
  [0xf900, 0xfaff, 'CJK Compatibility'],
  [0xfb00, 0xfb4f, 'Alphabetic Presentation Forms'],
  [0xfb50, 0xfdff, 'Arabic Presentation Forms-A'],
  [0xfe00, 0xfe0f, 'Variation Selectors'],
  [0xfe20, 0xfe2f, 'Combining Half Marks'],
  [0xfe30, 0xfe6f, 'CJK Compatibility Forms'],
  [0xfe70, 0xfeff, 'Arabic Presentation Forms-B'],
  [0xff00, 0xffef, 'Halfwidth and Fullwidth Forms'],
  [0x1d400, 0x1d7ff, 'Math Alphanumerics'],
  [0x1f000, 0x1faff, 'Emoji and Pictographs']
]

export function blockOf(cp: number): string {
  let lo = 0
  let hi = BLOCKS.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end, name] = BLOCKS[mid]
    if (cp < start) hi = mid - 1
    else if (cp > end) lo = mid + 1
    else return name
  }
  return 'Other'
}

export function hex(cp: number): string {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
}

/** Characters that need a dotted circle to show a combining mark. */
export function displayChar(cp: number): string {
  const ch = String.fromCodePoint(cp)
  return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f)
    ? '◌' + ch
    : ch
}
