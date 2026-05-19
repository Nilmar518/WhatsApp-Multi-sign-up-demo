# ARI Glossary & Control Panel — Plain Language UX

**Date:** 2026-05-19
**Status:** Approved

---

## Problem

The current ARI glossary and control panel use PMS/channel-manager jargon (SS, CTA, CTD, OTA, rate plan) without explaining the real-world situations in which each control should be used. A hotel or hostel owner with no prior PMS experience cannot confidently decide which restriction to apply when — for example, knowing whether to set Availability = 0 or toggle Stop Sell when rooms are physically full.

---

## Goal

1. A user with no PMS background reads the glossary and immediately knows *when* to use each control.
2. The ARI panel provides just-in-time guidance at the exact point of decision (the checkboxes).
3. All copy lives in i18n files — zero hardcoded strings in components.
4. No jargon is introduced without explanation: "Booking.com, Airbnb y otros canales" replaces "OTAs".

---

## Scope

**In scope:**
- `apps/frontend/src/channex/components/ARIGlossaryButton.tsx` — restructure from table to cards
- `apps/frontend/src/channex/components/shared/ARICalendar.tsx` — add helper text to SS/CTA/CTD checkboxes; update Full Sync field descriptions via i18n (no structural change to that section)
- `apps/frontend/src/i18n/es.ts` — new and updated keys
- `apps/frontend/src/i18n/en.ts` — new and updated keys

**Out of scope:**
- Backend changes
- New routes or components
- Min Stay / Max Stay inputs (they are number fields, not boolean toggles; glossary copy is enough)

---

## Component Changes

### 1. ARIGlossaryButton.tsx — Table → Cards

Replace the `<table>` (3 columns: Término / Nombre completo / Descripción) with a vertical list of term cards. Each card contains:

```
┌─────────────────────────────────────────────┐
│ [SS]  Bloqueo de ventas                     │
│       Stop Sell                             │  ← .full kept as muted subtitle
│                                             │
│  Cierra todas las reservas para esas        │  ← .desc (what it does, plain)
│  fechas, sin importar cuántas habitaciones  │
│  estén marcadas como disponibles.           │
│                                             │
│  → Tus habitaciones están completas o       │  ← .when (when to use)
│    querés cortar ventas en Booking.com,     │
│    Airbnb y otros canales de inmediato.     │
└─────────────────────────────────────────────┘
```

- Term abbreviation shown as a small monospace badge (existing style `rounded bg-danger-bg` for SS, `bg-caution-bg` for CTA/CTD, `bg-surface-subtle` for others).
- `.full` (e.g. "Stop Sell") shown in muted text (`text-content-3 text-xs`) below the plain name — kept as a reference anchor for users who already know the term.
- `.desc` and `.when` separated by a visual divider (a `→` prefix on `.when`).
- Modal width and wrapper unchanged.

### 2. ARICalendar.tsx — Checkbox helper text

In the restriction checkboxes section (the three booleans: SS, CTA, CTD), each `<label>` gains a `<span>` helper line below the checkbox label text:

```
[✓] Bloqueo de ventas
    Activa si no tenés más habitaciones libres o querés pausar las reservas.
```

The helper text (`channex.glossary.ss.hint`, etc.) is short — one sentence, no jargon. It answers "why would I check this box right now?"

The Full Sync modal's field reference panel (the collapsible "i" panel) has its description keys updated via i18n only — no structural change to that section of the component.

---

## i18n Key Changes

### New keys added

| Key | Purpose |
|-----|---------|
| `channex.glossary.ss.name` | Plain language name shown in card heading |
| `channex.glossary.ss.when` | Situational "when to use" line |
| `channex.glossary.ss.hint` | Short checkbox helper (ARI panel) |
| `channex.glossary.cta.name` | Plain name |
| `channex.glossary.cta.when` | When to use |
| `channex.glossary.cta.hint` | Checkbox helper |
| `channex.glossary.ctd.name` | Plain name |
| `channex.glossary.ctd.when` | When to use |
| `channex.glossary.ctd.hint` | Checkbox helper |
| `channex.glossary.minStay.name` | Plain name |
| `channex.glossary.minStay.when` | When to use |
| `channex.glossary.maxStay.name` | Plain name |
| `channex.glossary.maxStay.when` | When to use |
| `channex.glossary.ari.name` | Plain name for ARI concept |
| `channex.glossary.ari.when` | When this matters |
| `channex.glossary.col.when` | Column/section label "Cuándo usarlo" |

### Modified keys (`.desc` rewritten)

| Key | Old | New intent |
|-----|-----|------------|
| `channex.glossary.ss.desc` | "Bloquea toda venta en esa fecha sin importar la disponibilidad real." | Plain: what SS does mechanically, no jargon |
| `channex.glossary.cta.desc` | "No se aceptan nuevas llegadas en esa fecha." | Plain: guests cannot check in |
| `channex.glossary.ctd.desc` | "No se aceptan salidas en esa fecha." | Plain: guests cannot check out |
| `channex.glossary.minStay.desc` | "Noches mínimas requeridas si el huésped llega ese día." | Plain: only accepts bookings of N+ nights |
| `channex.glossary.maxStay.desc` | "Noches máximas de estancia permitidas." | Plain: rejects bookings longer than N nights |
| `channex.glossary.ari.desc` | "Conjunto de datos de disponibilidad, tarifas y restricciones que se sincroniza con las OTAs." | No "OTAs": "...que se envía a Booking.com, Airbnb y otros canales de reserva." |

---

## Final Copy

### Spanish (es.ts)

