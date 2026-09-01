import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { intakeDonor } from './donors.js'
export { createSku, updateSku, deactivateSku } from './skus.js'
export { performTeardown } from './teardown.js'
export { createBuyer, updateBuyer } from './buyers.js'
export { createOrder, confirmOrder, cancelOrder } from './orders.js'
export { receiveBulkShipment, applyReceiptShipping } from './receiving.js'
export { getInvoicePdf } from './invoices.js'
export { processReturn, getCreditNotePdf } from './returns.js'
// expireStaleQuotes (onSchedule, scheduled.ts) is temporarily NOT exported:
// deploying a scheduled function requires the Cloud Scheduler API enabled
// on the GCP project, and the deploying service account currently lacks
// permission to auto-enable it, which fails the whole `functions` deploy
// (see https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com
// — a project owner needs to enable it there, or grant the deploy service
// account the Service Usage Admin role). The underlying logic
// (lib/expireStaleQuotes.ts) and its tests are untouched — quotes just
// don't auto-expire on a timer until this line is restored. To re-enable:
// uncomment the line below once Cloud Scheduler is enabled.
// export { expireStaleQuotes } from './scheduled.js'
export { adjustStock } from './inventory.js'
export { recordExpense } from './expenses.js'
export { closeDay } from './dailyClose.js'
export { createTeardownProfile, updateTeardownProfile, deleteTeardownProfile } from './teardownProfiles.js'
