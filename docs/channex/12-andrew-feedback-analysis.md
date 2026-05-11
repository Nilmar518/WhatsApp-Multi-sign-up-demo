# Análisis del Rechazo de Certificación — Andrew Yudin (2026-05-07)

> Documento de contraste: qué entendimos de los comentarios de Andrew, qué pruebas pasaron, cuáles fallaron y por qué.

---

## El Email de Andrew

```
Hi,

Thank you for your certification results.

I'm so sorry, but provided results can't be accepted due to next issues:

1. Full Sync request contain info only about Rate and Availability when support for
   Availability, Rate, Min Stay Arrival, Max Stay, Closed To Arrival, Closed To
   Departure, Stop Sell is declared. Why another restrictions is not synced?

2. Booking receiving flow is not implemented correct. You doesn't should to use GET
   api/v1/booking endpoint. Instead, you should to use GET api/v1/booking_revisions/feed
   endpoint what expose only non-acked revisions. Also, you should to send a Booking
   Acknowledge request to mark booking revision as received.

With regards,
Andrew Yudin
```

---

## Qué Dice Andrew (Interpretación Técnica)

### Problema 1 — Full Sync incompleto

En la Página 2 del formulario declaramos soportar estas restricciones:

| Restricción declarada | Incluida en Full Sync actual |
|---|---|
| Availability | ✅ Sí |
| Rate | ✅ Sí |
| Min Stay Arrival | ❌ No |
| Max Stay | ❌ No |
| Closed To Arrival | ❌ No |
| Closed To Departure | ❌ No |
| Stop Sell | ❌ No |

Andrew dice: si declaras soporte para 7 tipos de restricciones, el Full Sync debe enviar los 7 — aunque los valores sean "abiertos" (minstay=1, maxstay=null, cta=false, ctd=false, stopsell=false). Enviar solo Rate y Availability contradice lo que declaramos en la Sección 1.

**En el código:** `channex-ari.service.ts → fullSync()` construye `restrictionUpdates` con solo `{ rate_plan_id, date_from, date_to, rate }`. Falta incluir los 5 campos restantes.

### Problema 2 — Booking receiving flow incorrecto

Andrew distingue dos endpoints de Channex:

| Endpoint | Para qué sirve |
|---|---|
| `GET /api/v1/bookings` | Historial administrativo completo. Para reportes, búsquedas, backoffice. |
| `GET /api/v1/booking_revisions/feed` | Solo las revisiones **no confirmadas**. Para que el PMS las procese. |

El flujo correcto que espera Channex para un PMS certificado:

```
1. Channex envía webhook → nuestro backend recibe y pone en cola
2. Worker procesa: transforma → guarda en Firestore
3. Worker llama POST /api/v1/booking_revisions/{id}/acknowledge
4. Channex marca esa revisión como "acked" y deja de reenviarla en el feed
```

El "Booking Acknowledge" no es solo el HTTP 200 que respondemos al webhook. Son dos cosas distintas:

- **HTTP 200 al webhook** = "recibí el evento, no me lo reenvíes por HTTP"
- **POST /acknowledge** = "procesé la reserva correctamente, marca como recibida en tu sistema"

Sin el acknowledge, Channex asume que el PMS no confirmó recepción de los datos de la reserva. El feed seguirá devolviendo esas revisiones en cada consulta.

**En el código:**
- `channex.service.ts → fetchBookings()` usa `GET /api/v1/bookings` (incorrecto para PMS)
- `channex-ari.service.ts → pullBookingsFromChannex()` llama `fetchBookings()` (incorrecto)
- `channex-booking.worker.ts` no llama `acknowledgeBookingRevision()` después de guardar en Firestore
- El método `acknowledgeBookingRevision()` **ya existe** en `channex.service.ts` pero nunca se invoca

---

## Contraste: Pruebas que Pasaron vs Fallaron

### Tests #2 al #10 — PASARON ✅

Estas pruebas solo evaluaban el envío de ARI (Availability, Rates, Restrictions) en escenarios específicos. No evalúan Full Sync ni booking receiving.

