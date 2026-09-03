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
        <p className="empty-state">No stock items yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>Created</th>
                <th>Scrapped</th>
                <th>Scrap rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model}>
                  <td>{row.model}</td>
                  <td>{row.totalCreated}</td>
                  <td>{row.scrapped}</td>
                  <td>
                    <span className="num-md">{formatPct(row.scrapRate)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
