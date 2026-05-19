# ARI Plain Language UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ARI glossary modal from a technical table to plain-language cards, and add contextual helper text to the SS/CTA/CTD checkboxes in the ARI control panel — all copy driven through i18n.

**Architecture:** Pure frontend change. i18n keys are updated first so TypeScript catches any missing key references before touching components. `ARIGlossaryButton` is restructured from a `<table>` to a `<ul>` of term cards. `ARICalendar` checkboxes gain a helper `<p>` tag per boolean restriction. No backend or routing changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, custom i18n via `LanguageContext` (`t()` function)

---

## File Map

| File | Change |
|------|--------|
| `apps/frontend/src/i18n/es.ts` | Update 9 existing keys; add 16 new keys |
| `apps/frontend/src/i18n/en.ts` | Same as es.ts — parallel English copy |
| `apps/frontend/src/channex/components/ARIGlossaryButton.tsx` | Replace `<table>` with `<ul>` of cards; TERMS array gains `.name`, `.when`, `.color` |
| `apps/frontend/src/channex/components/shared/ARICalendar.tsx` | Checkbox section: add `hint` field and helper `<p>` per restriction toggle |

---

## Task 1: Update i18n — Spanish (es.ts)

**Files:**
- Modify: `apps/frontend/src/i18n/es.ts:437-469`

### Step 1.1 — Update the three Full Sync modal descriptions (remove jargon)

In `apps/frontend/src/i18n/es.ts`, replace lines 437–441:

```
  'channex.ari.sync.stopSellDesc':     'Cierra todo el inventario — no se aceptan nuevas reservas.',
  'channex.ari.sync.cta':              'Cerrado a llegadas',
  'channex.ari.sync.ctaDesc':          'Bloquea check-in en las fechas sincronizadas (CTA).',
  'channex.ari.sync.ctd':              'Cerrado a salidas',
  'channex.ari.sync.ctdDesc':          'Bloquea check-out en las fechas sincronizadas (CTD).',
```

with:

```
  'channex.ari.sync.stopSellDesc':     'Bloquea todas las reservas. Activalo si no querés recibir reservas en esas fechas.',
  'channex.ari.sync.cta':              'Cerrado a llegadas',
  'channex.ari.sync.ctaDesc':          'Impide que los huéspedes hagan check-in en las fechas sincronizadas.',
  'channex.ari.sync.ctd':              'Cerrado a salidas',
  'channex.ari.sync.ctdDesc':          'Impide que los huéspedes hagan check-out en las fechas sincronizadas.',
```

### Step 1.2 — Replace the entire ARIGlossaryButton section

In `apps/frontend/src/i18n/es.ts`, replace the block from `// ARIGlossaryButton` through the last glossary key (line 469, `'channex.glossary.maxStay.desc'`) with the following:

