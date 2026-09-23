# Income vs spending — product plan

**Status**: Phases A–C shipped. Phase D syncs savings envelopes to Firestore (`households/{hid}/savingsGoals`) so household members share goals. Joint `earnedBy` stays member-only.
**Product**: NestExpenseTracker household cashflow.

This replaces the earlier high-level sketch with the concrete product
rules you asked for. Do not start coding until you sign off on this
doc (or leave a follow-up that says "build Phase A").

---

## Product rules (source of truth)

### 1. Multiple incomes per household

- Anyone in the household can log **many** income entries (paycheck,
  side gig, gift, dividend, custom source, …).
- Each entry is its own record (date, amount, source, owner).
- There is no single "household income" field — the household total is
  always **sum of member incomes** for the selected period.

### 2. Whose income it is

- Every income **must** name an owner: a household member
  (`earnedBy` = that member's Firebase uid, or `'self'` for the
  signed-in user — same id style as expense splits today).
- Optional later: a **Joint / Household** owner for income that isn't
  one person's (e.g. shared rental). Not required for v1 if you want
  to keep the first ship simpler — default is always a real member.
- Home / reports show:
  - **Household total income** (all members)
  - **Per-member breakdown** (whose income contributed what)
- Solo households: owner defaults to the only member; picker still
  exists so multi-member works the day a partner joins.

### 3. Custom / "other" income sources

- Built-in source *types* (category): e.g. Salary, Freelance, Gift,
  Interest, Refund, Investment return, Other.
- **Source name is always free-text** (required): "Acme Corp payroll",
  "Uber", "Mom birthday gift", "Questrade dividend".
- When type = **Other** (or always), the user names the source — no
  closed list of employer names. Recent source names can be suggested
  for fast re-entry.
- Multiple incomes can share the same source name (e.g. two months of
  "Acme Corp payroll").

### 4. Recurring investments = expenses (not income)

- Money **going out** to investments (RRSP/401k contribution, brokerage
  transfer, crypto buy, etc.) is an **expense**, not negative income.
