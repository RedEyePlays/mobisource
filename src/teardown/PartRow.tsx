import { useState } from 'react'
import type { Cents } from '../types'

export type PartOutcome = 'harvested' | 'scrapped' | 'notHarvested'

const SCRAP_REASON_PRESETS = ['Cracked', 'Water damage', 'No power', 'Bent / warped', 'Missing parts']

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

interface PartRowProps {
  skuCode: string
  label: string
  outcome: PartOutcome
  reason: string
  allocatedPreview: Cents | null
  onOutcomeChange: (outcome: PartOutcome) => void
  onReasonChange: (reason: string) => void
  onRemove?: () => void
}

export default function PartRow({
  skuCode,
  label,
  outcome,
  reason,
  allocatedPreview,
  onOutcomeChange,
  onReasonChange,
  onRemove,
}: PartRowProps) {
  const [customReasonOpen, setCustomReasonOpen] = useState(
    reason !== '' && !SCRAP_REASON_PRESETS.includes(reason),
  )

  return (
    <div className="card px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{label}</div>
          <div className="text-muted font-mono text-sm">{skuCode}</div>
        </div>
        <div className="flex items-center gap-2">
          {outcome === 'harvested' && allocatedPreview != null && (
            <span className="num-lg">{formatCents(allocatedPreview)}</span>
          )}
          {onRemove && (
            <button onClick={onRemove} className="text-muted px-2 py-1 text-sm" aria-label={`Remove ${label}`}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onOutcomeChange('harvested')}
          className={outcome === 'harvested' ? 'btn-toggle-on' : 'btn-toggle-off'}
        >
          Harvested
        </button>
        <button
          onClick={() => onOutcomeChange('scrapped')}
          className={outcome === 'scrapped' ? 'btn-toggle-on' : 'btn-toggle-off'}
        >
          Scrapped
        </button>
        <button
          onClick={() => onOutcomeChange('notHarvested')}
          className={outcome === 'notHarvested' ? 'btn-toggle-on' : 'btn-toggle-off'}
        >
          Not harvested
        </button>
      </div>

      {outcome === 'scrapped' && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {SCRAP_REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setCustomReasonOpen(false)
                  onReasonChange(preset)
                }}
                className={reason === preset ? 'chip-on' : 'chip-off'}
              >
                {preset}
              </button>
            ))}
            <button onClick={() => setCustomReasonOpen(true)} className={customReasonOpen ? 'chip-on' : 'chip-off'}>
              Other
            </button>
          </div>
          {customReasonOpen && (
            <input
              type="text"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Reason"
              className="input"
            />
          )}
          {!reason.trim() && <p className="text-danger text-sm">A reason is required for a scrapped part.</p>}
        </div>
      )}
    </div>
  )
}
