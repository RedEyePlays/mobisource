import { describe, expect, it } from 'vitest'
import { bulkLabelZpl, harvestedLabelZpl, LABEL_LAYOUT } from './zpl.js'

describe('harvestedLabelZpl', () => {
  it('starts and ends a well-formed ZPL format', () => {
    const zpl = harvestedLabelZpl({ itemId: 'abc123', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' })
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.trim().endsWith('^XZ')).toBe(true)
  })

  it('sets the print width/length for a 2x1in label at 203dpi', () => {
    const zpl = harvestedLabelZpl({ itemId: 'abc123', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' })
    expect(zpl).toContain(`^PW${LABEL_LAYOUT.widthDots}`)
    expect(zpl).toContain(`^LL${LABEL_LAYOUT.heightDots}`)
    expect(LABEL_LAYOUT.widthDots).toBe(406)
    expect(LABEL_LAYOUT.heightDots).toBe(203)
  })

  it('encodes the itemId in the QR field, not the skuCode', () => {
    const zpl = harvestedLabelZpl({ itemId: 'the-item-id', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' })
    expect(zpl).toContain('^FDQA,the-item-id^FS')
    expect(zpl).not.toContain('^FDQA,MS-SCRN-IP14P-A-PULL^FS')
  })

  it('prints model, grade, and skuCode as human-readable text', () => {
    const zpl = harvestedLabelZpl({ itemId: 'x', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' })
    expect(zpl).toContain('^FDIP14P^FS')
    expect(zpl).toContain('^FDGrade A^FS')
    expect(zpl).toContain('^FDMS-SCRN-IP14P-A-PULL^FS')
  })

  it('defaults to one copy', () => {
    const zpl = harvestedLabelZpl({ itemId: 'x', skuCode: 'y', grade: 'A', model: 'IP14P' })
    expect(zpl).toContain('^PQ1')
  })

  it('strips ZPL control characters out of field data rather than corrupting the format', () => {
    const zpl = harvestedLabelZpl({ itemId: 'a^b~c\nd', skuCode: 'y', grade: 'A', model: 'IP14P' })
    // ^ and ~ are removed outright (they'd be parsed as ZPL command/control
    // prefixes); a newline becomes a space instead, so text doesn't get
    // mashed together rather than being silently dropped.
    expect(zpl).toContain('^FDQA,abc d^FS')
  })
})

describe('bulkLabelZpl', () => {
  it('encodes the skuCode in the QR field — same barcode for every unit', () => {
    const zpl = bulkLabelZpl({ skuCode: 'MS-BATT-IP14P-N-AFT', model: 'IP14P', grade: 'N', partType: 'BATT' }, 5)
    expect(zpl).toContain('^FDQA,MS-BATT-IP14P-N-AFT^FS')
  })

  it('sets ^PQ to the requested copy count, for the printer to repeat the format', () => {
    const zpl = bulkLabelZpl({ skuCode: 'MS-BATT-IP14P-N-AFT', model: 'IP14P', grade: 'N', partType: 'BATT' }, 25)
    expect(zpl).toContain('^PQ25')
    // exactly one ^XA...^XZ format is sent — the printer repeats it, the
    // service never concatenates N copies of the format itself
    expect(zpl.match(/\^XA/g)?.length).toBe(1)
  })

  it('rounds a non-integer copies down to a sane minimum of 1', () => {
    const zpl = bulkLabelZpl({ skuCode: 'x', model: 'IP14P', grade: 'N', partType: 'BATT' }, 0)
    expect(zpl).toContain('^PQ1')
  })

  it('includes partType and grade as human-readable text', () => {
    const zpl = bulkLabelZpl({ skuCode: 'x', model: 'IP14P', grade: 'N', partType: 'BATT' })
    expect(zpl).toContain('^FDBATT - Grade N^FS')
  })
})
