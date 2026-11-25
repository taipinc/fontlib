import * as fontkit from 'fontkit'
import type { Axis } from '@shared/api'

export interface ParsedStyle {
  familyName: string
  styleName: string
  postscriptName: string
  fullName: string | null
  weight: number
  italic: boolean
  width: number
  isVariable: boolean
  axes: Axis[]
  features: string[]
  scripts: string[]
  glyphCount: number
  version: string | null
  designer: string | null
  foundry: string | null
  license: string | null
  licenseUrl: string | null
  /** Index inside a .ttc/.otc collection, or null for single-font files. */
  collectionIndex: number | null
}

// A script counts as covered when the font maps most of these core characters.
const SCRIPT_SAMPLES: Record<string, string> = {
  Latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  'Latin Extended': 'ĀāĂăĄąĆćČčĎďĒēĘęĚěĞğĪīİıŁłŃńŇňŌōŐőŒœŘřŚśŞşŠšŢţŤťŪūŮůŰűŸŹźŻżŽž',
  Greek: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
  Cyrillic: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя',
  Hebrew: 'אבגדהוזחטיכלמנסעפצקרשת',
  Arabic: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
  Armenian: 'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖ',
  Georgian: 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ',
  Devanagari: 'अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह',
  Thai: 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ',
  Kana: 'あいうえおかきくけこさしすせそアイウエオカキクケコサシスセソ',
  Hangul: '가나다라마바사아자차카타파하',
  CJK: '一二三四五六七八九十人大中国日本文字'
}

function detectScripts(charSet: Set<number>): string[] {
  const out: string[] = []
  for (const [script, sample] of Object.entries(SCRIPT_SAMPLES)) {
    const cps = Array.from(sample, (c) => c.codePointAt(0)!)
    const hit = cps.filter((cp) => charSet.has(cp)).length
    if (hit / cps.length >= 0.9) out.push(script)
  }
  return out
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\0/g, '').trim()
  return s.length ? s : null
}

function parseOne(font: fontkit.Font, collectionIndex: number | null): ParsedStyle | null {
  // fontkit typings lag the runtime API (optional lang args, OS/2 fields), so read it loosely.
  const f = font as any
  const postscriptName = clean(f.postscriptName)
  // Prefer the typographic family (name ID 16) so "Inter Bold" lands in "Inter".
  const familyName = clean(f.getName('preferredFamily')) ?? clean(f.familyName)
  if (!postscriptName || !familyName) return null

  const os2 = f['OS/2'] ?? {}
  const axesObj = (f.variationAxes ?? {}) as Record<string, { name: string; min: number; default: number; max: number }>
  const axes: Axis[] = Object.entries(axesObj).map(([tag, a]) => ({
    tag,
    name: a.name ?? tag,
    min: a.min,
    default: a.default,
    max: a.max
  }))

  const italic =
    Boolean(os2.fsSelection?.italic) ||
    Boolean(f.head?.macStyle?.italic) ||
    (typeof f.italicAngle === 'number' && f.italicAngle !== 0)

  let features: string[] = []
  try {
    features = Array.from(new Set<string>(f.availableFeatures ?? [])).sort()
  } catch {
    /* malformed GSUB/GPOS: leave empty */
  }

  let charSet = new Set<number>()
  try {
    charSet = new Set<number>(f.characterSet ?? [])
  } catch {
    /* ignore */
  }

  return {
    familyName,
    styleName: clean(f.getName('preferredSubfamily')) ?? clean(f.subfamilyName) ?? 'Regular',
    postscriptName,
    fullName: clean(f.fullName),
    weight: typeof os2.usWeightClass === 'number' && os2.usWeightClass > 0 ? os2.usWeightClass : 400,
    italic,
    width: typeof os2.usWidthClass === 'number' && os2.usWidthClass > 0 ? os2.usWidthClass : 5,
    isVariable: axes.length > 0,
    axes,
    features,
    scripts: detectScripts(charSet),
    glyphCount: f.numGlyphs ?? 0,
    version: clean(f.getName('version')),
    designer: clean(f.getName('designer')),
    foundry: clean(f.getName('manufacturer')),
    license: clean(f.getName('license')),
    licenseUrl: clean(f.getName('licenseURL')),
    collectionIndex
  }
}

/** Parses a font file buffer into one style per contained font. Throws if it isn't a font. */
export function parseFontBuffer(buffer: Buffer): ParsedStyle[] {
  const result = fontkit.create(buffer) as any
  if (result.type === 'TTC' || result.type === 'DFont') {
    const fonts: fontkit.Font[] = result.fonts
    return fonts.map((font, i) => parseOne(font, i)).filter((s): s is ParsedStyle => s !== null)
  }
  const one = parseOne(result as fontkit.Font, null)
  return one ? [one] : []
}
