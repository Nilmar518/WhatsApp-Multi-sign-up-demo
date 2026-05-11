# Channex.io Integration — Referencia de Funcionalidad

> Documento de referencia para reusar la integración en otro repositorio.
> Captura los flujos implementados, los pasos de onboarding, y los resultados de certificación.
> Última actualización: 2026-05-08

---

## 1. Qué es Channex y cómo lo usamos

Channex.io es un Channel Manager que actúa como intermediario entre un PMS (nuestro backend NestJS) y OTAs (Airbnb, Booking.com). Nosotros somos el PMS. Channex expone una REST API que usamos para:

- Crear propiedades, room types y rate plans en Channex
- Conectar esas entidades con canales OTA vía OAuth (Airbnb) o Hotel ID (Booking.com)
- Empujar disponibilidad y restricciones de precios (ARI) hacia las OTAs a través de Channex
- Recibir reservas y mensajes de las OTAs a través de webhooks de Channex

**Entorno staging:** `https://staging.channex.io/api/v1`
**Entorno producción:** `https://api.channex.io/v1`
**Autenticación:** header `user-api-key: {CHANNEX_API_KEY}` en cada request

---

## 2. Modelo de datos en Channex

```
Group (1 por business/tenant)
  └── Property (1 por listing de Airbnb, o 1 shell para Booking.com)
        ├── Room Type (1 por listing de Airbnb; varios para Booking.com)
        │     └── Rate Plan (1 o más por Room Type)
        └── Channel (conexión OTA — ABB = Airbnb, BDC = Booking.com)
              └── Mapping (liga Rate Plan ↔ OTA listing/rate)
```

**Firestore collection:** `channex_integrations/{tenantId}`
```
channex_integrations/
  {tenantId}/                        ← doc raíz del tenant
    channex_group_id: string
    channex_property_id: string      ← (Booking.com: shell property)
    channex_channel_id: string
    properties/
      {channexPropertyId}/           ← doc por propiedad
        connection_status: 'pending' | 'active' | 'token_expired' | 'error'
        room_types: StoredRoomType[]
        channex_webhook_id: string
        bookings/
          {bookingId}/               ← reservas
        webhook_events/
          {revisionId}/              ← auditoría de webhooks
```

---

## 3. Flujo de Onboarding — Airbnb vía OAuth

El flujo para conectar un tenant de Airbnb tiene estos pasos en orden. Todos son idempotentes (pueden re-ejecutarse sin crear duplicados).

### Paso A — Crear o reusar el Grupo del tenant

```
POST /api/v1/groups  { group: { title: "{tenantId}" } }
→ Guarda group_id en Firestore channex_integrations/{tenantId}.channex_group_id
→ Idempotente: lista grupos primero, reusa si ya existe uno con el mismo título
```

**Por qué:** Channex usa Groups para agrupar todas las propiedades de un mismo cliente. Un tenant = un grupo.

### Paso B — Crear la Property en Channex

```
POST /api/v1/properties {
  property: {
    title: string,       ← placeholder, se actualiza post-OAuth
    currency: string,    ← ISO 4217 (ej: "USD")
    timezone: string,    ← IANA (ej: "America/Lima")
    property_type: "apartment",
    group_id: string,    ← del Paso A
    settings: {
      allow_availability_autoupdate_on_confirmation: true
    }
  }
}
→ Retorna channex_property_id (UUID) — pivot para todas las operaciones siguientes
→ Guarda en Firestore: channex_integrations/{tenantId}/properties/{channexPropertyId}
```

**Nota:** `allow_availability_autoupdate_on_confirmation: true` es crítico — decrementa inventario automáticamente al confirmar una reserva, evitando race conditions antes de que el worker lo procese.

### Paso C — OAuth IFrame (el usuario conecta Airbnb)

Channex provee un IFrame embebible donde el usuario hace el OAuth de Airbnb. Para abrirlo:

```
POST /api/v1/auth/one_time_token  { property_id: string }
→ Retorna token (TTL: 15 minutos, single-use)

IFrame URL: {CHANNEX_BASE}/auth/exchange?
  oauth_session_key={token}
  &property_id={channexPropertyId}
  &channels=ABB
```

**Fallback CSP:** Si el browser bloquea el IFrame, usar:
```
GET /api/v1/properties/{propertyId}/channels/ABB/connect_url
→ URL directa para abrir en tab nuevo
```

Cuando el usuario completa el OAuth, Channex crea automáticamente:
- Un channel con código `ABB` vinculado a la property
- Mapping records vacíos (is_mapped=false) por cada listing de Airbnb

