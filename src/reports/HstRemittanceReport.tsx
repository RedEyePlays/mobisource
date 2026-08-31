import { useMemo, useState } from 'react'
import { hstRemittanceReport } from './aggregations'
import type { BulkReceipt, Cents, Expense, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

type Grouping = 'month' | 'quarter'

export default function HstRemittanceReport({
  salesOrders,
  bulkReceipts,
  expenses,
}: {
  salesOrders: SalesOrder[]
  bulkReceipts: BulkReceipt[]
  expenses: Expense[]
}) {
  const [grouping, setGrouping] = useState<Grouping>('month')

  const report = useMemo(() => {
    const purchases = [
      ...bulkReceipts.map((r) => ({ at: r.receivedAt, hstPaidCAD: r.hstPaidCAD })),
      ...expenses.map((e) => ({ at: e.date, hstPaidCAD: e.hstPaidCAD })),
    ]
    return hstRemittanceReport(salesOrders, purchases)
  }, [salesOrders, bulkReceipts, expenses])

  const rows = grouping === 'month' ? report.byMonth : report.byQuarter

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setGrouping('month')}
          className={grouping === 'month' ? 'tab-link-on' : 'tab-link-off'}
        >
          By month
        </button>
        <button
          onClick={() => setGrouping('quarter')}
          className={grouping === 'quarter' ? 'tab-link-on' : 'tab-link-off'}
        >
          By quarter
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted">No HST activity yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Period</th>
                <th>HST collected</th>
                <th>HST paid (ITCs)</th>
                <th>Net owing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  <td>{formatCents(row.hstCollected)}</td>
                  <td>{formatCents(row.hstPaid)}</td>
                  <td>
                    <span className="num-md">{formatCents(row.netOwing)}</span>
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
