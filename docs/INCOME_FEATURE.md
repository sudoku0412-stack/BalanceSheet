# Next product phase — Income vs spending

NestExpenseTracker today is **expense-only**: every money record is a
`Receipt` (see `types/index.ts`). Dashboards, budgets, reports, PDF
export, and household splits all assume positive spend. Adding income
turns the app into a real cashflow tracker without throwing away the
receipt-scanning core.

This doc is the recommended build order. Implement after the current
Play Store release blockers in [`PLAN.md`](../PLAN.md) are clear enough
that you're shipping product work again — or in parallel on a feature
branch if you want it ready for the next store version.

---

## Why this is the right next product feature

1. **User mental model** — "Nest" + expense tracker already implies a
   household money nest; income vs spending is the natural second half.
2. **Data model is ready to extend** — local-first SQLite + Firestore
   shadow-write already support a second collection/table the same way
   `settlements` was added beside `receipts`.
3. **UI surfaces already exist** — Home hero ring, History list, Reports
   month picker, Recurring processor. Income plugs into those rather
   than inventing a new app shell.
4. **Differentiator vs pure receipt scanners** — most OCR receipt apps
   stop at spend; cashflow + net balance is closer to Mint/YNAB lite.

---

## Recommended approach (do not overload `Receipt`)

**Add a separate `Income` record** — do not reuse `Receipt` with a
negative amount or a boolean flag jammed onto expenses.

| | Expense (`Receipt`) | Income (`Income`) |
|---|---|---|
| Source | Scan / manual / recurring | Manual / recurring (later: pay stubs) |
| Categories | Groceries, Dining, … | Salary, Freelance, Gift, Refund, Interest, Transfer, Other |
| Line items | Yes | Optional / usually no |
| Household split | Yes (Splitwise-style) | No for v1 (or "shared household income" later) |
| Budgets | Category spend caps | Optional income goals later |
| Storage | `receipts` + `line_items` | New `incomes` table + `households/{hid}/incomes/{id}` |

Reasons:
- Reports and budget math stay simple (`SUM(expenses)` vs `SUM(income)`).
- Split / `paidBy` / `createdBy` semantics don't get weird for paychecks.
- OCR pipeline stays expense-only; no accidental "income receipt" parsing.

USD-canonical storage and `originalCurrency` should match receipts
(`lib/currency.ts`).

---

## Phase A — Foundation (shippable alone)

**Goal**: user can add income, see it on Home + History, and get a
net cashflow number for the month.

### Data

- `types/index.ts`: `IncomeCategory`, `Income` interface
  (`id`, `sourceName`, `date`, `amountUsd`, `category`, `notes?`,
  `originalCurrency?`, `recurring?`, `householdId?`, `createdBy?`,
  `createdAt`, `updatedAt`).
- `lib/database.ts`: `CREATE TABLE incomes (...)`, CRUD helpers,
  `getIncomesByMonth`, migrate via same `ALTER`/`IF NOT EXISTS` pattern
  used for receipts.
- `lib/cloudSync.ts`: mirror to `households/{hid}/incomes/{id}`;
  `onSnapshot` merge into SQLite like receipts.
- `firestore.rules`: same membership checks as receipts.

### UI

- Scan tab (or a small FAB menu): **Add expense** | **Add income**.
  Income form: source, amount, date, category, notes — no camera for v1.
- Home (`app/(tabs)/index.tsx`):
  - Hero shows **Spent / Earned / Net** for the selected month
    (or a segmented control: Spend | Cashflow).
  - Keep existing budget rings for expenses only.
- History: unified feed with expense (red/−) and income (green/+)
  rows, or a filter chip (All / Expenses / Income).
- Edit: `app/edit-income/[id].tsx` (or a shared editor with a `kind`).

### Reports / PDF

- Month summary: total income, total spend, net.
- Income category breakdown (simple bar or list).
- PDF export section for income (optional in A; required in B).

### Tests

- Unit: CRUD, month filters, stats (`computeCashflowStats`).
- Component: income form validation (reuse `lib/amountValidation.ts`).
- Regression: existing expense dashboards unchanged when incomes = 0.

**Exit criteria**: solo user can log a paycheck, see net cashflow on
Home, and data syncs across two devices in the same household.

---

## Phase B — Recurring income + polish

- Reuse `lib/recurring.ts` patterns for weekly/biweekly/monthly salary.
- Income category budgets / "expected paycheck" soft targets (optional).
- Refunds: quick action "Log refund" that creates income linked to a
  receipt id (`linkedReceiptId?`) so reports can show net of returns.
- PDF + reports polish: income vs spend chart for the month.
- Push: optional "paycheck logged" / "expected income missing" alerts.

---

## Phase C — Defer until A/B are live

- Pay-stub / deposit slip OCR (new parser prompt; not the grocery path).
- Bank/CSV import.
- Shared "household income" attribution (whose paycheck vs joint).
- Savings goals / envelopes that allocate net cashflow.
- Subscription tier gating of cashflow charts (RevenueCat already in tree).

---

## Touch points in this codebase (checklist)

When implementing Phase A, expect to touch at least:

| Area | Files |
|---|---|
| Types | `types/index.ts` |
| Local DB | `lib/database.ts` |
| Sync + rules | `lib/cloudSync.ts`, `firestore.rules` |
| Stats | new `lib/cashflowStats.ts` (or extend `dashboardStats.ts`) |
| Categories | `constants/categories.ts` (income list separate) |
| Screens | `app/(tabs)/index.tsx`, history tab, new add/edit income |
| Reports / PDF | `lib/reports.ts`, `lib/pdfExport.ts`, `app/reports.tsx` |
| Tests | `__tests__/` mirrors of the above |

Do **not** change package/bundle ids (`com.*.receiptscanner`) as part of
this feature — those stay locked for store continuity (see CONTEXT.md).

---

## Ordering vs other backlog

Suggested overall sequence once release pressure eases:

1. Clear Play/App Store blockers still open in `PLAN.md`.
2. **Phase A income** (this doc) — highest user-visible product value.
3. Crash reporting (Crashlytics) — ops hygiene.
4. In-app feedback → Jira (`docs/V1.1_ROADMAP.md` §1).
5. Revisit admin web app only after real support load appears.

Income Phase A is intentionally smaller and more user-visible than the
admin/Jira work — prefer shipping cashflow first.
