import type { Cents, PaymentMethod } from '../types'

export interface ReceiptLine {
  skuCode: string
  label: string
  qty: number
  unitPrice: Cents
}

export interface ReceiptData {
  orderId: string
  buyerName: string
  paymentMethod: PaymentMethod
  lines: ReceiptLine[]
  subtotal: Cents
  tax: Cents
  taxRateBps: number
  total: Cents
  confirmedAt: Date
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  eTransfer: 'e-Transfer',
}

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function Receipt({ receipt, onNewSale }: { receipt: ReceiptData; onNewSale: () => void }) {
  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="mb-4 flex gap-2 print:hidden">
        <button onClick={() => window.print()} className="btn-primary flex-1">
          Print receipt
        </button>
        <button onClick={onNewSale} className="btn-secondary flex-1">
          New sale
        </button>
      </div>

      <div className="receipt-print card p-6">
        <h2 className="page-title mb-1 text-center">MobiSource</h2>
        <p className="text-muted mb-4 text-center text-sm">
          {receipt.confirmedAt.toLocaleString()} · Order {receipt.orderId}
        </p>

        <div className="table-wrap mb-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line, i) => (
                <tr key={`${line.skuCode}-${i}`}>
                  <td>
                    <div>{line.label}</div>
                    <div className="text-muted font-mono text-xs">{line.skuCode}</div>
                  </td>
                  <td>{line.qty}</td>
                  <td className="num-md">{formatCents((line.unitPrice * line.qty) as Cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Subtotal:</span>
            <span className="num-md">{formatCents(receipt.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">
              {receipt.taxRateBps > 0 ? `HST (${receipt.taxRateBps / 100}%):` : 'Tax:'}
            </span>
            <span className="num-md">{formatCents(receipt.tax)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
            <span className="section-title">Total:</span>
            <span className="num-hero">{formatCents(receipt.total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Paid by:</span>
            <span className="num-md">{PAYMENT_LABEL[receipt.paymentMethod]}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Buyer:</span>
            <span>{receipt.buyerName}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