### Paso D — Descubrir listings de Airbnb y crear Room Types + Rate Plans

**D1. Descubrir los listings:**
```
GET /api/v1/channels/{channelId}/action/listings
→ data.listing_id_dictionary.values: [{ id: string, title: string }]
→ 422 guard: array vacío = OAuth no completado
```

**D2. Obtener detalles de cada listing (en paralelo):**
```
GET /api/v1/channels/{channelId}/action/listing_details?listing_id={id}
→ person_capacity        → default_occupancy del Room Type
→ pricing_settings.default_daily_price → rate inicial del Rate Plan
→ pricing_settings.listing_currency    → currency del Rate Plan
```

**D3. Para cada listing, crear Room Type:**
```
POST /api/v1/room_types {
  room_type: {
    property_id: string,
    title: string,           ← título del listing de Airbnb
    count_of_rooms: 1,       ← siempre 1 para vacation rentals
    default_occupancy: N,    ← de listing_details.person_capacity
    occ_adults: N,
    occ_children: 0,
    occ_infants: 0
  }
}
→ Retorna room_type_id
→ Availability default: 0 (propiedad invisible hasta primer push ARI)
```

**D4. Para cada listing, crear Rate Plan:**
```
POST /api/v1/rate_plans {
  rate_plan: {
    property_id: string,
    room_type_id: string,    ← del paso D3
    title: string,
    currency: string,        ← de listing_details
    options: [{
      occupancy: N,
      is_primary: true,
      rate: N                ← de listing_details.pricing_settings.default_daily_price
    }]
  }
}
→ Retorna rate_plan_id
```

**Idempotencia en D3/D4:** Antes de crear, hacer GET /room_types y GET /rate_plans filtrados por property_id. Si ya existe uno con el mismo título, reusar su ID.

### Paso E — Inyectar el Mapping (ligar Rate Plan al listing de Airbnb)

```
POST /api/v1/channels/{channelId}/mappings {
  mapping: {
    rate_plan_id: string,      ← del Paso D4
    settings: {
      listing_id: string       ← Airbnb listing ID del Paso D1
    }
  }
}
→ 201: mapping creado, retorna channel_rate_plan_id en data.id
→ 422: ya existe el mapping para este listing → log "already mapped", continuar (idempotente)
```

**IMPORTANTE:** Este es un CREATE (POST), no un UPDATE. Airbnb usa este endpoint para crear el mapping directamente desde el action API. No confundir con el antiguo flujo de PUT /mappings (obsoleto para Airbnb).

### Paso F — Activar el canal

```
POST /api/v1/channels/{channelId}/activate  {}
→ Activa el canal atómicamente (valida todos los mappings primero)
→ Fallback: PUT /api/v1/channels/{channelId} { channel: { is_active: true } }
```

Después de la activación, cargar reservas históricas:
```
POST /api/v1/channels/{channelId}/action/load_future_reservations  {}
→ Ingesta reservas futuras existentes en Airbnb
→ No-fatal: si falla, las reservas futuras llegarán por webhook
```

### Paso G — Registrar Webhook

```
POST /api/v1/webhooks {
  webhook: {
    property_id: string,
    callback_url: "{NGROK_URL}/webhook",
    is_active: true,
    send_data: true,           ← CRÍTICO: entrega payload completo sin necesidad de GET secundario
    headers: {
      "x-channex-signature": "{CHANNEX_WEBHOOK_SECRET}"  ← HMAC para verificación
    },
    event_mask: "booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry"
  }
}
→ Idempotente: listar webhooks de la property primero, saltar POST si ya existe uno con el mismo callback_url
```

### Paso H — Instalar Channex Messages App

```
POST /api/v1/applications/install {
  application_installation: {
    property_id: string,
    application_id: "8587fbf6-a6d1-46f8-8c12-074273284917"   ← UUID estable de Messages App
  }
}
→ 422: ya instalada → idempotente
```

**Resultado final en Firestore tras el flujo completo:**
```json
{
  "connection_status": "active",
  "channex_group_id": "...",
  "channex_property_id": "...",
  "channex_channel_id": "...",
  "channex_webhook_id": "...",
  "room_types": [
    {
      "room_type_id": "...",
      "title": "Listing Title",
      "source": "airbnb",
      "ota_listing_id": "...",
      "default_occupancy": 4,
      "rate_plans": [
        {
          "rate_plan_id": "...",
          "title": "...",
          "currency": "USD",
          "rate": 150,
          "channel_rate_plan_id": "..."
        }
      ]
    }
  ]
}
```

