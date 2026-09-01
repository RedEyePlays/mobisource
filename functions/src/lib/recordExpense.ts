import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { cents } from './types.js'
import type { Expense } from './types.js'

export interface RecordExpenseInput {
  /** ISO date string — when the expense was incurred, not when it's being recorded. */
  date?: unknown
  description?: unknown
  /** Total paid, in CAD cents, tax included. */
  amount?: unknown
  /** The HST portion of amount — optional, defaults to 0. */
  hstPaidCAD?: unknown
}

export interface RecordExpenseResult {
  expenseId: string
}

/**
 * Records a business expense — the other source of input tax credits
 * alongside bulkReceipts.hstPaidCAD (docs/SCHEMA.md §17). A plain create,
 * not a transaction: nothing else in the system reads or derives from an
 * expense, so there's no invariant to protect across documents the way
 * there is for, say, a sequential counter.
 */
export async function recordExpense(db: Firestore, input: RecordExpenseInput): Promise<RecordExpenseResult> {
  if (typeof input.description !== 'string' || !input.description.trim()) {
    throw new Error('description is required.')
  }
  if (typeof input.date !== 'string' || !input.date.trim()) {
    throw new Error('date is required.')
  }
  const parsedDate = new Date(input.date)
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error('date must be a valid date.')
  }
  if (!Number.isInteger(input.amount) || (input.amount as number) < 0) {
    throw new Error('amount must be a non-negative integer (cents).')
  }
  const rawHstPaid = input.hstPaidCAD ?? 0
  if (!Number.isInteger(rawHstPaid) || (rawHstPaid as number) < 0) {
    throw new Error('hstPaidCAD must be a non-negative integer (cents).')
  }
  const amount = input.amount as number
  const hstPaidCAD = rawHstPaid as number
  if (hstPaidCAD > amount) {
    throw new Error('hstPaidCAD cannot exceed amount.')
  }

  const ref = db.collection('expenses').doc()
  const expense: WithFieldValue<Expense> = {
    expenseId: ref.id,
    date: Timestamp.fromDate(parsedDate),
    description: input.description.trim(),
    amount: cents(amount),
    hstPaidCAD: cents(hstPaidCAD),
    createdAt: FieldValue.serverTimestamp(),
  }
  await ref.set(expense)

  return { expenseId: ref.id }
}