```typescript
  // ARIGlossaryButton
  'channex.glossary.btn':              'Guía de términos ARI',
  'channex.glossary.title':            'Guía de términos ARI',
  'channex.glossary.col.term':         'Término',
  'channex.glossary.col.full':         'Nombre completo',
  'channex.glossary.col.desc':         'Descripción',
  'channex.glossary.col.when':         'Cuándo usarlo',

  'channex.glossary.ari.term':         'ARI',
  'channex.glossary.ari.full':         'Availability, Rates & Inventory',
  'channex.glossary.ari.name':         'Disponibilidad, precios y reglas',
  'channex.glossary.ari.desc':         'El conjunto de precios, disponibilidad y reglas que se envía a Booking.com, Airbnb y otros canales de reserva.',
  'channex.glossary.ari.when':         'Cada vez que cambiás precios, disponibilidad o reglas aquí, los cambios llegan a todos los canales.',

  'channex.glossary.ss.term':          'SS',
  'channex.glossary.ss.full':          'Stop Sell',
  'channex.glossary.ss.name':          'Bloqueo de ventas',
  'channex.glossary.ss.desc':          'Cierra todas las reservas para esas fechas, sin importar cuántas habitaciones estén marcadas como disponibles.',
  'channex.glossary.ss.when':          'Tus habitaciones están completas o querés cortar reservas en Booking.com, Airbnb y otros canales de inmediato.',
  'channex.glossary.ss.hint':          'Activá si no tenés más habitaciones libres o querés pausar las reservas.',

  'channex.glossary.cta.term':         'CTA',
  'channex.glossary.cta.full':         'Closed to Arrival',
  'channex.glossary.cta.name':         'Sin llegadas',
  'channex.glossary.cta.desc':         'Impide que los huéspedes hagan check-in en esas fechas.',
  'channex.glossary.cta.when':         'No tenés personal disponible para recibir huéspedes ese día (ej: feriado, limpieza general).',
  'channex.glossary.cta.hint':         'Activá si ese día no podés recibir huéspedes.',

  'channex.glossary.ctd.term':         'CTD',
  'channex.glossary.ctd.full':         'Closed to Departure',
  'channex.glossary.ctd.name':         'Sin salidas',
  'channex.glossary.ctd.desc':         'Impide que los huéspedes hagan check-out en esas fechas.',
  'channex.glossary.ctd.when':         'Necesitás que nadie haga check-out ese día (ej: la noche antes de un evento especial).',
  'channex.glossary.ctd.hint':         'Activá si ese día no podés procesar salidas.',

  'channex.glossary.minStay.term':     'Min Stay',
  'channex.glossary.minStay.full':     'Minimum Stay on Arrival',
  'channex.glossary.minStay.name':     'Estadía mínima',
  'channex.glossary.minStay.desc':     'Solo acepta reservas de X noches o más si el huésped llega ese día.',
  'channex.glossary.minStay.when':     'Fines de semana largos o feriados donde no conviene recibir reservas de una sola noche.',

  'channex.glossary.maxStay.term':     'Max Stay',
  'channex.glossary.maxStay.full':     'Maximum Stay',
  'channex.glossary.maxStay.name':     'Estadía máxima',
  'channex.glossary.maxStay.desc':     'No acepta reservas de más de X noches seguidas.',
  'channex.glossary.maxStay.when':     'Querés evitar que una sola reserva bloquee tus habitaciones por demasiado tiempo.',
```

### Step 1.3 — Verify TypeScript compiles

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors. If you see `Type '"channex.glossary.ss.name"' is not assignable to type 'TranslationKey'` it means the key wasn't added to es.ts — check for typos.

---

## Task 2: Update i18n — English (en.ts)

**Files:**
- Modify: `apps/frontend/src/i18n/en.ts:440-471`

### Step 2.1 — Update Full Sync modal descriptions

In `apps/frontend/src/i18n/en.ts`, replace the three sync desc values:

```
  'channex.ari.sync.stopSellDesc':     'Closes all inventory — no new reservations accepted.',
  'channex.ari.sync.cta':              'Closed to Arrival',
  'channex.ari.sync.ctaDesc':          'Block check-in on all synced dates (CTA).',
  'channex.ari.sync.ctd':              'Closed to Departure',
  'channex.ari.sync.ctdDesc':          'Block check-out on all synced dates (CTD).',
```

with:

```
  'channex.ari.sync.stopSellDesc':     'Blocks all reservations. Enable if you do not want to accept bookings for those dates.',
  'channex.ari.sync.cta':              'Closed to Arrival',
  'channex.ari.sync.ctaDesc':          'Prevents guests from checking in on the synced dates.',
  'channex.ari.sync.ctd':              'Closed to Departure',
  'channex.ari.sync.ctdDesc':          'Prevents guests from checking out on the synced dates.',
```

### Step 2.2 — Replace the entire ARIGlossaryButton section

In `apps/frontend/src/i18n/en.ts`, replace from `// ARIGlossaryButton` through `'channex.glossary.maxStay.desc'`:

```typescript
  // ARIGlossaryButton
  'channex.glossary.btn':              'ARI Term Guide',
  'channex.glossary.title':            'ARI Term Guide',
  'channex.glossary.col.term':         'Term',
  'channex.glossary.col.full':         'Full name',
  'channex.glossary.col.desc':         'Description',
  'channex.glossary.col.when':         'When to use',

  'channex.glossary.ari.term':         'ARI',
  'channex.glossary.ari.full':         'Availability, Rates & Inventory',
  'channex.glossary.ari.name':         'Availability, prices & rules',
  'channex.glossary.ari.desc':         'The set of prices, availability, and rules sent to Booking.com, Airbnb, and other booking channels.',
  'channex.glossary.ari.when':         'Every time you change prices, availability, or rules here, the updates reach all your booking channels.',

  'channex.glossary.ss.term':          'SS',
  'channex.glossary.ss.full':          'Stop Sell',
  'channex.glossary.ss.name':          'Block sales',
  'channex.glossary.ss.desc':          'Closes all reservations for those dates, regardless of how many rooms are marked as available.',
  'channex.glossary.ss.when':          'Your rooms are fully booked, or you want to stop sales on Booking.com, Airbnb, and other channels immediately.',
  'channex.glossary.ss.hint':          'Enable if you have no rooms left or want to pause new bookings.',

  'channex.glossary.cta.term':         'CTA',
  'channex.glossary.cta.full':         'Closed to Arrival',
  'channex.glossary.cta.name':         'No arrivals',
  'channex.glossary.cta.desc':         'Prevents guests from checking in on those dates.',
  'channex.glossary.cta.when':         'You have no staff available to receive guests that day (e.g. public holiday, deep cleaning).',
  'channex.glossary.cta.hint':         'Enable if you cannot receive guests on that day.',

  'channex.glossary.ctd.term':         'CTD',
  'channex.glossary.ctd.full':         'Closed to Departure',
  'channex.glossary.ctd.name':         'No departures',
  'channex.glossary.ctd.desc':         'Prevents guests from checking out on those dates.',
  'channex.glossary.ctd.when':         'You need nobody to check out that day (e.g. the night before a special event).',
  'channex.glossary.ctd.hint':         'Enable if you cannot process checkouts on that day.',

  'channex.glossary.minStay.term':     'Min Stay',
  'channex.glossary.minStay.full':     'Minimum Stay on Arrival',
  'channex.glossary.minStay.name':     'Minimum stay',
  'channex.glossary.minStay.desc':     'Only accepts bookings of X nights or more for guests arriving on that day.',
  'channex.glossary.minStay.when':     'Long weekends or holidays where single-night stays are not worth it.',

  'channex.glossary.maxStay.term':     'Max Stay',
  'channex.glossary.maxStay.full':     'Maximum Stay',
  'channex.glossary.maxStay.name':     'Maximum stay',
  'channex.glossary.maxStay.desc':     'Rejects bookings longer than X nights in a row.',
  'channex.glossary.maxStay.when':     'You want to prevent one booking from blocking your rooms for too long.',
```

### Step 2.3 — Verify TypeScript compiles

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

---

## Task 3: Redesign ARIGlossaryButton — Table → Cards

**Files:**
- Modify: `apps/frontend/src/channex/components/ARIGlossaryButton.tsx` (full rewrite)

### Step 3.1 — Replace the component

Replace the entire content of `apps/frontend/src/channex/components/ARIGlossaryButton.tsx` with:

```tsx
import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  className?: string;
}

export default function ARIGlossaryButton({ className }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const TERMS = [
    {
      abbr:  t('channex.glossary.ari.term'),
      name:  t('channex.glossary.ari.name'),
      full:  t('channex.glossary.ari.full'),
      desc:  t('channex.glossary.ari.desc'),
      when:  t('channex.glossary.ari.when'),
      color: 'bg-surface-subtle text-content-2',
    },
    {
      abbr:  t('channex.glossary.ss.term'),
      name:  t('channex.glossary.ss.name'),
      full:  t('channex.glossary.ss.full'),
      desc:  t('channex.glossary.ss.desc'),
      when:  t('channex.glossary.ss.when'),
      color: 'bg-danger-bg text-danger-text',
    },
    {
      abbr:  t('channex.glossary.cta.term'),
      name:  t('channex.glossary.cta.name'),
      full:  t('channex.glossary.cta.full'),
      desc:  t('channex.glossary.cta.desc'),
      when:  t('channex.glossary.cta.when'),
      color: 'bg-caution-bg text-caution-text',
    },
    {
      abbr:  t('channex.glossary.ctd.term'),
      name:  t('channex.glossary.ctd.name'),
      full:  t('channex.glossary.ctd.full'),
      desc:  t('channex.glossary.ctd.desc'),
      when:  t('channex.glossary.ctd.when'),
      color: 'bg-caution-bg text-caution-text',
    },
    {
      abbr:  t('channex.glossary.minStay.term'),
      name:  t('channex.glossary.minStay.name'),
      full:  t('channex.glossary.minStay.full'),
      desc:  t('channex.glossary.minStay.desc'),
      when:  t('channex.glossary.minStay.when'),
      color: 'bg-surface-subtle text-content-2',
    },
    {
      abbr:  t('channex.glossary.maxStay.term'),
      name:  t('channex.glossary.maxStay.name'),
      full:  t('channex.glossary.maxStay.full'),
      desc:  t('channex.glossary.maxStay.desc'),
      when:  t('channex.glossary.maxStay.when'),
      color: 'bg-surface-subtle text-content-2',
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('channex.glossary.btn')}
        className={`rounded-xl border border-edge bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-content-2 hover:bg-surface-subtle ${className ?? ''}`}
      >
        ℹ
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface-raised p-6 shadow-xl overflow-y-auto max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-content">{t('channex.glossary.title')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-content-3 hover:text-content-2 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <ul className="space-y-3">
              {TERMS.map((term) => (
                <li key={term.abbr} className="rounded-xl border border-edge bg-surface-subtle p-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${term.color}`}>
                      {term.abbr}
                    </span>
                    <span className="text-xs font-semibold text-content">{term.name}</span>
                  </div>
                  <p className="text-[10px] text-content-3 mb-2">{term.full}</p>
                  <p className="text-xs text-content-2 mb-1.5">{term.desc}</p>
                  <p className="text-xs text-content-3">
                    <span className="font-semibold text-content-2">{t('channex.glossary.col.when')}: </span>
                    {term.when}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