| Test | Descripción | Resultado | Observación |
|---|---|---|---|
| #2 | Single Date Update — Single Rate | ✅ Pasó | Push de rate a una fecha puntual. 1 API call. |
| #3 | Single Date Update — Multiple Rates | ✅ Pasó | 3 rate plans, misma fecha. 1 API call. |
| #4 | Multiple Date Update — Multiple Rates | ✅ Pasó | 3 entries con rangos distintos. 1 API call. |
| #5 | Min Stay Update | ✅ Pasó | min_stay_arrival enviado correctamente. |
| #6 | Stop Sell Update | ✅ Pasó | stop_sell=true enviado correctamente. |
| #7 | Multiple Restrictions Update | ✅ Pasó | CTA / CTD / max_stay / min_stay combinados. |
| #8 | Half-year Update | ✅ Pasó | 6 meses, Twin BAR + Double BAR. |
| #9 | Single Date Availability Update | ✅ Pasó | Availability push. Warning esperado (>max). |
| #10 | Multiple Date Availability Update | ✅ Pasó | Multi-date availability. Warning esperado. |

**¿Por qué pasaron?** El endpoint `POST /api/v1/availability` y `POST /api/v1/restrictions` funcionan correctamente. El ARICalendar y RoomRateManager del frontend disparan estos pushes correctamente, incluyendo todos los campos cuando el usuario los edita.

**Nota importante:** Min Stay (#5), Stop Sell (#6), CTA/CTD (#7) pasaron porque en esos tests el usuario *explícitamente* enviaba esos valores desde el UI. El problema de Andrew es sobre el **Full Sync** (#1) que envía valores de fondo para inicializar — ahí sí faltaban esos campos.

---

### Test #1 — Full Sync — FALLÓ ❌

| Campo | ¿Incluido en Full Sync? | Valor esperado para "open" |
|---|---|---|
| rate | ✅ Sí | valor del usuario |
| availability | ✅ Sí | valor del usuario |
| min_stay_arrival | ❌ No | `1` |
| max_stay | ❌ No | `null` |
| closed_to_arrival | ❌ No | `false` |
| closed_to_departure | ❌ No | `false` |
| stop_sell | ❌ No | `false` |

**Por qué falló:** `fullSync()` solo construía `{ rate_plan_id, date_from, date_to, rate }` en el array de restricciones. Los otros 5 campos no eran enviados. Al no estar presentes, Channex no sabe qué valor tienen para los 500 días del sync.

**Consecuencia:** Andrew rechaza porque declaramos soporte completo pero el sync inicial solo toca 2 de los 7 tipos.

---

### Test #11 — Booking Receiving — FALLÓ ❌

| Sub-test | Nuestro comportamiento | Comportamiento esperado |
|---|---|---|
| New booking webhook | ✅ Recibido, 200 OK | ✅ Correcto |
| Firestore upsert | ✅ Guardado (después de fix del flat payload) | ✅ Correcto |
| ACK a Channex | ❌ No enviado | `POST /api/v1/booking_revisions/{id}/acknowledge` |
| Manual pull endpoint | `GET /api/v1/bookings` | `GET /api/v1/booking_revisions/feed` |

**Por qué falló:**
1. Nunca llamamos `acknowledgeBookingRevision()` después de procesar una revisión
2. El pull manual usa el endpoint administrativo en lugar del feed de PMS
3. Sin ACK, Channex no puede verificar que nuestro sistema completó el flujo correctamente

**Nota sobre el Booking ID en el formulario:** Los IDs que enviamos en Test #11 fueron obtenidos en vivo durante la reunión con el evaluador. El Booking Revision ID "Cancelled" (`6440ffda-...`) tiene el mismo valor que el Booking ID, lo que sugiere que el evaluador puede haber usado el booking_id como revision_id para la cancelación — esto es normal en Channex cuando la cancelación no genera una revisión separada.

---

## Resumen Ejecutivo

| Problema | Causa raíz | Fix |
|---|---|---|
| Full Sync no incluye todas las restricciones | `fullSync()` solo incluye `rate` en restrictionUpdates | Agregar 5 campos con valores "open" |
| Booking receiving no usa feed | `pullBookingsFromChannex()` llama `fetchBookings()` que usa `/api/v1/bookings` | Crear `fetchBookingRevisionsFeed()` y reemplazar |
| No se envía ACK | `acknowledgeBookingRevision()` existe pero nunca se llama | Llamarla en el worker después de upsert y en el pull sync |

Los fixes son quirúrgicos — no requieren cambios arquitectónicos. Ver plan de implementación en:
`docs/superpowers/plans/2026-05-07-channex-certification-fixes.md`
