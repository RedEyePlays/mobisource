import { describe, expect, it } from 'vitest'
import { supplierSkuMapId } from './supplierSkuMapId'

describe('supplierSkuMapId', () => {
  it('is deterministic for the same supplier and supplierSku', () => {
    expect(supplierSkuMapId('Acme Parts', 'AC-1234')).toBe(supplierSkuMapId('Acme Parts', 'AC-1234'))
  })

  it('slugifies to a Firestore-doc-ID-safe string, matching the backend exactly', () => {
    expect(supplierSkuMapId('Acme Parts Inc.', 'AC/1234')).toBe('acme-parts-inc__ac-1234')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(supplierSkuMapId('  Acme  ', 'x1')).toBe(supplierSkuMapId('ACME', 'X1'))
  })

  it('throws when supplier has no alphanumeric content', () => {
    expect(() => supplierSkuMapId('///', 'X1')).toThrow()
  })
})
