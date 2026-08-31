import { useMemo } from 'react'
import { buyerRevenue } from './aggregations'
import type { Buyer, Cents, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function BuyerRevenueReport({ salesOrders, buyers }: { salesOrders: SalesOrder[]; buyers: Buyer[] }) {
  const rows = useMemo(() => buyerRevenue(salesOrders, buyers), [salesOrders, buyers])

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-gray-500">No realized revenue yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Buyer</th>
              <th className="py-2 pr-4">Orders</th>
              <th className="py-2 pr-4">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.buyerId} className="border-b">
                <td className="py-2 pr-4">{row.buyerName}</td>
                <td className="py-2 pr-4">{row.orderCount}</td>
                <td className="py-2 pr-4 font-medium">{formatCents(row.totalRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
