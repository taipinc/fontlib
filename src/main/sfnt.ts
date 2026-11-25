// Extracts a single font from a TrueType/OpenType collection (.ttc/.otc) as a standalone
// sfnt, so the renderer can load one face. Browsers only ever read the first face of a
// collection, which is why this is needed.

export function extractFromCollection(buf: Buffer, index: number): Buffer {
  if (buf.toString('latin1', 0, 4) !== 'ttcf') throw new Error('Not a font collection')
  const numFonts = buf.readUInt32BE(8)
  if (index < 0 || index >= numFonts) throw new Error(`Collection index ${index} out of range`)

  const dirOffset = buf.readUInt32BE(12 + index * 4)
  const sfntVersion = buf.readUInt32BE(dirOffset)
  const numTables = buf.readUInt16BE(dirOffset + 4)

  const tables: { tag: number; checksum: number; offset: number; length: number }[] = []
  for (let i = 0; i < numTables; i++) {
    const rec = dirOffset + 12 + i * 16
    tables.push({
      tag: buf.readUInt32BE(rec),
      checksum: buf.readUInt32BE(rec + 4),
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12)
    })
  }

  const headerSize = 12 + numTables * 16
  const pad4 = (n: number): number => (n + 3) & ~3
  const total = tables.reduce((sum, t) => sum + pad4(t.length), headerSize)
  const out = Buffer.alloc(total)

  // Offset table: copy version, numTables, searchRange, entrySelector, rangeShift.
  out.writeUInt32BE(sfntVersion, 0)
  buf.copy(out, 4, dirOffset + 4, dirOffset + 12)

  let cursor = headerSize
  tables.forEach((t, i) => {
    const rec = 12 + i * 16
    out.writeUInt32BE(t.tag, rec)
    out.writeUInt32BE(t.checksum, rec + 4)
    out.writeUInt32BE(cursor, rec + 8)
    out.writeUInt32BE(t.length, rec + 12)
    buf.copy(out, cursor, t.offset, t.offset + t.length)
    cursor += pad4(t.length)
  })

  return out
}