---

## 4. Flujo de Onboarding — Booking.com vía Hotel ID

Booking.com tiene un flujo diferente al de Airbnb. El inventory model está invertido: los rooms/rates viven en Channex y se sincronizan hacia BDC, no al revés.

### Pasos BDC 1–3: Group + Property + IFrame popup

Igual que Airbnb para el grupo (Paso A). La property se crea como shell:

```
POST /api/v1/properties {
  property: {
    title: "Booking.com Base Property",
    currency: "USD",
    timezone: "America/New_York",
    property_type: "hotel",
    group_id: string
  }
}
```

El IFrame popup para BDC usa el mismo `one_time_token` con `channels=BDC`. El usuario ingresa el Hotel ID de Booking.com en el popup. Channex crea el channel `BookingCom` al confirmar.

### Pasos BDC 4a–4c: Descubrir rooms/rates de BDC y crear entidades Channex

```
# 4a. Obtener channel details para extraer settings (credenciales OAuth)
GET /api/v1/channels/{channelId}
→ attributes.settings  ← credenciales BDC del OAuth, se pasan verbatim a mapping_details

# 4a. Descubrir rooms y rates de BDC
POST /api/v1/channels/mapping_details {
  channel: "BookingCom",
  settings: { ...de GET /channels/{id} }
}
→ data.rooms[].{ id, title, rates[].{ id, title, max_persons, readonly, pricing } }

# 4b. Por cada room único: crear Room Type (prefijo BDC:)
POST /api/v1/room_types { room_type: { title: "BDC: {otaRoomTitle}", ... } }

# 4c. Por cada rate dentro de cada room: crear Rate Plan (key compuesto {roomId}_{rateId})
POST /api/v1/rate_plans { rate_plan: { title: "BDC: {roomTitle} — {rateTitle}", ... } }
```

**Nota crítica sobre idempotencia en BDC:** Los rate IDs de BDC se repiten entre rooms (ej: ambas habitaciones tienen una "Standard Rate" con id=1). La clave de idempotencia debe ser `{otaRoomId}_{otaRateId}` compuesta, no solo el rate ID.

### Paso BDC 5: Inyectar mappings BDC (diferente a Airbnb)

BDC no usa POST /channels/{id}/mappings. En su lugar, un solo PUT atomico al channel document:

```
PUT /api/v1/channels/{channelId} {
  channel: {
    settings: {
      ...existingSettings,
      mappingSettings: {
        rooms: { "{otaRoomId}": "{channexRoomTypeId}", ... }
      }
    },
    rate_plans: [
      {
        rate_plan_id: "{channexRatePlanId}",
        settings: {
          room_type_code: Number(otaRoomId),
          rate_plan_code: Number(otaRateId),
          occupancy: N,
          readonly: boolean,
          primary_occ: true,
          occ_changed: false,
          pricing_type: string
        }
      }
    ]
  }
}
```

Los IDs de OTA son números en BDC; deben enviarse como `Number()` en este payload (aunque los manejamos como strings internamente).

### Pasos BDC 6–8: Activar + Webhook + Messages App

Idénticos a Airbnb (Pasos F–H). El event_mask para BDC incluye los mismos eventos.

---

## 5. ARI — Availability, Rates & Inventory

Una vez que la propiedad está activa, los pushes ARI sincronizan disponibilidad y restricciones de precios en tiempo real.

### Push de Availability

```
POST /api/v1/availability {
  values: [
    {
      property_id: string,
      room_type_id: string,
      date_from: "YYYY-MM-DD",
      date_to: "YYYY-MM-DD",
      availability: N       ← 0 o 1 para vacation rentals; N para hoteles
    }
  ]
}
→ data[0].id = taskId (UUID para el formulario de certificación)
```

### Push de Restrictions (rates, min/max stay, CTA/CTD, stop_sell)

```
POST /api/v1/restrictions {
  values: [
    {
      property_id: string,
      rate_plan_id: string,   ← IMPORTANTE: rate_plan_id, no room_type_id
      date_from: "YYYY-MM-DD",
      date_to: "YYYY-MM-DD",
      rate?: "150.00",              ← string decimal
      min_stay_arrival?: N,         ← Airbnb evalúa en arrival day
      max_stay?: N,
      stop_sell?: boolean,
      closed_to_arrival?: boolean,  ← CTA
      closed_to_departure?: boolean ← CTD
    }
  ]
}
→ data[0].id = taskId
```