```
// Modified
'channex.glossary.ari.desc':         'El conjunto de precios, disponibilidad y reglas que se envía a Booking.com, Airbnb y otros canales de reserva.'
'channex.glossary.ss.desc':          'Cierra todas las reservas para esas fechas, sin importar cuántas habitaciones estén marcadas como disponibles.'
'channex.glossary.cta.desc':         'Impide que los huéspedes hagan check-in en esas fechas.'
'channex.glossary.ctd.desc':         'Impide que los huéspedes hagan check-out en esas fechas.'
'channex.glossary.minStay.desc':     'Solo acepta reservas de X noches o más si el huésped llega ese día.'
'channex.glossary.maxStay.desc':     'No acepta reservas de más de X noches seguidas.'

// New — plain names
'channex.glossary.ari.name':         'Disponibilidad, precios y reglas'
'channex.glossary.ss.name':          'Bloqueo de ventas'
'channex.glossary.cta.name':         'Sin llegadas'
'channex.glossary.ctd.name':         'Sin salidas'
'channex.glossary.minStay.name':     'Estadía mínima'
'channex.glossary.maxStay.name':     'Estadía máxima'

// New — when to use
'channex.glossary.ari.when':         'Cada vez que cambiás precios, disponibilidad o reglas aquí, los cambios llegan a todos los canales.'
'channex.glossary.ss.when':          'Tus habitaciones están completas o querés cortar reservas en Booking.com, Airbnb y otros canales de inmediato.'
'channex.glossary.cta.when':         'No tenés personal disponible para recibir huéspedes ese día (ej: feriado, limpieza general).'
'channex.glossary.ctd.when':         'Necesitás que nadie haga check-out ese día (ej: la noche antes de un evento especial).'
'channex.glossary.minStay.when':     'Fines de semana largos o feriados donde no conviene recibir reservas de una sola noche.'
'channex.glossary.maxStay.when':     'Querés evitar que una sola reserva bloquee tus habitaciones por demasiado tiempo.'

// New — short hints for checkboxes
'channex.glossary.ss.hint':          'Activá si no tenés más habitaciones libres o querés pausar las reservas.'
'channex.glossary.cta.hint':         'Activá si ese día no podés recibir huéspedes.'
'channex.glossary.ctd.hint':         'Activá si ese día no podés procesar salidas.'

// New — section label in glossary card
'channex.glossary.col.when':         'Cuándo usarlo'
```

### English (en.ts)

```
// Modified
'channex.glossary.ari.desc':         'The set of prices, availability, and rules sent to Booking.com, Airbnb, and other booking channels.'
'channex.glossary.ss.desc':          'Closes all reservations for those dates, regardless of how many rooms are marked as available.'
'channex.glossary.cta.desc':         'Prevents guests from checking in on those dates.'
'channex.glossary.ctd.desc':         'Prevents guests from checking out on those dates.'
'channex.glossary.minStay.desc':     'Only accepts bookings of X nights or more for guests arriving on that day.'
'channex.glossary.maxStay.desc':     'Rejects bookings longer than X nights in a row.'

// New — plain names
'channex.glossary.ari.name':         'Availability, prices & rules'
'channex.glossary.ss.name':          'Block sales'
'channex.glossary.cta.name':         'No arrivals'
'channex.glossary.ctd.name':         'No departures'
'channex.glossary.minStay.name':     'Minimum stay'
'channex.glossary.maxStay.name':     'Maximum stay'

// New — when to use
'channex.glossary.ari.when':         'Every time you change prices, availability, or rules here, the updates reach all your booking channels.'
'channex.glossary.ss.when':          'Your rooms are fully booked, or you want to stop sales on Booking.com, Airbnb, and other channels immediately.'
'channex.glossary.cta.when':         'You have no staff available to receive guests that day (e.g. public holiday, deep cleaning).'
'channex.glossary.ctd.when':         'You need nobody to check out that day (e.g. the night before a special event).'
'channex.glossary.minStay.when':     'Long weekends or holidays where single-night stays are not worth it.'
'channex.glossary.maxStay.when':     'You want to prevent one booking from blocking your rooms for too long.'

// New — short hints for checkboxes
'channex.glossary.ss.hint':          'Enable if you have no rooms left or want to pause new bookings.'
'channex.glossary.cta.hint':         'Enable if you cannot receive guests on that day.'
'channex.glossary.ctd.hint':         'Enable if you cannot process checkouts on that day.'

// New — section label
'channex.glossary.col.when':         'When to use'
```

---

## What Does NOT Change

- The `TERMS` array structure in `ARIGlossaryButton` (just gains `.name` and `.when` per entry)
- The modal open/close logic
- The checkbox boolean state in `ARICalendar`
- All other ARI panel fields (availability input, rate input, min/max stay inputs)
- The Full Sync modal structure (only `sync.*Desc` copy updated via existing keys — no new keys)
- Backend, API, Firestore

---

## Acceptance Criteria

1. Opening the ARI glossary modal shows cards (not a table) with plain language name, what-it-does, and when-to-use for each term.
2. "OTA" does not appear anywhere in the UI — replaced by "Booking.com, Airbnb y otros canales" / "Booking.com, Airbnb, and other channels".
3. The three restriction checkboxes (SS, CTA, CTD) in the ARI panel each show a one-sentence helper below the label.
4. The same helper text appears in the Full Sync modal's field reference panel.
5. Switching language (ES/EN) updates all new text correctly.
6. No TypeScript errors — all new keys added to `TranslationKey` type (derived from `es.ts`).
