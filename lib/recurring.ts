import { addMonths, addWeeks, addYears, format, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { getAllReceipts, saveReceipt, updateReceipt } from './database';
import { Receipt } from '../types';

const YMD = 'yyyy-MM-dd';

function today(): string {
  return format(new Date(), YMD);
}

function advance(dateStr: string, frequency: 'weekly' | 'monthly' | 'yearly'): string {
  const d = parseISO(dateStr);
  const next =
    frequency === 'weekly' ? addWeeks(d, 1) : frequency === 'monthly' ? addMonths(d, 1) : addYears(d, 1);
  return format(next, YMD);
}

/** Given a start date + a duration in months, the ISO end date after
 *  which auto-add stops. Exposed so the UI can show/derive it without
 *  duplicating the date-fns call. */
export function computeRecurringEndDate(startDate: string, durationMonths: number): string {
  return format(addMonths(parseISO(startDate), durationMonths), YMD);
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
