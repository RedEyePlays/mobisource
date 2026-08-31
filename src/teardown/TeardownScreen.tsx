import { useState } from 'react'
import DonorSearch from './DonorSearch'
import TeardownChecklist from './TeardownChecklist'
import type { Donor } from '../types'

export default function TeardownScreen() {
  const [donor, setDonor] = useState<Donor | null>(null)
  const [justCompletedModel, setJustCompletedModel] = useState<string | null>(null)

  if (!donor) {
    return (
      <div>
        {justCompletedModel && (
          <div className="mx-auto max-w-lg px-4 pt-4">
            <div className="banner-success flex items-center justify-between">
              <span>{justCompletedModel} torn down.</span>
              <button onClick={() => setJustCompletedModel(null)} className="font-medium text-emerald-700 dark:text-emerald-300">
                Dismiss
              </button>
            </div>
          </div>
        )}
        <DonorSearch
          onSelect={(d) => {
            setJustCompletedModel(null)
            setDonor(d)
          }}
        />
      </div>
    )
  }

  return (
    <TeardownChecklist
      donor={donor}
      onBack={() => setDonor(null)}
      onDone={() => {
        setJustCompletedModel(donor.model)
        setDonor(null)
      }}
    />
  )
}