```

### Step 3.2 — Verify TypeScript compiles

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

### Step 3.3 — Visual check

Start the dev server (`pnpm dev` from repo root), open the ARI calendar for any property, click the ℹ button.

Verify:
- Modal shows 6 cards (not a table)
- SS card has red badge; CTA and CTD have yellow badges; others have grey badges
- Each card shows: term badge + plain name, muted technical name below, description, "Cuándo usarlo:" line
- Language toggle (ES/EN) switches all text correctly
- "OTA" does not appear anywhere

---

## Task 4: Add Checkbox Helper Text in ARICalendar

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ARICalendar.tsx:842-858`

### Step 4.1 — Replace the restriction checkboxes section

Locate the block starting with `{/* Restriction checkboxes */}` (around line 842). Replace the entire checkboxes map with:

```tsx
              {/* Restriction checkboxes */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-content-2">{t('channex.ari.restrictions')}</p>
                {[
                  { id: 'stop_sell', label: isRangeBlocked ? t('channex.ari.openSell') : t('channex.ari.stopSell'), hint: t('channex.glossary.ss.hint'),  value: stopSell,          set: setStopSell },
                  { id: 'cta',       label: t('channex.ari.cta'),                                                    hint: t('channex.glossary.cta.hint'), value: closedToArrival,   set: setClosedToArrival },
                  { id: 'ctd',       label: t('channex.ari.ctd'),                                                    hint: t('channex.glossary.ctd.hint'), value: closedToDeparture, set: setClosedToDeparture },
                ].map(({ id, label, hint, value, set }) => (
                  <label key={id} className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => set(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-edge text-brand focus:ring-brand"
                    />
                    <div>
                      <span className="text-sm text-content">{label}</span>
                      <p className="text-xs text-content-3 mt-0.5">{hint}</p>
                    </div>
                  </label>
                ))}
              </div>
```

### Step 4.2 — Verify TypeScript compiles

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

### Step 4.3 — Visual check

Open the ARI calendar, click two dates to open the side panel, scroll to the restrictions section.

Verify:
- Each checkbox (Block sales / No arrivals / No departures) has a helper line in grey below the label
- Checkbox input aligns to the top of the two-line label (not centered)
- Language toggle switches the helper text correctly
- Toggle behaviour (check/uncheck) unchanged

---

## Self-Review

**Spec coverage:**
- ✅ ARIGlossaryButton table → cards: Task 3
- ✅ Plain language names (`.name` keys): Tasks 1, 2, 3
- ✅ "When to use" per term (`.when` keys): Tasks 1, 2, 3
- ✅ No "OTA" in UI: all replaced in new copy
- ✅ Checkbox helper text (`.hint` keys): Tasks 1, 2, 4
- ✅ Full Sync modal desc updated: Tasks 1.1, 2.1
- ✅ ES + EN i18n: Tasks 1 and 2
- ✅ TypeScript safe (new keys added to es.ts → TranslationKey): verified in Steps 1.3, 2.3, 3.2, 4.2
- ✅ Min Stay / Max Stay get glossary copy but no hint (they're inputs, not booleans): correct — no hint keys for those

**Placeholder scan:** No TBDs. All code is shown completely. Commands include expected output.

**Type consistency:**
- `channex.glossary.ss.hint` used in Task 4 — defined in Tasks 1 and 2. ✅
- `channex.glossary.col.when` used in Task 3 — defined in Tasks 1 and 2. ✅
- `color` field on TERMS objects is only used locally in ARIGlossaryButton — not exported. ✅
- `hint` field on the checkbox array is typed inline — consistent across Task 4. ✅
