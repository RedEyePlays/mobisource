import { useMemo } from 'react'
import { adjustmentsReport } from './aggregations'
import type { StockMovement } from '../types'

export default function AdjustmentsReport({ movements }: { movements: StockMovement[] }) {
  const rows = useMemo(
    () => adjustmentsReport(movements.filter((m) => m.type === 'adjust')),
    [movements],
  )

  return (
    <div>
      {rows.length === 0 ? (
        <p className="empty-state">No adjustments yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>SKU</th>
                <th>Item</th>
                <th>Qty change</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.movementId}>
                  <td className="text-muted text-sm">{row.at.toLocaleString()}</td>
                  <td className="font-mono text-sm">{row.skuCode}</td>
                  <td className="font-mono text-sm">{row.itemId || '—'}</td>
                  <td>
                    <span className={row.qty < 0 ? 'text-danger num-md' : 'num-md'}>
                      {row.qty > 0 ? `+${row.qty}` : row.qty}
                    </span>
                  </td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