**Reglas ARI:**
- `min_stay_through` NO está soportado (Channex lo acepta pero Airbnb lo ignora)
- Rate limit: 10 req/min por propiedad por tipo de endpoint
- Last-Write-Wins: conflictos se resuelven por orden de llegada (FIFO)
- Para vacation rentals (Airbnb): usar siempre `min_stay_arrival`, no `min_stay_through`

### Full Sync (go-live inicial)

Envía availability + restrictions para todos los room types y rate plans, 500 días hacia adelante, en 2 llamadas batch:

```
# 1 call para availability (todos los room types)
POST /api/v1/availability { values: [ ...entradas por roomTypeId ] }

# 1 call para restrictions (todos los rate plans, incluye rate + los 6 campos booleanos)
POST /api/v1/restrictions { values: [ ...entradas por ratePlanId ] }
```

Los 7 campos de restrictions en el full sync:
`rate`, `min_stay_arrival`, `max_stay`, `stop_sell`, `closed_to_arrival`, `closed_to_departure`
+ `min_stay_through` (enviado como 1 para no bloquear, aunque no lo soportamos como feature)

### Availability Rules (desbloquear restricciones de canal)

Para evitar que Channex bloquee reservas por reglas de aviso anticipado:

```
PUT /api/v1/channels/{channelId}/execute/update_availability_rule {
  channel_rate_plan_id: string,
  data: {
    day_of_week_min_nights: [-1,-1,-1,-1,-1,-1,-1],
    day_of_week_check_out:  [true,true,true,true,true,true,true],
    day_of_week_check_in:   [true,true,true,true,true,true,true],
    booking_lead_time: 0,
    default_max_nights: 1125,
    default_min_nights: 1,
    max_days_notice: -1,
    turnover_days: 0
  }
}
```

---

## 6. Recepción de Webhooks (Booking Receiving)

### Configuración

- `send_data: true` en el webhook: Channex entrega el payload completo de la reserva en el push, sin necesitar un GET secundario a `/booking_revisions/{id}`. Esto es crítico para no consumir cuota doble de la API.
- HMAC: `x-channex-signature` header con el CHANNEX_WEBHOOK_SECRET. Validar con `crypto.timingSafeEqual` antes de procesar.

### Eventos soportados

| Evento | Descripción |
|--------|-------------|
| `booking_new` | Nueva reserva |
| `booking_modification` | Modificación de reserva |
| `booking_cancellation` | Cancelación |
| `reservation_request` | Solicitud de reserva Airbnb (requiere aceptación explícita) |
| `alteration_request` | Solicitud de cambio de fechas Airbnb |
| `message` | Mensaje de huésped vía Channex Messages App |
| `inquiry` | Consulta pre-reserva |
| `booking_unmapped_room` | Reserva llegó con un room type sin mapear |
| `non_acked_booking` | Reserva sin ACK — Channex la reintenta hasta 30min |

### Flujo de procesamiento

```
POST /channex/webhook  (o /webhook según configuración)
  → Validar HMAC
  → Retornar 200 OK inmediatamente
  → Encolar payload en worker (BullMQ o procesamiento síncrono con retry)
  → Worker:
      1. Resolver tenant via property_id en Firestore
      2. Si es reservation_request/alteration_request:
           POST /api/v1/live_feed/{live_feed_id}/resolve  { resolution: { accept: true } }
      3. Si es booking_*:
           Transformar payload a doc Firestore
           Upsert en channex_integrations/{tenantId}/properties/{propertyId}/bookings/{bookingId}
           POST /api/v1/booking_revisions/{revisionId}/ack   ← CRÍTICO: sin ACK Channex reintenta
      4. Emitir SSE event al frontend (booking_new, booking_unmapped_room)
```

### Resolución de tenant desde webhook

El payload trae `property_id` (channex_property_id). Para encontrar el tenant:
```
Firestore query: channex_integrations where channex_property_id == property_id LIMIT 1
```
Requiere un índice Firestore en el campo `channex_property_id`.

### Fetch manual de reservas (fallback)

Si un webhook falla, recuperar reservas pendientes sin ACK:
```
GET /api/v1/booking_revisions/feed?filter[property_id]={propertyId}
→ Retorna solo las revisiones no-ACK (incluye booking data via sideload `included`)
→ Procesar cada una y hacer ACK individual
```

---

## 7. Mensajería

### Recibir mensajes de huéspedes