- Use the existing expense + recurring pipeline (`Receipt` +
  `lib/recurring.ts`):
  - Add/ensure an expense category **Investments** (or "Savings &
    Investments").
  - User sets amount + frequency (weekly / biweekly / monthly / yearly)
    like any other recurring expense.
- Money **coming back** from investments (dividend, interest, sale
  proceeds) is logged as **income** with type "Investment return" (or
  a custom Other name).
- Cashflow math stays clean:
  - Income = money in
  - Spending = money out (including investment contributions)
  - Net = income − spending  
  (Net can be negative in a month where you invest a lot — that's
  correct for cashflow; a later "savings rate" view can treat
  Investments as a special bucket if you want.)

### 5. What we are not doing in v1

- Pay-stub OCR, bank CSV import (Phase C).
- Splitting one income across members (one income = one `earnedBy`).
- Treating investment contributions as income or as a third ledger
  type — they stay expenses.
- Changing bundle ids / EAS slug.

---

## Data model (proposed)

```ts
// types/index.ts (concept — not checked in as code yet)

type IncomeCategory =
  | 'Salary'
  | 'Freelance'
  | 'Gift'
  | 'Interest'
  | 'Refund'
  | 'InvestmentReturn'
  | 'Other';

interface Income {
  id: string;
  /** Free-text label the user typed — "Acme payroll", "Side hustle", … */
  sourceName: string;
  date: string;                 // YYYY-MM-DD
  amountUsd: number;            // USD-canonical, same as receipts
  category: IncomeCategory;
  /** Who earned this — household member uid (required). */
  earnedBy: string;
  notes?: string;
  originalCurrency?: CurrencyCode;
  recurring?: {                 // optional paycheck schedule
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
    nextDueDate: string;
    endDate: string;
  };
  householdId?: string;         // local SQLite only, like Receipt
  createdBy?: string;           // who logged it (may differ from earnedBy)
  createdAt: string;
  updatedAt: string;
}
```

Storage:
- SQLite `incomes` table (local-first), scoped by `user_id` + `household_id`.
- Firestore `households/{hid}/incomes/{id}` shadow-write + listener
  (same pattern as receipts / settlements).
- Expense side: add **Investments** to expense `Category` (or as a
  first-class tag) and allow recurring on it — no new table.

Household overall income for a month:

```
householdIncome = SUM(incomes where date in month)
perMember[uid]  = SUM(incomes where earnedBy = uid and date in month)
householdSpend  = SUM(receipts where date in month)   // includes Investments
netCashflow     = householdIncome - householdSpend
```

---

## UX (Phase A)

### Add income

Entry from Scan tab (or FAB): **Add expense** | **Add income**.

Form fields:
1. **Amount** (required) — reuse `lib/amountValidation.ts`
2. **Date** (required)
3. **Whose income** (required) — picker of current household members
4. **Type** (required) — Salary / Freelance / … / Other
5. **Source name** (required) — free text; placeholder changes with type
   ("Employer name", "Client / platform", "Describe the source")
6. **Notes** (optional)
7. **Repeat** (optional) — same frequency controls as recurring expenses

### Home

For the selected month:
- **Earned** (household total) · **Spent** · **Net**
- Expandable or secondary row: per-member earned (A: $X · B: $Y)
- Existing budget rings stay expense-only
- Investment contributions appear inside Spent (and under Investments
  in category breakdown)

### History

- Unified feed: income rows (green / +) and expense rows (red / −)
- Filter chips: All | Income | Expenses
- Income row subtitle: `{sourceName} · {member display name}`

### Reports / PDF

- Month: total income, total spend (call out Investments subcategory),
  net, income by member, income by type/source

---

## Build phases (still plan-only)

### Phase A — shippable cashflow

- `Income` type + SQLite + Firestore sync + rules
- Add Income form with **earnedBy** + free-text **sourceName**
- Expense category **Investments** + recurring investments via existing
  recurring expense flow
- Home earned / spent / net + per-member income
- History filter
- Basic report numbers + tests

**Exit criteria**: two household members can each log incomes under
their name; household total = sum; one member can set a monthly
recurring "Investments" expense; custom Other sources work by name.

### Phase B — polish

- Recurring income (paychecks) auto-materialize like recurring expenses — **done**
- Recent source-name suggestions / autocomplete — **done**
- "Joint" earnedBy option if you want it — **deferred** (member-only)
- PDF section for cashflow + investments callout — **done**
- Optional: savings-rate view that treats Investments spend as
  "saved" rather than "consumed" — **done** (Home + Reports; Spent still includes Investments)

### Phase C — import + envelopes

- Pay-stub OCR (on-device, same ML Kit as receipts) prefills Add Income
- Bank CSV paste-import (no new native picker); deposits only by default; dedupes date+amount+description
- Savings goals / envelopes (local SQLite, Home + Settings)

**Exit criteria**: user can scan a stub or paste a statement and confirm incomes; named envelopes show progress without changing Spent.

### Phase D — shared envelopes

- Shadow-write savings goals to Firestore (same household-membership gate as incomes)
- Live listener + `updated_at` guard so a stale cloud doc cannot overwrite a newer local envelope
- Solo account / household delete wipes `savingsGoals` before the parent household doc; leaving a shared household keeps the envelopes

**Exit criteria**: two devices in the same household see the same envelopes; deleting the household does not orphan cloud goal docs.

---

## Files that would change when you approve build

| Area | Touch |
|---|---|
| Types | `types/index.ts` |
| DB | `lib/database.ts` |
| Sync | `lib/cloudSync.ts`, `firestore.rules` |
| Stats | new `lib/cashflowStats.ts` |
| Categories | `constants/categories.ts` (+ Investments expense) |
| UI | add-income screen, Home, History, Reports, PDF |
| Recurring | reuse `lib/recurring.ts` for income + Investments expense |
| Tests | CRUD, cashflow math, earnedBy rollup, form validation |

---

## Open decisions (need your call before code)

| # | Question | Default if you don't decide |
|---|---|---|
| 1 | Allow **Joint / Household** as `earnedBy`, or member-only? | Member-only in Phase A |
| 2 | Should Investment contributions count in "Spent" on Home, or a third "Invested" number? | Count in Spent; show Investments in category breakdown |
| 3 | Is free-text source name required for every type, or only for Other? | Required for every type (better history labels) |
| 4 | Start Phase A now, or after the next store release? | After blockers in `PLAN.md` ease — your call |

Reply with tweaks or "build Phase A" when you want implementation to start.
