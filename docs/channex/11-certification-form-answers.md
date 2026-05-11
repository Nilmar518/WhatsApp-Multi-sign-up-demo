# Channex PMS Certification — Respuestas del Formulario

> Última actualización: 2026-05-08
> Todos los tests #1–#11 completados. Re-envío post-rechazo de Andrew Yudin.

---

## Página 1 — Datos de contacto

| Campo | Respuesta |
|-------|-----------|
| **Product name** | Migo UIT |
| **Contact Person Name** | Nilmar Lutino |
| **Contact Person Email** | nilmar@518.rent |

---

## Página 2 — Sección 1: PMS Functionality

### Do you support multiple Room Types per Property?
**Yes**

### Do you support multiple Rate Plans per Room Type?
**Yes**

### What restrictions is supported by your system?
- [x] Availability
- [x] Rate
- [ ] Min Stay Through ← *no implementado*
- [x] Min Stay Arrival
- [x] Max Stay
- [x] Closed To Arrival
- [x] Closed To Departure
- [x] Stop Sell

### Do you need credit card details with bookings?
**No**

### Are you PCI Certified?
**No**

---

## Página 3 — Sección 2: Setup Testing Property

| Campo | ID |
|-------|----|
| **Property ID at Channex** | `e120bb53-798a-42f9-b92a-f910809093ff` |
| **Twin Room ID at Channex** | `c0c50a32-b6dc-4ab7-b346-7237c8e2a3b3` |
| **Twin Room Best Available Rate ID** | `8c1b6d62-b761-4b83-a495-bb904b3049fc` |
| **Twin Room Bed & Breakfast Rate ID** | `f33adf7b-6006-4dfb-9df4-dd9a2de5b70b` |
| **Double Room ID at Channex** | `3817b2ab-1639-4bfc-bab1-40a02335d5f9` |
| **Double Room Best Available Rate ID** | `dc8f3779-cee5-43c2-9fe2-ee22b6ab45c6` |
| **Double Room Bed & Breakfast Rate ID** | `31c510a3-fe73-4325-8c8a-530dbca00a03` |

---

## Página 4 — Test Case #1. Full Sync

> 500 días · 2 llamadas Channex (1 availability + 1 restrictions, todos los room types y rate plans)
> Re-ejecutado 2026-05-08 — incluye rate, min_stay_arrival=1, max_stay=30, cta=false, ctd=false, stop_sell=false

**Test results** (un ID por línea):
```
25598096-8d25-4ea2-b880-8458c237f0b4
40e7f700-290a-4981-9b74-5b953515f997
```

> Availability task: `25598096-8d25-4ea2-b880-8458c237f0b4` · Restrictions task: `40e7f700-290a-4981-9b74-5b953515f997`
> Ambas llamadas retornaron 200 con task ID, sin warnings.

---

## Página 5 — Test Case #2. Single Date Update for Single Rate

### Is this test case applicable for your system?
**Yes**

### Test results
```
1015f880-ab3e-4d88-896a-9218459f9882
```

> Twin BAR · 2026-11-22 · rate: $300 · 1 API call

---

## Página 6 — Test Case #3. Single Date Update for Multiple Rates

### Is this test case applicable for your system?
**Yes**

### Test results
```
18c63e7c-c5fd-40c9-9889-31ce96c232e9
```

> 3 rate plans · misma fecha (2026-11-21) · rates: $333 / $444 / $456.23 · 1 API call

---

## Página 7 — Test Case #4. Multiple Date Update for Multiple Rates

### Is this test case applicable for your system?
**Yes**

### Test results
```
e3fa620f-70a8-448f-b347-1a0272f39b3d
```

> 3 entries con rangos de fecha distintos · rates distintos · 1 API call

---

## Página 8 — Test Case #5. Min Stay Update

### Is this test case applicable for your system?
**Yes**

### Test results
```
07138cf6-f4f1-4a57-bac7-49a3eaec9b10
```

> Twin BAR Nov 23 min=3 · Double BAR Nov 25 min=2 · Double B&B Nov 15 min=5 · 1 API call

---

## Página 9 — Test Case #6. Stop Sell Update

### Is this test case applicable for your system?
**Yes**

### Test results
```
d12780ae-8ad7-4b41-95e0-170652ab1e4c
```

> Twin BAR Nov 14 · Double BAR Nov 16 · Double B&B Nov 20 · stop_sell=true · 1 API call

---

## Página 10 — Test Case #7. Multiple Restrictions Update

### Is this test case applicable for your system?
**Yes**

### Test results
```
6c604ae8-4e33-4b22-a0bc-74fd7e00f47b
```

> 4 entries · CTA / CTD / max_stay / min_stay en combinaciones distintas · 1 API call

---

## Página 11 — Test Case #8. Half-year Update

### Is this test case applicable for your system?
**Yes**

### Test results
```
f3ab986c-61b3-4258-a26c-8bff8fc8cecd
```

> Twin BAR + Double BAR · 2026-12-01 → 2027-05-01 · rate + min_stay + CTA + CTD · 1 API call

---

## Página 12 — Test Case #9. Single Date Availability Update

### Is this test case applicable for your system?
**Yes**

### Test result
```
21fde2f8-3f97-4a48-90cc-5d99a4aa943f
```

> Twin Nov 21 avail=7 · Double Nov 25 avail=0 · 1 API call
> *Channex warning esperado: "value greater than max availability (1)" — la propiedad tiene count_of_rooms=1*

---

## Página 13 — Test Case #10. Multiple Date Availability Update

### Is this test case applicable for your system?
**Yes**

### Test results
```
521e2b20-ae9a-4af3-aa49-22dd7c8a79cb
```

> Twin Nov 10–16 avail=3 · Double Nov 17–24 avail=4 · 1 API call
> *Channex warning esperado: mismo motivo que Test #9*

---

## Página 14 — Test Case #11. Booking Receiving

> Re-ejecutado 2026-05-08. Flujo completo: webhook recibido → Firestore upsert → ACK 200 ✓ para los 3 eventos.

| Campo | ID |
|-------|----|
| **Booking ID** | `43036659-9745-41f8-96ef-4cfc04506831` |
| **Booking Revision ID — New** | `30e407ad-3c97-4ec0-a1c4-0fdc1d8a38ee` |
| **Booking Revision ID — Modified** | `49b274bb-3a7c-48fd-bb7d-5566996e6834` |
| **Booking Revision ID — Cancelled** | `87f7cfe5-c252-4e38-879b-cdc54a50657e` |

> **IDs anteriores (primer intento, rechazado):** Booking `6440ffda-...` / New `6fa2ebeb-...` / Modified `b3a9c4bc-...` / Cancelled `6440ffda-...`

---

## Página 15 — Sección 33: Rate Limits and Update Logic

### Can you stay in rate limits?
**Yes**

> Implementamos `ChannexARIRateLimiter` — sliding window de 10 req/min por propiedad por tipo de endpoint (availability / restrictions), con cola interna y back-off automático ante 429.

### Do you agree to only send updated changes to Channex?
**Yes**

> Los pushes son disparados por acciones del usuario desde el PMS (cambios de precio, restricciones, disponibilidad). No existe timer de full-sync automático. El `fullSync` se ejecuta únicamente en el go-live inicial o bajo demanda explícita del operador — no más de una vez cada 24h como máximo.
