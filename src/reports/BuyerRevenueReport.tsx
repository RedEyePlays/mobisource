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
        <p className="empty-state">No realized revenue yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.buyerId}>
                  <td>{row.buyerName}</td>
                  <td>{row.orderCount}</td>
                  <td>
                    <span className="num-md">{formatCents(row.totalRevenue)}</span>
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
