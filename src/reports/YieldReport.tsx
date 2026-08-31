import { useMemo } from 'react'
import { yieldRateByModel } from './aggregations'
import type { Sku, StockItem } from '../types'

function formatPct(pct: number | null) {
  return pct == null ? '—' : `${(pct * 100).toFixed(1)}%`
}

export default function YieldReport({ stockItems, skus }: { stockItems: StockItem[]; skus: Sku[] }) {
  const rows = useMemo(() => yieldRateByModel(stockItems, skus), [stockItems, skus])

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-gray-500">No stock items yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Scrapped</th>
              <th className="py-2 pr-4">Scrap rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} className="border-b">
                <td className="py-2 pr-4">{row.model}</td>
                <td className="py-2 pr-4">{row.totalCreated}</td>
                <td className="py-2 pr-4">{row.scrapped}</td>
                <td className="py-2 pr-4 font-medium">{formatPct(row.scrapRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