Llegan por el evento `message` del webhook. El payload incluye:
- `message_thread_id` → ID del hilo en Firestore
- `ota_message_id` → clave de idempotencia
- `message` → texto
- `sender: "guest"`
- `meta.name` → nombre del huésped
- `booking_id: null` para pre-booking inquiries

### Enviar respuestas

```
POST /api/v1/message_threads/{threadId}/messages {
  message: {
    message: string,
    sender: "host",
    property_id: string
  }
}
```

---

## 8. Certificación Channex — Qué se probó y cómo

La certificación PMS de Channex requiere demostrar 11 test cases con task IDs reales.

### Setup de la propiedad de certificación

```
Property:   Test Property — Migo UIT
Room Types:
  - Twin Room   (occupancy 2)
  - Double Room (occupancy 2)
Rate Plans:
  - Twin — Best Available Rate ($100 base)
  - Twin — Bed & Breakfast ($120 base)
  - Double — Best Available Rate ($100 base)
  - Double — Bed & Breakfast ($120 base)
```

### Tests de certificación

| # | Nombre | Qué manda | Calls API |
|---|--------|-----------|-----------|
| 1 | Full Sync | 500 días, todos los room types y rate plans, 7 campos | 2 (1 avail + 1 restrictions) |
| 2 | Single date, single rate | Twin BAR, 1 fecha, 1 rate | 1 |
| 3 | Single date, multiple rates | 3 rate plans, misma fecha | 1 |
| 4 | Multiple date, multiple rates | 3 rate plans, rangos distintos | 1 |
| 5 | Min Stay Update | min_stay_arrival en 3 combinaciones | 1 |
| 6 | Stop Sell Update | stop_sell=true en 3 fechas | 1 |
| 7 | Multiple Restrictions | CTA + CTD + max_stay + min_stay combinados | 1 |
| 8 | Half-year Update | 6 meses hacia adelante, rate + min_stay + CTA + CTD | 1 |
| 9 | Single Date Availability | avail por fechas individuales | 1 |
| 10 | Multiple Date Availability | avail por rangos de fecha | 1 |
| 11 | Booking Receiving | El evaluador pushea webhooks manualmente — 3 eventos (new/modification/cancellation) | N/A |

### Restricciones soportadas declaradas en el formulario

- ✅ Availability
- ✅ Rate
- ✅ Min Stay Arrival
- ✅ Max Stay
- ✅ Closed To Arrival (CTA)
- ✅ Closed To Departure (CTD)
- ✅ Stop Sell
- ❌ Min Stay Through (NO soportado — Airbnb lo ignora)

### Rate limits (respuesta para el formulario)

**¿Pueden mantenerse dentro de los rate limits?** Sí.
- `ChannexARIRateLimiter` implementado: sliding window 10 req/min por propiedad por tipo de endpoint (availability / restrictions). Cola interna con back-off automático ante HTTP 429.

**¿Solo envían cambios delta?** Sí.
- Los pushes se disparan por acciones del usuario en el PMS.
- No existe timer de full-sync automático.
- El `fullSync` se ejecuta solo en el go-live inicial o bajo demanda explícita del operador (máximo 1 vez cada 24h).

### Endpoints internos usados para los tests de certificación

```bash
# Full Sync (Test #1)
POST /channex/properties/{propertyId}/full-sync
Body: {
  defaultAvailability: 1,
  defaultRate: "100.00",
  defaultMinStayArrival: 1,
  defaultMaxStay: 30,
  defaultStopSell: false,
  defaultClosedToArrival: false,
  defaultClosedToDeparture: false,
  days: 500
}

# ARI push (Tests #2–#10)
POST /channex/properties/{propertyId}/push-restrictions
Body: { values: [...] }

POST /channex/properties/{propertyId}/push-availability
Body: { values: [...] }
```

---

## 9. Resumen de Endpoints Channex API usados

### Properties
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/properties` | Crear property |
| GET | `/properties/{id}` | Leer property |
| PUT | `/properties/{id}` | Actualizar (title, currency) |
| DELETE | `/properties/{id}` | Borrar (rollback en caso de fallo) |

### Groups
| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/groups` | Listar grupos del API key |
| POST | `/groups` | Crear grupo |

