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
        <p className="text-gray-500">No stock items yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Sold</th>
              <th className="py-2 pr-4">Still inStock</th>
              <th className="py-2 pr-4">Revenue</th>
              <th className="py-2 pr-4">Cost</th>
              <th className="py-2 pr-4">Margin</th>
              <th className="py-2 pr-4">Avg margin/unit</th>
              <th className="py-2 pr-4">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.skuCode} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{row.skuCode}</td>
                <td className="py-2 pr-4">{row.soldCount}</td>
                <td className="py-2 pr-4">{row.inStockCount}</td>
                <td className="py-2 pr-4">{formatCents(row.totalRevenue)}</td>
                <td className="py-2 pr-4">{formatCents(row.totalCost)}</td>
                <td className="py-2 pr-4 font-medium">{formatCents(row.totalMargin)}</td>
                <td className="py-2 pr-4">{row.avgMargin == null ? '—' : formatCents(row.avgMargin)}</td>
                <td className="py-2 pr-4">{formatPct(row.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
