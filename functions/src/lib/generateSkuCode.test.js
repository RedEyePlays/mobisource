import { describe, expect, it } from 'vitest'
import { generateSkuCode } from './generateSkuCode.js'

describe('generateSkuCode', () => {
  it('builds the code from field values', () => {
    expect(
      generateSkuCode({ partType: 'SCRN', model: 'IP14P', grade: 'A', source: 'PULL' }),
    ).toBe('MS-SCRN-IP14P-A-PULL')
  })

  it('gives a pull and an aftermarket part different codes even with the same part/model/grade-equivalent', () => {
    const pull = generateSkuCode({ partType: 'SCRN', model: 'IP14P', grade: 'N', source: 'PULL' })
    const aft = generateSkuCode({ partType: 'SCRN', model: 'IP14P', grade: 'N', source: 'AFT' })
    expect(pull).not.toBe(aft)
  })

  it('throws on an unknown partType', () => {
    expect(() => generateSkuCode({ partType: 'WIDGET', model: 'IP14P', grade: 'A', source: 'PULL' })).toThrow()
  })

  it('throws on an unknown grade', () => {
    expect(() => generateSkuCode({ partType: 'SCRN', model: 'IP14P', grade: 'Z', source: 'PULL' })).toThrow()
  })

  it('throws on an unknown source', () => {
    expect(() => generateSkuCode({ partType: 'SCRN', model: 'IP14P', grade: 'A', source: 'EBAY' })).toThrow()
  })

  it('throws on a malformed model code', () => {
    expect(() => generateSkuCode({ partType: 'SCRN', model: 'ip14p', grade: 'A', source: 'PULL' })).toThrow()
    expect(() => generateSkuCode({ partType: 'SCRN', model: '', grade: 'A', source: 'PULL' })).toThrow()
  })
})