### Room Types & Rate Plans
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/room_types` | Crear room type |
| GET | `/room_types?filter[property_id]={id}` | Listar para idempotencia |
| POST | `/rate_plans` | Crear rate plan |
| GET | `/rate_plans?filter[property_id]={id}` | Listar para idempotencia |

### Channels & Mappings
| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/channels?filter[property_id]={id}` | Listar canales de una property |
| GET | `/channels/{id}` | Detalles del canal (settings para BDC) |
| PUT | `/channels/{id}` | Actualizar canal (BDC mapping, is_active fallback) |
| POST | `/channels/{id}/activate` | Activar canal (action endpoint) |
| POST | `/channels/{id}/mappings` | Crear mapping (Airbnb) |
| GET | `/channels/{id}/mappings` | Listar mappings |
| PUT | `/channels/{id}/execute/update_availability_rule` | Resetear reglas de disponibilidad |
| POST | `/channels/mapping_details` | Obtener rooms/rates de BDC |

### Airbnb Action API
| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/channels/{id}/action/listings` | Listado de Airbnb listings |
| GET | `/channels/{id}/action/listing_details?listing_id={id}` | Capacidad, precio, moneda |
| GET | `/channels/{id}/action/get_listing_calendar?listing_id=...&date_from=...&date_to=...` | Calendario ARI del listing |
| POST | `/channels/{id}/action/load_future_reservations` | Cargar reservas históricas post-activación |

### OAuth
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/auth/one_time_token` | Token para IFrame (TTL 15min, single-use) |
| GET | `/properties/{id}/channels/{channel}/connect_url` | URL directa fallback CSP |

### ARI
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/availability` | Push de disponibilidad |
| GET | `/availability?filter[...]` | Leer disponibilidad |
| POST | `/restrictions` | Push de rates + restricciones |
| GET | `/restrictions?filter[...]` | Leer restricciones |

### Bookings & Webhooks
| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/booking_revisions/{id}` | Pull de revisión (fallback sin send_data) |
| POST | `/booking_revisions/{id}/ack` | ACK obligatorio post-procesamiento |
| GET | `/booking_revisions/feed?filter[property_id]={id}` | Feed de revisiones sin ACK |
| GET | `/bookings?filter[property_id]=...` | Historial administrativo |
| POST | `/webhooks` | Registrar webhook |
| GET | `/webhooks?filter[property_id]={id}` | Listar webhooks (idempotencia) |
| POST | `/live_feed/{id}/resolve` | Aceptar/rechazar reservation_request |

### Mensajería
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/message_threads/{threadId}/messages` | Responder a hilo de mensajes |

### Aplicaciones
| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/applications/install` | Instalar Messages App (UUID: `8587fbf6-a6d1-46f8-8c12-074273284917`) |

---

## 10. Gotchas y decisiones de diseño importantes

1. **`send_data: true` en el webhook** — sin esto, cada evento requiere un GET secundario a `/booking_revisions/{id}`, doblando el consumo de cuota API. Con `send_data: true`, el payload completo llega en el push.

2. **ACK obligatorio** — `POST /booking_revisions/{revisionId}/ack` después de procesar cada booking. Sin ACK, Channex reintenta con `non_acked_booking` cada N minutos durante 30 minutos.

3. **Mapping Airbnb = POST, no PUT** — Los mapping records para Airbnb se crean con POST `/channels/{id}/mappings`. El antiguo flujo de GET + PUT de mapping records preexistentes está obsoleto para el flow de action API.

4. **Mapping BDC = PUT al channel document** — Booking.com no usa el endpoint de mappings individual. Los mappings se embeben en el channel document via PUT con `settings.mappingSettings.rooms` + `rate_plans[]`.

5. **IDs de BDC son números** — La API de Channex retorna los room/rate IDs de BDC como `number`. Internamente los manejamos como `string`, pero al escribir de vuelta en `channel.settings` deben ser `Number()`.

6. **Rate IDs de BDC no son únicos por sí solos** — Dos rooms pueden tener una rate con el mismo ID (ej: `id: 1` en ambas). La clave de idempotencia debe ser `{otaRoomId}_{otaRateId}`.

7. **Tenant lookup via property_id** — El webhook trae `property_id` (channex UUID), no el tenant ID de nuestra app. Necesita un índice Firestore: `channex_integrations where channex_property_id == ?`.

8. **`min_stay_through` ignorado por Airbnb** — Channex lo acepta, Airbnb lo descarta. Solo usar `min_stay_arrival` para Airbnb.

9. **One-time token es single-use** — Genera uno nuevo por cada render del IFrame. Nunca persistir.

10. **Property delete como rollback** — Si cualquier paso A–F falla al provisionar, `DELETE /properties/{id}` limpia la entidad en Channex para evitar orphans.
