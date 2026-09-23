import { addMonths, addWeeks, addYears, format, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { getAllIncomes, getAllReceipts, saveIncome, saveReceipt, updateReceipt } from './database';
import { parseYmdLocal } from './parser';
import { Income, Receipt } from '../types';

const YMD = 'yyyy-MM-dd';

/** Pseudo-category key for the "Recurring" budget row (Settings +
 *  Home) — not a real Receipt.category, a separate axis covering every
 *  receipt with an active recurring schedule OR generated from one,
 *  regardless of that receipt's own category. */
export const RECURRING_BUDGET_KEY = 'Recurring';

/** True for the original template (has an active `recurring` schedule)
 *  and every occurrence processRecurringReceipts generated from it
 *  (flagged via `isRecurringOccurrence` since the clone itself doesn't
 *  carry the schedule forward — only the template does). */
export function isRecurringExpense(receipt: Receipt): boolean {
  return Boolean(receipt.recurring) || Boolean(receipt.isRecurringOccurrence);
}

function today(): string {
  return format(new Date(), YMD);
}

/** Exported so callers creating a fresh recurring schedule can seed
 *  `nextDueDate` one period AHEAD of the receipt's own date — the
 *  receipt itself is occurrence zero, so the schedule must not treat
 *  that same date as already due (see scan.tsx / edit/[id].tsx). */
export function advance(
  dateStr: string,
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly',
): string {
  const d = parseISO(dateStr);
  const next =
    frequency === 'weekly'
      ? addWeeks(d, 1)
      : frequency === 'biweekly'
        ? addWeeks(d, 2)
        : frequency === 'monthly'
          ? addMonths(d, 1)
          : addYears(d, 1);
  return format(next, YMD);
}

/** Given a start date + a duration in months, the ISO end date after
 *  which auto-add stops. Exposed so the UI can show/derive it without
 *  duplicating the date-fns call. */
export function computeRecurringEndDate(startDate: string, durationMonths: number): string {
  return format(addMonths(parseISO(startDate), durationMonths), YMD);
}

export function resolveRecurringFromForm(args: {
  enabled: boolean;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  nextDueDate: string;
  duration: string;
  startDate: string;
  existingEndDate?: string;
}):
  | { ok: true; schedule: Income['recurring'] | undefined }
  | { ok: false; message: string } {
  if (!args.enabled) return { ok: true, schedule: undefined };
  const next = parseYmdLocal(args.nextDueDate.trim());
  if (!next) return { ok: false, message: 'Pick a valid next auto-add date.' };
  const trimmed = args.duration.trim();
  const months = parseInt(trimmed, 10);
  const validDuration = trimmed.length > 0 && !Number.isNaN(months) && months > 0 && String(months) === trimmed;
  if (!args.existingEndDate && !validDuration) {
    return { ok: false, message: 'Enter how many months this should repeat.' };
  }
  const endDate = validDuration
    ? computeRecurringEndDate(args.startDate, months)
    : args.existingEndDate!;
  return {
    ok: true,
    schedule: {
      frequency: args.frequency,
      nextDueDate: format(next, YMD),
      endDate,
    },
  };
}

/**
 * Walk every receipt with an active `recurring` config and materialize
 * any occurrences due between its `nextDueDate` and today (inclusive),
 * up to `endDate`. Each occurrence becomes its own real, savable Receipt
 * — a plain clone of the template with a fresh id/date, NOT itself
 * recurring (only the original template carries the schedule forward).
 *
 * Safe to call repeatedly (e.g. once per app foreground) — a receipt
 * whose nextDueDate is already past endDate, or in the future, is a
 * no-op. Capped at 60 generated occurrences per template per call as a
 * defensive guard against a corrupted/very old nextDueDate looping
 * effectively forever.
 *
 * Must be called AFTER setCurrentUserId (getAllReceipts/saveReceipt are
 * user-scoped and throw otherwise) — see lib/AuthContext.tsx.
 */
export async function processRecurringReceipts(): Promise<number> {
  const receipts = await getAllReceipts();
  const t = today();
  let created = 0;

  for (const template of receipts) {
    const schedule = template.recurring;
    if (!schedule) continue;

    let { nextDueDate } = schedule;
    const { endDate, frequency } = schedule;
    let guard = 0;
    let advanced = false;

    while (nextDueDate <= t && nextDueDate <= endDate && guard < 60) {
      const occurrence: Receipt = {
        ...template,
        id: uuidv4(),
        date: nextDueDate,
        lineItems: template.lineItems?.map((it) => ({ ...it, id: uuidv4() })),
        recurring: undefined,
        isRecurringOccurrence: true,
        photoUrl: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveReceipt(occurrence);
      created += 1;
      nextDueDate = advance(nextDueDate, frequency);
      advanced = true;
      guard += 1;
    }

    if (advanced) {
      await updateReceipt({
        ...template,
        lineItems: undefined, // leave the template's own items untouched
        recurring: { frequency, nextDueDate, endDate },
      });
    }
  }

  return created;
}

export function isRecurringIncome(income: Income): boolean {
  return Boolean(income.recurring) || Boolean(income.isRecurringOccurrence);
}

/**
 * Same walk as processRecurringReceipts, for paycheck / repeating
 * income templates. Generated rows are plain incomes (no schedule)
 * flagged isRecurringOccurrence.
 */
export async function processRecurringIncomes(): Promise<number> {
  const incomes = await getAllIncomes();
  const t = today();
  let created = 0;

  for (const template of incomes) {
    const schedule = template.recurring;
    if (!schedule) continue;

    let { nextDueDate } = schedule;
    const { endDate, frequency } = schedule;
    let guard = 0;
    let advanced = false;

    while (nextDueDate <= t && nextDueDate <= endDate && guard < 60) {
      const occurrence: Income = {
        ...template,
        id: uuidv4(),
        date: nextDueDate,
        recurring: undefined,
        isRecurringOccurrence: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveIncome(occurrence);
      created += 1;
      nextDueDate = advance(nextDueDate, frequency);
      advanced = true;
      guard += 1;
    }

    if (advanced) {
      await saveIncome({
        ...template,
        recurring: { frequency, nextDueDate, endDate },
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return created;
}
