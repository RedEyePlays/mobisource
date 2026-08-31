import { resolveLinePrice } from './resolveLinePrice'
import type { CartLine } from './cart'
import type { Buyer, Cents } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function lineLabel(line: CartLine): string {
  return `${line.sku.partType} · ${line.sku.model}${line.kind === 'item' ? ` · Grade ${line.grade}` : ''}`
}

export default function Cart({
  lines,
  buyer,
  onRemove,
  onQtyChange,
}: {
  lines: CartLine[]
  buyer: Buyer
  onRemove: (index: number) => void
  onQtyChange: (skuCode: string, qty: number) => void
}) {
  const priced = lines.map((line) => {
    const unitPrice = resolveLinePrice({ sku: line.sku, buyer, qty: line.qty })
    return { line, unitPrice, lineTotal: (unitPrice * line.qty) as Cents }
  })
  const subtotal = priced.reduce((sum, p) => sum + p.lineTotal, 0) as Cents

  if (lines.length === 0) {
    return <p className="text-muted py-8 text-center text-lg">Cart is empty — scan or search a part to add it.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {priced.map(({ line, lineTotal }, i) => (
        <div key={line.kind === 'item' ? line.itemId : line.skuCode} className="card flex flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{lineLabel(line)}</div>
              <div className="text-muted truncate font-mono text-xs">{line.skuCode}</div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-danger shrink-0 px-1 text-sm"
              aria-label={`Remove ${line.skuCode}`}
            >
              Remove
            </button>
          </div>

          <div className="flex items-center justify-between">
            {line.kind === 'bulk' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onQtyChange(line.skuCode, Math.max(1, line.qty - 1))}
                  className="btn-secondary btn-sm min-h-9 w-9 px-0"
                  aria-label={`Decrease quantity for ${line.skuCode}`}
                >
                  −
                </button>
                <span className="num-md w-6 text-center">{line.qty}</span>
                <button
                  type="button"
                  onClick={() => onQtyChange(line.skuCode, line.qty + 1)}
                  className="btn-secondary btn-sm min-h-9 w-9 px-0"
                  aria-label={`Increase quantity for ${line.skuCode}`}
                >
                  +
                </button>
              </div>
            ) : (
              <span />
            )}
            <span className="num-md">{formatCents(lineTotal)}</span>
          </div>

          {line.kind === 'bulk' && line.qty > line.qtyOnHand && (
            <p className="text-danger text-xs">Only {line.qtyOnHand} in stock as of last check</p>
          )}
        </div>
      ))}

      <div className="card flex items-center justify-between p-4">
        <span className="section-title">Total</span>
        <span className="num-hero">{formatCents(subtotal)}</span>
      </div>
      <p className="text-muted text-xs">Prices shown are an estimate — the real charge is resolved at checkout.</p>
    </div>
  )
}
