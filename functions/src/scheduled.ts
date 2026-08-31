import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore } from 'firebase-admin/firestore'
import { expireStaleQuotes as expireStaleQuotesCore } from './lib/expireStaleQuotes.js'

// Decision made without asking: the task says quotes older than 7 days
// auto-expire but doesn't say how often to check — daily is frequent
// enough that nothing sits abandoned for much longer than a week while
// staying cheap (one query + a handful of transactions per run).
export const expireStaleQuotes = onSchedule('every 24 hours', async () => {
  await expireStaleQuotesCore(getFirestore())
})
