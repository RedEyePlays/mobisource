import { useState } from 'react'
import PendingReceiptsList from './PendingReceiptsList'
import ApplyShippingForm from './ApplyShippingForm'
import type { BulkReceipt } from '../types'

export default function PendingShipping() {
  const [receipt, setReceipt] = useState<BulkReceipt | null>(null)

  if (!receipt) {
    return <PendingReceiptsList onSelect={setReceipt} />
  }

  return <ApplyShippingForm receipt={receipt} onBack={() => setReceipt(null)} onDone={() => setReceipt(null)} />
}
