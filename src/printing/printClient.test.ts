import { afterEach, describe, expect, it, vi } from 'vitest'
import { printBulkLabels, printHarvestedLabel } from './printClient'

describe('printClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts a harvested label job with the right template and fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await printHarvestedLabel({ itemId: 'item1', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/print')
    const body = JSON.parse(options.body)
    expect(body).toEqual({
      template: 'harvested',
      copies: 1,
      fields: { itemId: 'item1', skuCode: 'MS-SCRN-IP14P-A-PULL', grade: 'A', model: 'IP14P' },
    })
  })

  it('posts a bulk label job with the requested copy count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await printBulkLabels({ skuCode: 'MS-BATT-IP14P-N-AFT', model: 'IP14P', grade: 'N', partType: 'BATT' }, 25)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.template).toBe('bulk')
    expect(body.copies).toBe(25)
  })

  it('throws with the service error message when the print service rejects the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, error: 'fields.itemId is required.' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      printHarvestedLabel({ itemId: '', skuCode: 'x', grade: 'A', model: 'IP14P' }),
    ).rejects.toThrow('fields.itemId is required.')
  })

  it('throws a clear error when the print service is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      printHarvestedLabel({ itemId: 'x', skuCode: 'x', grade: 'A', model: 'IP14P' }),
    ).rejects.toThrow('Could not reach the print service')
  })
})
