import { useMemo } from 'react'
import { marginBySku } from './aggregations'
import type { Cents, StockItem } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function formatPct(pct: number | null) {
  return pct == null ? '—' : `${(pct * 100).toFixed(1)}%`
}

export default function MarginReport({ stockItems }: { stockItems: StockItem[] }) {
  const rows = useMemo(() => marginBySku(stockItems), [stockItems])

  return (
    <div>
      {rows.length === 0 ? (
        <p className="empty-state">No stock items yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Sold</th>
                <th>Still inStock</th>
                <th>Returned (DOA)</th>
                <th>Revenue</th>
                <th>Cost</th>
                <th>Margin</th>
                <th>Avg margin/unit</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.skuCode}>
                  <td className="font-mono text-sm">{row.skuCode}</td>
                  <td>{row.soldCount}</td>
                  <td>{row.inStockCount}</td>
                  <td className={row.returnedCount > 0 ? 'text-danger' : undefined}>{row.returnedCount}</td>
                  <td>{formatCents(row.totalRevenue)}</td>
                  <td>{formatCents(row.totalCost)}</td>
                  <td>
                    <span className="num-md">{formatCents(row.totalMargin)}</span>
                  </td>
                  <td>{row.avgMargin == null ? '—' : formatCents(row.avgMargin)}</td>
                  <td>
                    <span className="num-md">{formatPct(row.marginPct)}</span>
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
