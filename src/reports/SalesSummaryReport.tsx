import { useMemo, useState } from 'react'
import { salesSummaryByPaymentMethod } from './aggregations'
import type { PaymentMethodBucket } from './aggregations'
import type { Cents, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

const METHOD_LABEL: Record<PaymentMethodBucket, string> = {
  cash: 'Cash',
  card: 'Card',
  eTransfer: 'e-Transfer',
  account: 'On account',
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function firstOfThisMonth(): string {
  const now = new Date()
  return isoDate(new Date(now.getFullYear(), now.getMonth(), 1))
}

export default function SalesSummaryReport({ salesOrders }: { salesOrders: SalesOrder[] }) {
  const [fromStr, setFromStr] = useState(firstOfThisMonth())
  const [toStr, setToStr] = useState(isoDate(new Date()))

  // Whole-day range: `to` extends to the last instant of that day so a
  // sale confirmed any time on the end date is included.
  const report = useMemo(() => {
    const from = new Date(`${fromStr}T00:00:00`)
    const to = new Date(`${toStr}T23:59:59.999`)
    return salesSummaryByPaymentMethod(salesOrders, { from, to })
  }, [salesOrders, fromStr, toStr])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="field">
          From
          <input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} className="input" />
        </label>
        <label className="field">
          To
          <input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} className="input" />
        </label>
      </div>

      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>Payment method</th>
              <th>Orders</th>
              <th>Subtotal</th>
              <th>HST</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.byMethod.map((row) => (
              <tr key={row.method}>
                <td>{METHOD_LABEL[row.method]}</td>
                <td>{row.orderCount}</td>
                <td>{formatCents(row.subtotal)}</td>
                <td>{formatCents(row.tax)}</td>
                <td>
                  <span className="num-md">{formatCents(row.total)}</span>
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-semibold dark:border-slate-800">
              <td>Grand total</td>
              <td>{report.grandTotal.orderCount}</td>
              <td>{formatCents(report.grandTotal.subtotal)}</td>
              <td>{formatCents(report.grandTotal.tax)}</td>
              <td>
                <span className="num-md">{formatCents(report.grandTotal.total)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
