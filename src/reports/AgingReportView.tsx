import { useMemo } from 'react'
import { agingBuckets } from './aggregations'
import type { Cents, StockItem } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function AgingReportView({ stockItems, now }: { stockItems: StockItem[]; now: Date }) {
  const report = useMemo(() => agingBuckets(stockItems, now), [stockItems, now])

  return (
    <div>
      <h3 className="section-title mb-2">Days in stock (inStock items only)</h3>
      <div className="table-wrap mb-6">
        <table className="table-base">
          <thead>
            <tr>
              <th>Age</th>
              <th>Items</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {report.buckets.map((row) => (
              <tr key={row.bucket}>
                <td>{row.bucket} days</td>
                <td>{row.count}</td>
                <td>
                  <span className="num-md">{formatCents(row.totalValue)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title mb-2">Oldest items</h3>
      {report.oldest.length === 0 ? (
        <p className="text-muted">No items in stock.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Days in stock</th>
                <th>Allocated cost</th>
              </tr>
            </thead>
            <tbody>
              {report.oldest.map((row) => (
                <tr key={row.itemId}>
                  <td className="font-mono text-sm">{row.skuCode}</td>
                  <td>{row.days}</td>
                  <td>
                    <span className="num-md">{formatCents(row.allocatedCost)}</span>
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
