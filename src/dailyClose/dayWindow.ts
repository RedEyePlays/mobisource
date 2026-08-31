// Local midnight-to-midnight for "today", computed in the browser's own
// timezone — see closeDay.ts for why the server trusts this rather than
// deriving it itself (a Cloud Function runs in UTC by default).

export interface DayWindow {
  date: string
  fromMs: number
  toMs: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function todayWindow(): DayWindow {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const date = `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`
  return { date, fromMs: from.getTime(), toMs: to.getTime() }
}
