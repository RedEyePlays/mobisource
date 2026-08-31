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
    <div className="border rounded-lg px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">{label}</div>
          <div className="text-sm text-gray-500 font-mono">{skuCode}</div>
        </div>
        <div className="flex items-center gap-2">
          {outcome === 'harvested' && allocatedPreview != null && (
            <span className="text-lg font-medium">{formatCents(allocatedPreview)}</span>
          )}
          {onRemove && (
            <button onClick={onRemove} className="text-gray-400 text-sm px-2 py-1" aria-label={`Remove ${label}`}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onOutcomeChange('harvested')}
          className={`flex-1 py-3 rounded-lg text-base font-medium ${
            outcome === 'harvested' ? 'bg-black text-white' : 'border text-gray-700'
          }`}
        >
          Harvested
        </button>
        <button
          onClick={() => onOutcomeChange('scrapped')}
          className={`flex-1 py-3 rounded-lg text-base font-medium ${
            outcome === 'scrapped' ? 'bg-black text-white' : 'border text-gray-700'
          }`}
        >
          Scrapped
        </button>
        <button
          onClick={() => onOutcomeChange('notHarvested')}
          className={`flex-1 py-3 rounded-lg text-base font-medium ${
            outcome === 'notHarvested' ? 'bg-black text-white' : 'border text-gray-700'
          }`}
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
                className={`px-3 py-2 rounded-full text-sm ${
                  reason === preset ? 'bg-black text-white' : 'border text-gray-700'
                }`}
              >
                {preset}
              </button>
            ))}
            <button
              onClick={() => setCustomReasonOpen(true)}
              className={`px-3 py-2 rounded-full text-sm ${
                customReasonOpen ? 'bg-black text-white' : 'border text-gray-700'
              }`}
            >
              Other
            </button>
          </div>
          {customReasonOpen && (
            <input
              type="text"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Reason"
              className="border rounded-lg px-3 py-3 text-base"
            />
          )}
          {!reason.trim() && <p className="text-red-600 text-sm">A reason is required for a scrapped part.</p>}
        </div>
      )}
    </div>
  )
}
