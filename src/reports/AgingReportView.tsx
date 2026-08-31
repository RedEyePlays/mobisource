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
      <h3 className="font-medium mb-2">Days in stock (inStock items only)</h3>
      <table className="w-full text-left border-collapse mb-6">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-4">Age</th>
            <th className="py-2 pr-4">Items</th>
            <th className="py-2 pr-4">Value</th>
          </tr>
        </thead>
        <tbody>
          {report.buckets.map((row) => (
            <tr key={row.bucket} className="border-b">
              <td className="py-2 pr-4">{row.bucket} days</td>
              <td className="py-2 pr-4">{row.count}</td>
              <td className="py-2 pr-4">{formatCents(row.totalValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="font-medium mb-2">Oldest items</h3>
      {report.oldest.length === 0 ? (
        <p className="text-gray-500">No items in stock.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Days in stock</th>
              <th className="py-2 pr-4">Allocated cost</th>
            </tr>
          </thead>
          <tbody>
            {report.oldest.map((row) => (
              <tr key={row.itemId} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{row.skuCode}</td>
                <td className="py-2 pr-4">{row.days}</td>
                <td className="py-2 pr-4">{formatCents(row.allocatedCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
