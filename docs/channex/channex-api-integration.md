# Channex.io — API Reference & Integration Flows

> Referencia completa de endpoints, schemas exactos y flujos de integración.
> Incluye el flujo de certificación PMS de Channex.
> Última actualización: 2026-05-09

---

## 1. Autenticación

Todos los requests a Channex requieren el header:

```
user-api-key: {CHANNEX_API_KEY}
Content-Type: application/json
```

La API key se obtiene desde el panel de Channex (Settings → API Keys).

**Referencia:** `channex.service.ts → buildAuthHeaders()`

**Documentación Channex:**
https://docs.channex.io/guides/pms-integration-guide

---

## 2. Flujo Unificado de Integración

El flujo es el mismo para todos los casos. Los pasos marcados con `[channel]` solo aplican cuando hay una integración OTA activa (Airbnb o Booking.com).

```
Paso 1  → Verificar / Crear Group
Paso 2  → [channel] Abrir IFrame popup (one-time token)
Paso 3  → [channel] Sync del channel → obtener listings
Paso 4  → Crear Properties (desde listings si hay channel)
Paso 5  → [channel] Enriquecer Property con datos reales del listing
Paso 6  → Crear Room Types (desde datos de listing si hay channel)
Paso 7  → Crear Rate Plans (desde datos de listing si hay channel)
Paso 8  → [channel] Mapping en el channel
Paso 9  → [channel] Activar channel
Paso 10 → [channel] Load future reservations
Paso 11 → [channel] ARI Full Sync (manual, por property)
Paso 12 → Suscripción de Webhooks (por property)
Paso 13 → Activar Messages App (por property)
Paso 14 → [channel] Fetch de bookings
```

---

### Paso 1 — Verificar / Crear Group

Un Group agrupa todas las Properties de un mismo negocio. Se verifica si ya existe antes de crear uno nuevo.

**Listar grupos existentes**

```
GET /api/v1/groups
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "group",
      "attributes": {
        "title": "string",
        "status": "string"
      }
    }
  ]
}
```

**Crear grupo**

```
POST /api/v1/groups
```

**Request:**
```json
{
  "group": {
    "title": "string"
  }
}
```

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "type": "group",
    "attributes": {
      "title": "string",
      "status": "string"
    }
  }
}
```

**Referencia:** `channex-group.service.ts → ensureGroup()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/groups-collection

---

### Paso 2 — [channel] Abrir IFrame popup (one-time token)

Se genera un token de sesión de un solo uso para abrir el IFrame de conexión de Channex donde el usuario realiza el OAuth con la OTA.

```
POST /api/v1/auth/one_time_token
```

**Request:**
```json
{
  "property_id": "uuid"
}
```

**Respuesta:**
```json
{
  "data": {
    "token": "string"
  }
}
```

**TTL:** 15 minutos, invalidado en el primer uso. Nunca persistir.

**URL del IFrame:**
```
{CHANNEX_BASE}/auth/exchange
  ?oauth_session_key={token}
  &property_id={channexPropertyId}
  &channels=ABB           ← Airbnb
  &channels=BDC           ← Booking.com
```

**Fallback CSP** (si el browser bloquea el IFrame):
```
GET /api/v1/properties/{propertyId}/channels/{channel}/connect_url
```
Retorna `{ data: { url: string } }` — URL directa para abrir en nueva pestaña.

**Referencia:** `channex-oauth.service.ts → getOneTimeToken()` / `channex.service.ts → getChannelConnectionUrl()`

**Documentación Channex:**
https://docs.channex.io/guides/pms-integration-guide

---

### Paso 3 — [channel] Sync del channel → listings

Después de que el usuario completa el popup, se obtiene la información del channel para crear las entidades de Channex.

#### Airbnb

**Listar los listings del channel:**
```
GET /api/v1/channels/{channelId}/action/listings
```

**Respuesta:**
```json
{
  "data": {
    "listing_id_dictionary": {
      "values": [
        {
          "id": "string",
          "title": "string"
        }
      ]
    }
  }
}
```

`id` = Airbnb listing ID. Array vacío = OAuth no completado.

**Obtener detalles de cada listing** (en paralelo):
```
GET /api/v1/channels/{channelId}/action/listing_details?listing_id={id}
```

**Respuesta:**
```json
{
  "data": {
    "person_capacity": "number",
    "pricing_settings": {
      "default_daily_price": "number | string | null",
      "listing_currency": "string | null"
    },
    "images": [
      {
        "url": "string",
        "caption": "string | null"
      }
    ]
  }
}
```

**Referencia:** `channex.service.ts → getAirbnbListingsAction()` / `channex.service.ts → getAirbnbListingDetails()`

**Documentación Channex:**
https://docs.channex.io/channel-mapping-guides/airbnb

> **Nota:** Esta guía describe cómo realizar la conexión del channel de Airbnb. El usuario debe autorizar el acceso desde el IFrame de Channex (OAuth). No requiere configuración previa en el admin de Airbnb.

#### Booking.com

**Obtener settings del channel** (credenciales BDC almacenadas):
```
GET /api/v1/channels/{channelId}
```

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "attributes": {
      "channel": "BookingCom",
      "is_active": "boolean",
      "settings": {},
      "properties": ["uuid"]
    },
    "relationships": {
      "properties": {
        "data": [{ "id": "uuid" }]
      }
    }
  }
}
```

**Obtener rooms y rates de BDC:**
```
POST /api/v1/channels/mapping_details
```

**Request:**
```json
{
  "channel": "BookingCom",
  "settings": {}
}
```

`settings` debe tomarse verbatim de `GET /channels/{channelId}` → `attributes.settings`.

**Respuesta:**
```json
{
  "data": {
    "rooms": [
      {
        "id": "number",
        "title": "string",
        "rates": [
          {
            "id": "number",
            "title": "string",
            "max_persons": "number",
            "readonly": "boolean",
            "pricing": "string"
          }
        ]
      }
    ]
  }
}
```

Los IDs llegan como `number`. Castear a `string` para uso interno.

**Referencia:** `channex.service.ts → getChannelDetails()` / `channex.service.ts → getMappingDetails()` / `booking-pipeline.service.ts → fetchBdcMappings()`

**Documentación Channex:**
https://docs.channex.io/channel-mapping-guides/booking.com

> **Nota:** Esta guía describe cómo realizar la conexión con Booking.com. Antes de conectar el channel en Channex, el hotelero debe habilitar un Connectivity Provider desde el admin de Booking.com (Extranet → Conectividad → Proveedores de conectividad). Sin este paso, la conexión OAuth no podrá completarse.

---

### Paso 4 — Crear Properties

Con channel: se crea una Property por cada listing de Airbnb, o una Property shell para Booking.com. Sin channel: se crea manualmente.

```
POST /api/v1/properties
```

**Request:**
```json
{
  "property": {
    "title": "string",
    "currency": "string",
    "timezone": "string",
    "property_type": "string",
    "group_id": "uuid",
    "settings": {
      "allow_availability_autoupdate_on_confirmation": "boolean",
      "min_stay_type": "arrival | both | through"
    }
  }
}
```

`allow_availability_autoupdate_on_confirmation: true` es crítico — decrementa el inventario automáticamente al confirmar una reserva, evitando race conditions antes de que el worker lo procese.

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "type": "property",
    "attributes": {
      "title": "string",
      "currency": "string",
      "timezone": "string",
      "property_type": "string",
      "group_id": "uuid | null",
      "status": "string"
    }
  }
}
```

`data.id` = `channex_property_id` — pivot para todas las operaciones siguientes.

**Rollback:** Si cualquier paso posterior falla, eliminar la property:
```
DELETE /api/v1/properties/{propertyId}
```

**Referencia:** `channex-property.service.ts → provisionProperty()` / `channex.service.ts → createProperty()` / `channex.service.ts → deleteProperty()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/hotels-collection

---

### Paso 5 — [channel] Enriquecer Property con datos reales del listing

Después del OAuth, la Property fue creada con valores placeholder. Se actualiza con los datos reales del listing de la OTA (aplica tanto para Airbnb como para Booking.com).

```
PUT /api/v1/properties/{propertyId}
```

**Request:**
```json
{
  "property": {
    "title": "string",
    "currency": "string"
  }
}
```

Solo se envían los campos a modificar. El timezone no se actualiza aquí (fue definido en el formulario de provisioning).

**Respuesta:** misma que `POST /api/v1/properties`.

**Referencia:** `channex.service.ts → updateProperty()` / `channex-sync.service.ts → enrichPropertyFromAirbnbData()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/hotels-collection

---

### Paso 6 — Crear Room Types

Con channel: los datos del room type (título, capacidad) vienen del listing. Sin channel: se ingresan manualmente.

**Verificar idempotencia antes de crear:**
```
GET /api/v1/room_types?filter[property_id]={propertyId}
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "room_type",
      "attributes": {
        "title": "string",
        "property_id": "uuid",
        "default_occupancy": "number",
        "occ_adults": "number",
        "occ_children": "number",
        "occ_infants": "number",
        "availability": "number"
      }
    }
  ]
}
```

**Crear room type:**
```
POST /api/v1/room_types
```

**Request:**
```json
{
  "room_type": {
    "property_id": "uuid",
    "title": "string",
    "count_of_rooms": "number",
    "default_occupancy": "number",
    "occ_adults": "number",
    "occ_children": "number",
    "occ_infants": "number"
  }
}
```

Para vacation rentals (Airbnb): `count_of_rooms: 1`. La `availability` arranca en `0` — la property permanece invisible en la OTA hasta el primer push ARI.

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "type": "room_type",
    "attributes": {
      "title": "string",
      "property_id": "uuid",
      "default_occupancy": "number",
      "occ_adults": "number",
      "occ_children": "number",
      "occ_infants": "number",
      "availability": 0
    }
  }
}
```

**Referencia:** `channex.service.ts → createRoomType()` / `channex.service.ts → getRoomTypes()` / `channex-ari.service.ts → createRoomType()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/room-types-collection

---

### Paso 7 — Crear Rate Plans

Con channel: precio y moneda vienen del listing. Sin channel: se ingresan manualmente. Un Room Type puede tener múltiples Rate Plans.

**Verificar idempotencia antes de crear:**
```
GET /api/v1/rate_plans?filter[property_id]={propertyId}
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "rate_plan",
      "attributes": {
        "title": "string",
        "room_type_id": "uuid",
        "property_id": "uuid"
      }
    }
  ]
}
```

**Crear rate plan:**
```
POST /api/v1/rate_plans
```

**Request:**
```json
{
  "rate_plan": {
    "property_id": "uuid",
    "room_type_id": "uuid",
    "title": "string",
    "currency": "string | null",
    "options": [
      {
        "occupancy": "number",
        "is_primary": "boolean",
        "rate": "number"
      }
    ]
  }
}
```

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "type": "rate_plan",
    "attributes": {
      "title": "string",
      "room_type_id": "uuid",
      "property_id": "uuid"
    }
  }
}
```

**Referencia:** `channex.service.ts → createRatePlan()` / `channex.service.ts → getRatePlans()` / `channex-ari.service.ts → createRatePlan()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/rate-plans-collection

---

### Paso 8 — [channel] Mapping en el channel

Liga los Room Types y Rate Plans de Channex con los listings/rooms/rates de la OTA. **El mecanismo es diferente entre Airbnb y Booking.com.**

#### Airbnb — POST por listing

```
POST /api/v1/channels/{channelId}/mappings
```

**Request:**
```json
{
  "mapping": {
    "rate_plan_id": "uuid",
    "settings": {
      "listing_id": "string"
    }
  }
}
```

**Respuesta (201):**
```json
{
  "data": {
    "id": "uuid"
  }
}
```

`data.id` = `channel_rate_plan_id` — guardar para `update_availability_rule`.

**HTTP 422:** mapping ya existe para este listing → idempotente, continuar.

**Referencia:** `channex.service.ts → createChannelMapping()` / `channex-sync.service.ts → syncIsolated()`

**Documentación Channex:**
https://docs.channex.io/channel-mapping-guides/airbnb

> **Nota:** La guía describe el proceso de mapping desde el admin de Channex. En integración programática, el mapping se realiza vía `POST /channels/{id}/mappings` con `{ rate_plan_id, settings: { listing_id } }`.

#### Booking.com — PUT atómico al channel document

BDC no usa el endpoint de mappings individual. Los mappings se embeben directamente en el channel document.

```
PUT /api/v1/channels/{channelId}
```

**Request:**
```json
{
  "channel": {
    "settings": {
      "mappingSettings": {
        "rooms": {
          "{otaRoomId}": "{channexRoomTypeId}"
        }
      }
    },
    "rate_plans": [
      {
        "rate_plan_id": "uuid",
        "settings": {
          "room_type_code": "number",
          "rate_plan_code": "number",
          "occupancy": "number",
          "readonly": "boolean",
          "primary_occ": "boolean",
          "occ_changed": "boolean",
          "pricing_type": "string"
        }
      }
    ]
  }
}
```

`room_type_code` y `rate_plan_code` son los IDs de BDC casteados a `Number()`.

El `settings` base del channel debe preservarse: obtener con `GET /channels/{channelId}` y hacer spread del `attributes.settings` existente antes de agregar `mappingSettings`.

**Referencia:** `channex.service.ts → updateChannel()` / `booking-pipeline.service.ts → createMappings()`

**Documentación Channex:**
https://docs.channex.io/channel-mapping-guides/booking.com

> **Nota:** La guía describe el proceso de mapping desde el admin de Channex. En integración programática, el mapping para BDC se hace como un PUT atómico al channel document, no endpoint individual por rate plan.

---

### Paso 9 — [channel] Activar channel

Activa el canal atómicamente. Sin este paso, los pushes ARI son aceptados pero la OTA no recibe actualizaciones y los bookings no fluyen.

```
POST /api/v1/channels/{channelId}/activate
```

**Request:** `{}` (body vacío)

**Fallback** si el action endpoint no está disponible en staging:
```
PUT /api/v1/channels/{channelId}
```
```json
{
  "channel": {
    "is_active": true
  }
}
```

**Referencia:** `channex.service.ts → activateChannelAction()` / `channex.service.ts → activateChannel()`

**Documentación Channex:**
https://docs.channex.io/guides/pms-integration-guide

---

### Paso 10 — [channel] Load future reservations

Ingesta las reservas históricas/futuras existentes en la OTA hacia Channex. Debe llamarse después de la activación del channel.

```
POST /api/v1/channels/{channelId}/action/load_future_reservations
```

**Request (todo el channel):**
```json
{}
```

**Request (listing específico):**
```json
{
  "listing_id": "string"
}
```

No-fatal: si falla, las reservas futuras llegan por webhook. Las reservas pasadas se pueden recuperar manualmente.

**Referencia:** `channex.service.ts → loadFutureReservations()`

**Documentación Channex:**
https://docs.channex.io/guides/pms-integration-guide

---

### Paso 11 — [channel] ARI Full Sync (manual, por property)

Push manual de disponibilidad y restricciones hacia Channex, que las propaga a la OTA. Se ejecuta por property cuando el operador lo decide — no es automático. Modifica los datos del usuario en Airbnb o Booking.com.

Este paso es el que verifica el **Test #1 de certificación Channex**.

Se realizan **2 llamadas independientes** a Channex:

**Push de availability (todos los room types):**
```
POST /api/v1/availability
```
```json
{
  "values": [
    {
      "property_id": "uuid",
      "room_type_id": "uuid",
      "date_from": "YYYY-MM-DD",
      "date_to": "YYYY-MM-DD",
      "availability": "number"
    }
  ]
}
```

**Push de restrictions (todos los rate plans — 7 campos):**
```
POST /api/v1/restrictions
```
```json
{
  "values": [
    {
      "property_id": "uuid",
      "rate_plan_id": "uuid",
      "date_from": "YYYY-MM-DD",
      "date_to": "YYYY-MM-DD",
      "rate": "string",
      "min_stay_arrival": "number",
      "max_stay": "number | null",
      "stop_sell": "boolean",
      "closed_to_arrival": "boolean",
      "closed_to_departure": "boolean"
    }
  ]
}
```

**Respuesta (ambos endpoints):**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "string"
    }
  ],
  "meta": {
    "message": "string",
    "warnings": ["string"]
  }
}
```

`data[0].id` = task ID que Channex asigna — se usa como evidencia en el formulario de certificación.

**Referencia:** `channex-ari.service.ts → fullSync()` / `channex.service.ts → pushAvailability()` / `channex.service.ts → pushRestrictions()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

---

### Paso 12 — Suscripción de Webhooks (por property)

Cada property tiene su propia suscripción de webhook. Se verifica si ya existe antes de crear.

**Verificar si ya existe:**
```
GET /api/v1/webhooks?filter[property_id]={propertyId}
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "webhook",
      "attributes": {
        "property_id": "uuid",
        "callback_url": "string",
        "is_active": "boolean",
        "send_data": "boolean",
        "events": ["string"],
        "headers": {}
      }
    }
  ]
}
```

**Crear suscripción:**
```
POST /api/v1/webhooks
```

**Request:**
```json
{
  "webhook": {
    "property_id": "uuid",
    "callback_url": "string",
    "is_active": true,
    "send_data": true,
    "headers": {
      "x-channex-signature": "string"
    },
    "event_mask": "booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry"
  }
}
```

`send_data: true` es crítico — entrega el payload completo de la reserva directamente en el webhook, eliminando la necesidad de un GET secundario a `/booking_revisions/{id}`.

`x-channex-signature` = secreto HMAC para verificar la autenticidad del webhook entrante.

`event_mask` = string separado por punto y coma (no array).

**Respuesta (201):**
```json
{
  "data": {
    "id": "uuid",
    "type": "webhook",
    "attributes": {
      "property_id": "uuid",
      "callback_url": "string",
      "is_active": true,
      "send_data": true,
      "events": ["string"],
      "headers": {
        "x-channex-signature": "string"
      }
    }
  }
}
```

`data.id` = `channex_webhook_id` — guardar en el sistema.

**Referencia:** `channex.service.ts → createWebhookSubscription()` / `channex.service.ts → listPropertyWebhooks()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/webhook-collection

> **Importante:** Usar siempre el webhook por propiedad (`filter[property_id]`), no el webhook global de cuenta. El webhook global no permite configurar `send_data: true` ni el `event_mask` por propiedad — cada property debe tener su propia suscripción independiente.

---

### Paso 13 — Activar Messages App (por property)

Instala la Channex Messages App en cada property para habilitar la mensajería entrante de huéspedes.

```
POST /api/v1/applications/install
```

**Request:**
```json
{
  "application_installation": {
    "property_id": "uuid",
    "application_id": "8587fbf6-a6d1-46f8-8c12-074273284917"
  }
}
```

`application_id` es el UUID estable de la Channex Messages App — no usar `application_code`.

**Respuesta (201):**
```json
{
  "data": {
    "id": "uuid",
    "type": "application_installation",
    "attributes": {
      "property_id": "uuid",
      "application_code": "string",
      "status": "string"
    }
  }
}
```

**HTTP 422:** app ya instalada → idempotente, continuar.

**Referencia:** `channex.service.ts → installMessagesApp()` / `channex.service.ts → installApplication()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/applications-api

---

### Paso 14 — [channel] Fetch de bookings

#### Feed de reservas no reconocidas (unacked)

Retorna solo las revisiones que aún no han sido confirmadas (ACK) por el PMS. Usar para recuperar reservas que no llegaron por webhook.

```
GET /api/v1/booking_revisions/feed?filter[property_id]={propertyId}
```

**Respuesta (JSON:API con sideloading):**
```json
{
  "data": [
    {
      "id": "uuid",
      "attributes": {
        "status": "string"
      },
      "relationships": {
        "booking": {
          "data": {
            "id": "uuid"
          }
        }
      }
    }
  ],
  "included": [
    {
      "id": "uuid",
      "type": "booking",
      "attributes": {}
    }
  ]
}
```

Los datos del booking viven en `included` (tipo `"booking"`), enlazados por `relationships.booking.data.id`. Procesar cada revisión y hacer ACK individual.

**Referencia:** `channex.service.ts → fetchBookingRevisionsFeed()`

#### Historial administrativo

```
GET /api/v1/bookings
  ?filter[property_id]={propertyId}
  &filter[group_id]={groupId}
  &pagination[limit]={n}
  &order[inserted_at]=desc
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "attributes": {}
    }
  ]
}
```

**Referencia:** `channex.service.ts → fetchBookings()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/bookings-collection

---

## 3. Diferencias Airbnb vs Booking.com

Los pasos son los mismos para ambos canales. Las diferencias son de detalle en los datos que provee cada OTA.

| Paso | Airbnb | Booking.com |
|------|--------|-------------|
| **3. Sync listings** | `GET /channels/{id}/action/listings` + `listing_details` | `GET /channels/{id}` + `POST /channels/mapping_details` |
| **4. Properties** | Una property por listing | Una property shell para todos los rooms |
| **5. Enriquecer** | título + currency del listing | título + currency del room |
| **6. Room Types** | Uno por listing — `count_of_rooms: 1` | Uno por room BDC — `count_of_rooms: 1` |
| **7. Rate Plans** | Uno por listing — precio de `default_daily_price` | Uno por rate BDC — precio en 0 (se actualiza por ARI) |
| **8. Mapping** | `POST /channels/{id}/mappings` con `{ rate_plan_id, settings: { listing_id } }` | `PUT /channels/{id}` con `mappingSettings.rooms` + `rate_plans[]` |
| **Payment** | `payment_collect: "ota"`, `payment_type: "bank_transfer"` | `payment_collect: "property"`, `payment_type: "credit_card"` |
| **Idempotencia de mapping** | 422 = ya existe, continuar | PUT idempotente, siempre reescribe |

**Nota sobre Booking.com rate IDs:** Los IDs de rooms y rates en BDC llegan como `number` y pueden repetirse entre rooms distintos (ej: ambas habitaciones tienen una rate con `id: 1`). La clave compuesta `{otaRoomId}_{otaRateId}` es la forma correcta de identificar cada entry de rate.

---

## 4. ARI Calendar — Actualizaciones Manuales

Endpoints para actualizar disponibilidad, tarifas y restricciones desde el calendario. Operan siempre sobre un rango de fechas (`date_from` / `date_to`). Para una fecha individual, usar la misma fecha en ambos campos.

**Rate limit:** 10 requests/min por property por tipo de endpoint (availability / restrictions).

### Push de Availability

```
POST /api/v1/availability
```

**Request:**
```json
{
  "values": [
    {
      "property_id": "uuid",
      "room_type_id": "uuid",
      "date_from": "YYYY-MM-DD",
      "date_to": "YYYY-MM-DD",
      "availability": "number"
    }
  ]
}
```

`availability`: 0 o 1 para vacation rentals. Entero positivo para hoteles multi-habitación.

**Respuesta:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "string"
    }
  ],
  "meta": {
    "message": "string",
    "warnings": ["string"]
  }
}
```

**Referencia:** `channex.service.ts → pushAvailability()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

---

### Push de Restrictions (tarifas + restricciones)

```
POST /api/v1/restrictions
```

**Request:**
```json
{
  "values": [
    {
      "property_id": "uuid",
      "rate_plan_id": "uuid",
      "date_from": "YYYY-MM-DD",
      "date_to": "YYYY-MM-DD",
      "rate": "string",
      "min_stay_arrival": "number",
      "max_stay": "number | null",
      "stop_sell": "boolean",
      "closed_to_arrival": "boolean",
      "closed_to_departure": "boolean"
    }
  ]
}
```

`rate_plan_id` — no `room_type_id`. Las restrictions operan sobre Rate Plans.

`rate` — string decimal (ej: `"150.00"`).

`min_stay_arrival` — Airbnb evalúa en el día de llegada. No usar `min_stay_through` para Airbnb.

Conflict resolution: Last-Write-Wins (FIFO).

**Respuesta:** misma que `POST /api/v1/availability`.

**Referencia:** `channex.service.ts → pushRestrictions()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

**Rate limits:** https://docs.channex.io/api-v.1-documentation/rate-limits

---

### Leer Availability actual

```
GET /api/v1/availability
  ?filter[date][gte]={YYYY-MM-DD}
  &filter[date][lte]={YYYY-MM-DD}
  &filter[property_id]={propertyId}
```

**Respuesta:**
```json
{
  "data": {
    "{roomTypeId}": {
      "{YYYY-MM-DD}": "number"
    }
  }
}
```

**Referencia:** `channex.service.ts → fetchAvailability()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

---

### Leer Restrictions actuales

```
GET /api/v1/restrictions
  ?filter[date][gte]={YYYY-MM-DD}
  &filter[date][lte]={YYYY-MM-DD}
  &filter[property_id]={propertyId}
  &filter[restrictions]=rate,stop_sell,closed_to_arrival,closed_to_departure,min_stay_arrival,min_stay_through,min_stay,max_stay,availability,stop_sell_manual,max_availability,availability_offset
```

**Respuesta:**
```json
{
  "data": {
    "{ratePlanId}": {
      "{YYYY-MM-DD}": {
        "availability": "number",
        "availability_offset": "number",
        "closed_to_arrival": "boolean",
        "closed_to_departure": "boolean",
        "max_availability": "number | null",
        "max_stay": "number",
        "min_stay_arrival": "number",
        "min_stay_through": "number",
        "rate": "string",
        "stop_sell": "boolean",
        "stop_sell_manual": "boolean",
        "unavailable_reasons": ["string"]
      }
    }
  }
}
```

**Referencia:** `channex.service.ts → fetchRestrictions()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

---

### Availability Rules — Resetear restricciones del channel

Elimina restricciones de aviso anticipado que bloquean reservas en el channel.

```
PUT /api/v1/channels/{channelId}/execute/update_availability_rule
```

**Request:**
```json
{
  "channel_rate_plan_id": "string",
  "data": {
    "day_of_week_min_nights": [-1, -1, -1, -1, -1, -1, -1],
    "day_of_week_check_out": [true, true, true, true, true, true, true],
    "day_of_week_check_in": [true, true, true, true, true, true, true],
    "booking_lead_time": 0,
    "default_max_nights": 1125,
    "default_min_nights": 1,
    "max_days_notice": -1,
    "turnover_days": 0
  }
}
```

`channel_rate_plan_id` = el `id` retornado por `POST /channels/{id}/mappings` (Airbnb).

`day_of_week_*` = arrays de 7 elementos (lunes → domingo). `-1` = sin restricción.

**Referencia:** `channex.service.ts → updateAvailabilityRule()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/ari

---

## 5. Webhooks Entrantes

Channex envía los eventos al endpoint configurado en el Paso 12. La verificación de autenticidad usa HMAC con el header `x-channex-signature`.

### Schema raíz — todos los eventos

```json
{
  "event": "string",
  "property_id": "uuid",
  "revision_id": "uuid",
  "channel_id": "uuid",
  "live_feed_id": "string",
  "booking": {},
  "payload": {}
}
```

| Campo | Descripción |
|-------|-------------|
| `event` | Tipo de evento (ver tabla abajo) |
| `property_id` | UUID de la property en Channex — usar para resolver el tenant |
| `revision_id` | UUID de la revisión — usar para el ACK |
| `channel_id` | UUID del canal OTA (opcional) |
| `live_feed_id` | Solo en `reservation_request` y `alteration_request` |
| `booking` | Datos del booking (eventos de booking con `send_data: true`) |
| `payload` | Datos del mensaje (eventos de mensajería) |

**Eventos soportados:**

| Evento | Descripción |
|--------|-------------|
| `booking_new` | Nueva reserva recibida |
| `booking_modification` | Reserva modificada (fechas, huéspedes, etc.) |
| `booking_cancellation` | Reserva cancelada |
| `reservation_request` | Solicitud de reserva Airbnb — requiere aceptación explícita |
| `alteration_request` | Solicitud de cambio de fechas Airbnb — requiere aceptación |
| `message` | Mensaje de huésped vía Messages App |
| `inquiry` | Consulta pre-reserva |
| `booking_unmapped_room` | Reserva con room type sin mapear — requiere acción del admin |
| `non_acked_booking` | Reserva sin ACK — Channex reintenta durante 30 minutos |

---

### Schema de Booking (new / modification / cancellation)

El campo `booking` está presente cuando `send_data: true` en la suscripción del webhook.

```json
{
  "event": "booking_new | booking_modification | booking_cancellation",
  "property_id": "uuid",
  "revision_id": "uuid",
  "channel_id": "uuid",
  "booking": {
    "id": "uuid",
    "status": "new | modified | cancelled",
    "ota_reservation_code": "string",
    "booking_unique_id": "string",
    "booking_revision_id": "uuid",
    "booking_id": "uuid",
    "ota_name": "string",
    "ota_code": "string",
    "arrival_date": "YYYY-MM-DD",
    "departure_date": "YYYY-MM-DD",
    "check_in": "YYYY-MM-DD",
    "check_out": "YYYY-MM-DD",
    "count_of_nights": "number",
    "count_of_rooms": "number",
    "amount": "number",
    "currency": "string",
    "ota_commission": "number",
    "payment_collect": "ota | property",
    "payment_type": "bank_transfer | credit_card | string",
    "customer_name": "string",
    "rooms": [
      {
        "id": "uuid",
        "room_type_id": "uuid",
        "guests": [
          {
            "name": "string",
            "surname": "string | null"
          }
        ],
        "taxes": [
          {
            "type": "string",
            "total_price": "number",
            "is_inclusive": "boolean",
            "currency": "string"
          }
        ],
        "checkin_date": "YYYY-MM-DD",
        "checkout_date": "YYYY-MM-DD"
      }
    ],
    "taxes": [
      {
        "type": "string",
        "total_price": "number",
        "is_inclusive": "boolean",
        "currency": "string"
      }
    ],
    "guarantee": {
      "card_type": "string | null",
      "expiration_date": "string | null",
      "cardholder_name": "string | null",
      "last_four_digits": "string | null"
    }
  }
}
```

**Notas de campos:**
- `ota_reservation_code` / `booking_unique_id` — clave de idempotencia: usar como ID del documento en la base de datos para que reintentos del worker no creen duplicados.
- `rooms[0].guests[0]` — lead guest. `surname` puede ser null en Airbnb hasta 48h antes del check-in.
- `taxes[].is_inclusive: false` — se suman a `amount` para el cargo total al huésped.
- `taxes[].is_inclusive: true` — ya incluidas en `amount`, no sumar.
- `ota_commission` — comisión de la OTA. `net_payout = amount - ota_commission`.
- Airbnb: `payment_collect: "ota"`, `payment_type: "bank_transfer"` — Migo UIT está fuera del scope PCI.
- Booking.com: `payment_collect: "property"`, `payment_type: "credit_card"`.

**Referencia:** `channex.types.ts → ChannexWebhookFullPayload` / `booking-revision.transformer.ts → toFirestoreReservation()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/bookings-collection

---

### Schema de Mensaje

```json
{
  "event": "message",
  "property_id": "uuid",
  "revision_id": "uuid",
  "payload": {
    "property_id": "uuid",
    "message_thread_id": "string",
    "message": "string",
    "id": "string",
    "ota_message_id": "string",
    "sender": "guest | host",
    "booking_id": "string | null",
    "timestamp": "string",
    "meta": {
      "name": "string",
      "role": "string"
    }
  }
}
```

**Notas:**
- `message_thread_id` — ID del hilo. Usar como ID del documento del thread en la base de datos.
- `ota_message_id` — clave de idempotencia del mensaje.
- `booking_id: null` — pre-booking inquiry (el huésped aún no reservó).
- `meta.name` — nombre del huésped.

**Referencia:** `channex.types.ts → ChannexInboundMessagePayload` / `workers/channex-message.worker.ts`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/messages-collection

---

### ACK — Confirmación de recepción de booking

Después de procesar y persistir cada evento de booking, se debe confirmar la recepción a Channex. Sin este paso, Channex considera la revisión como no recibida y reintenta el webhook hasta 30 minutos.

```
POST /api/v1/booking_revisions/{revisionId}/ack
```

**Request:** sin body.

**Cuándo llamarlo:** inmediatamente después de persistir la reserva en la base de datos. Si persiste primero, el ACK no bloquea el procesamiento en caso de fallo propio.

**Referencia:** `channex.service.ts → acknowledgeBookingRevision()` / `workers/channex-booking.worker.ts`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/bookings-collection

---

### Enviar respuesta de host (mensajería saliente)

```
POST /api/v1/message_threads/{threadId}/messages
```

**Request:**
```json
{
  "message": {
    "message": "string",
    "sender": "host",
    "property_id": "uuid"
  }
}
```

**Respuesta:**
```json
{
  "data": {
    "id": "uuid",
    "type": "message",
    "attributes": {
      "message": "string",
      "sender": "host",
      "property_id": "uuid",
      "created_at": "string"
    }
  }
}
```

**Referencia:** `channex.service.ts → replyToThread()`

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/messages-collection

---

## 6. Certificación PMS Channex — Test Cases

**Documentación Channex:**
https://docs.channex.io/api-v.1-documentation/pms-certification-tests

La certificación requiere demostrar 11 test cases con task IDs reales de la API de Channex staging.

### Setup de la property de certificación

| Entidad | Nombre |
|---------|--------|
| Property | `Test Property — Migo UIT` |
| Room Type 1 | `Twin Room` (occupancy 2) |
| Room Type 2 | `Double Room` (occupancy 2) |
| Rate Plan Twin 1 | `Best Available Rate` ($100 base) |
| Rate Plan Twin 2 | `Bed and Breakfast` ($120 base) |
| Rate Plan Double 1 | `Best Available Rate` ($100 base) |
| Rate Plan Double 2 | `Bed and Breakfast` ($120 base) |

IDs de la property usada en el formulario enviado:

| Entidad | ID |
|---------|----|
| Property | `e120bb53-798a-42f9-b92a-f910809093ff` |
| Twin Room | `c0c50a32-b6dc-4ab7-b346-7237c8e2a3b3` |
| Twin — Best Available Rate | `8c1b6d62-b761-4b83-a495-bb904b3049fc` |
| Twin — Bed & Breakfast | `f33adf7b-6006-4dfb-9df4-dd9a2de5b70b` |
| Double Room | `3817b2ab-1639-4bfc-bab1-40a02335d5f9` |
| Double — Best Available Rate | `dc8f3779-cee5-43c2-9fe2-ee22b6ab45c6` |
| Double — Bed & Breakfast | `31c510a3-fe73-4325-8c8a-530dbca00a03` |

---

### Test #1 — Full Sync

**Qué verifica:** push masivo de todos los room types y rate plans por 500 días.

**Nuestro endpoint:**
```
POST /channex/properties/{propertyId}/full-sync
```
```json
{
  "defaultAvailability": 1,
  "defaultRate": "100.00",
  "defaultMinStayArrival": 1,
  "defaultMaxStay": 30,
  "defaultStopSell": false,
  "defaultClosedToArrival": false,
  "defaultClosedToDeparture": false,
  "days": 500
}
```

**Channex endpoints que dispara:**
1. `POST /api/v1/availability` — todos los room types, 500 días
2. `POST /api/v1/restrictions` — todos los rate plans, 500 días, 7 campos

**Evidencia:** 2 task IDs (uno por cada call).

---

### Test #2 — Single date, single rate

**Qué verifica:** actualizar la tarifa de un rate plan en una fecha específica.

**Nuestro endpoint:**
```
POST /channex/properties/{propertyId}/push-restrictions
```
```json
{
  "values": [
    {
      "property_id": "uuid",
      "rate_plan_id": "uuid",
      "date_from": "2026-11-22",
      "date_to": "2026-11-22",
      "rate": "333.00"
    }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions`

**Evidencia:** 1 task ID.

---

### Test #3 — Single date, multiple rates

**Qué verifica:** actualizar múltiples rate plans en la misma fecha en una sola llamada.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    { "property_id": "uuid", "rate_plan_id": "twin-bar-uuid", "date_from": "2026-11-21", "date_to": "2026-11-21", "rate": "333.00" },
    { "property_id": "uuid", "rate_plan_id": "double-bar-uuid", "date_from": "2026-11-21", "date_to": "2026-11-21", "rate": "444.00" },
    { "property_id": "uuid", "rate_plan_id": "double-bb-uuid", "date_from": "2026-11-21", "date_to": "2026-11-21", "rate": "456.23" }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call, 3 entries.

**Evidencia:** 1 task ID.

---

### Test #4 — Multiple dates, multiple rates

**Qué verifica:** actualizar múltiples rate plans con rangos de fecha distintos en una sola llamada.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    { "property_id": "uuid", "rate_plan_id": "twin-bar-uuid", "date_from": "2026-11-01", "date_to": "2026-11-10", "rate": "241.00" },
    { "property_id": "uuid", "rate_plan_id": "double-bar-uuid", "date_from": "2026-11-10", "date_to": "2026-11-16", "rate": "312.66" },
    { "property_id": "uuid", "rate_plan_id": "double-bb-uuid", "date_from": "2026-11-01", "date_to": "2026-11-20", "rate": "111.00" }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call, 3 entries.

**Evidencia:** 1 task ID.

---

### Test #5 — Min Stay Update

**Qué verifica:** actualizar `min_stay_arrival` en múltiples combinaciones room/rate.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    { "property_id": "uuid", "rate_plan_id": "twin-bar-uuid", "date_from": "2026-11-23", "date_to": "2026-11-23", "min_stay_arrival": 3 },
    { "property_id": "uuid", "rate_plan_id": "double-bar-uuid", "date_from": "2026-11-25", "date_to": "2026-11-25", "min_stay_arrival": 2 },
    { "property_id": "uuid", "rate_plan_id": "double-bb-uuid", "date_from": "2026-11-15", "date_to": "2026-11-15", "min_stay_arrival": 5 }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call.

**Evidencia:** 1 task ID.

---

### Test #6 — Stop Sell Update

**Qué verifica:** bloquear ventas en fechas específicas.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    { "property_id": "uuid", "rate_plan_id": "twin-bar-uuid", "date_from": "2026-11-14", "date_to": "2026-11-14", "stop_sell": true },
    { "property_id": "uuid", "rate_plan_id": "double-bar-uuid", "date_from": "2026-11-16", "date_to": "2026-11-16", "stop_sell": true },
    { "property_id": "uuid", "rate_plan_id": "double-bb-uuid", "date_from": "2026-11-20", "date_to": "2026-11-20", "stop_sell": true }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call.

**Evidencia:** 1 task ID.

---

### Test #7 — Multiple Restrictions Update

**Qué verifica:** combinación de CTA, CTD, max_stay y min_stay en una sola llamada.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    {
      "property_id": "uuid",
      "rate_plan_id": "twin-bar-uuid",
      "date_from": "2026-11-15",
      "date_to": "2026-11-15",
      "closed_to_arrival": true,
      "closed_to_departure": true,
      "max_stay": 7,
      "min_stay_arrival": 2
    }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call, 4 campos de restricción combinados.

**Evidencia:** 1 task ID.

---

### Test #8 — Half-year Update

**Qué verifica:** actualizar un rango de 6 meses en una sola llamada.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-restrictions`

**Payload de ejemplo:**
```json
{
  "values": [
    {
      "property_id": "uuid",
      "rate_plan_id": "twin-bar-uuid",
      "date_from": "2026-12-01",
      "date_to": "2027-05-01",
      "rate": "250.00",
      "closed_to_arrival": true,
      "closed_to_departure": true,
      "min_stay_arrival": 5
    }
  ]
}
```

**Channex endpoint:** `POST /api/v1/restrictions` — 1 call.

**Evidencia:** 1 task ID.

---

### Test #9 — Single Date Availability Update

**Qué verifica:** actualizar la disponibilidad de room types en fechas individuales.

**Nuestro endpoint:**
```
POST /channex/properties/{propertyId}/push-availability
```
```json
{
  "values": [
    { "property_id": "uuid", "room_type_id": "twin-uuid", "date_from": "2026-11-21", "date_to": "2026-11-21", "availability": 7 },
    { "property_id": "uuid", "room_type_id": "double-uuid", "date_from": "2026-11-25", "date_to": "2026-11-25", "availability": 0 }
  ]
}
```

**Channex endpoint:** `POST /api/v1/availability` — 1 call, 2 entries.

**Nota:** Channex puede retornar un warning `"value greater than max availability (1)"` porque la property tiene `count_of_rooms: 1`. El warning es esperado, no es un error.

**Evidencia:** 1 task ID.

---

### Test #10 — Multiple Date Availability Update

**Qué verifica:** actualizar disponibilidad por rangos de fecha.

**Nuestro endpoint:** `POST /channex/properties/{propertyId}/push-availability`

**Payload de ejemplo:**
```json
{
  "values": [
    { "property_id": "uuid", "room_type_id": "twin-uuid", "date_from": "2026-11-10", "date_to": "2026-11-16", "availability": 3 },
    { "property_id": "uuid", "room_type_id": "double-uuid", "date_from": "2026-11-17", "date_to": "2026-11-24", "availability": 4 }
  ]
}
```

**Channex endpoint:** `POST /api/v1/availability` — 1 call.

**Evidencia:** 1 task ID.

---

### Test #11 — Booking Receiving (webhook)

**Qué verifica:** que el sistema recibe, procesa y confirma (ACK) los 3 eventos de booking.

El evaluador de Channex hace el push manual desde el panel durante la reunión de certificación.

**Flujo de procesamiento en nuestro sistema:**

```
Channex → POST /webhook (o /channex/webhook)
  → Verificar HMAC (header x-channex-signature)
  → Retornar 200 OK inmediatamente
  → Worker procesa el evento:
      1. Resolver property_id → tenant
      2. Transformar payload → documento de reserva
      3. Persistir en base de datos (upsert idempotente por ota_reservation_code)
      4. POST /api/v1/booking_revisions/{revisionId}/ack
```

**Evidencia:** Channex provee durante la reunión:
- Booking ID
- Revision ID para `booking_new`
- Revision ID para `booking_modification`
- Revision ID para `booking_cancellation`

**Restricciones soportadas declaradas:**

| Restricción | Soportada |
|-------------|-----------|
| Availability | ✅ |
| Rate | ✅ |
| Min Stay Arrival | ✅ |
| Max Stay | ✅ |
| Closed To Arrival (CTA) | ✅ |
| Closed To Departure (CTD) | ✅ |
| Stop Sell | ✅ |
| Min Stay Through | ❌ Airbnb lo ignora |

**Rate limits declarados:**
- Rate limiter implementado: sliding window 10 req/min por property por tipo de endpoint.
- Push solo por cambios delta (acción del usuario). Sin timer de full-sync automático.
- Full Sync: solo en go-live inicial o bajo demanda explícita del operador.

**Referencia UI:** `certification-tests.md`

---

## 7. Componentes de UI

Esta sección describe los componentes de frontend que implementan cada parte del flujo. Aplica tanto al flujo base (sin channel) como al flujo de integración con Airbnb / Booking.com.

---

### 7.1 Flujo base — sin channel OTA

Para crear properties, rooms y rates directamente (sin OAuth de OTA).

#### PropertySetupWizard

**Archivo:** `apps/frontend/src/channex/components/PropertySetupWizard.tsx`

Wizard de 4 pasos para crear una property completa desde cero.

| Paso | Qué hace | Campos |
|------|----------|--------|
| **1 — Property** | Crea la property en Channex | Title, Currency, Timezone |
| **2 — Room Types** | Agrega room types a la property | Title, Default Occupancy (por room) |
| **3 — Rate Plans** | Agrega rate plans a cada room | Title, Rate (número), Occupancy (por room) |
| **4 — Review** | Muestra el resumen de todo lo creado | Channex Property ID, Room Type IDs, Rate Plan IDs |

El formulario tiene valores pre-llenados para certificación (`"Test Property - Migo UIT"`, Twin Room, Double Room). Para producción, reemplazar con campos vacíos.

**Backend endpoint:** `POST /api/channex/properties` → `POST /api/channex/properties/:id/room-types` → `POST /api/channex/properties/:id/rate-plans`

---

#### RoomRateManager

**Archivo:** `apps/frontend/src/channex/components/RoomRateManager.tsx`

Panel de gestión post-creación de rooms y rates de una property. Se muestra dentro del tab **Rooms** de `PropertyDetail`.

- Lista todos los room types de la property (GET /room-types)
- Por cada room type: muestra title, count_of_rooms, occupancy breakdown (adults / children / infants)
- Botón **Add Room Type**: formulario inline con title y occupancy
- Por cada room type: lista sus rate plans con title e ID
- Botón **Add Rate Plan**: formulario inline con title, rate (número), occupancy

**Backend endpoints:** `GET /api/channex/properties/:id/room-types` / `POST /api/channex/properties/:id/room-types` / `POST /api/channex/properties/:id/rate-plans`

---

#### PropertyDetail

**Archivo:** `apps/frontend/src/channex/components/PropertyDetail.tsx`

Vista principal de una property seleccionada. Contiene:

- **Header:** título, channex_property_id, currency · timezone, badge de `connection_status` (active / pending / error)
- **Botón Sync (↻):** llama a `checkConnectionHealth()` y muestra un panel de health con checks:
  - Property exists in Channex
  - Rooms configured (N rooms)
  - Tenant group match
  - Webhook subscribed (y si fue re-registrado)
  - Messages App installed
- **Tabs internos:**
  - `rooms` → RoomRateManager
  - `ari` → ARICalendarFull
  - `reservations` → ReservationsPanel

**Backend endpoint (health):** `POST /api/channex/properties/:id/check-connection-health`

---

### 7.2 Flujo con channel OTA (Airbnb / Booking.com)

#### Estado unprovisioned — PropertyProvisioningForm (Airbnb)

**Archivo:** `apps/frontend/src/airbnb/components/PropertyProvisioningForm.tsx`

Primer paso del onboarding de Airbnb. Crea la property shell en Channex antes de abrir el OAuth.

**Campos:**
| Campo | Valores |
|-------|---------|
| Title | texto libre |
| Currency | USD / EUR / PEN |
| Timezone | America/Lima / America/New_York / Europe/Madrid |
| Property Type | apartment / hotel |

Al enviar:
1. Llama `POST /api/channex/airbnb/provision_property`
2. Muestra el `channexPropertyId` en un chip verde con botón Copy
3. Avanza automáticamente (900ms) al estado `connecting`

---

#### Estado connecting — ChannexIFrame

**Archivo:** `apps/frontend/src/airbnb/components/ChannexIFrame.tsx`

Embebe el panel de OAuth de Channex en un IFrame para que el usuario conecte su cuenta Airbnb sin salir de Migo UIT.

**Flujo:**
1. Al montar: `GET /api/channex/properties/:id/one-time-token` → obtiene token de 15 min
2. Construye la URL del IFrame:
   ```
   {CHANNEX_BASE}/auth/exchange
     ?oauth_session_key={token}
     &app_mode=headless        ← oculta navegación global de Channex
     &redirect_to=/channels
     &property_id={channexPropertyId}
     &channels=ABB             ← restringe a Airbnb
   ```
3. Muestra spinner mientras el IFrame carga (`FETCHING` → `RENDERING`)
4. `onLoad` del IFrame → estado `CONNECTED` → dispara `onConnected()`

**Fallback CSP** (si el browser bloquea el IFrame):
- Banner visible durante `RENDERING` con botón "Open in new tab"
- Si `onError` del IFrame dispara: fetcha `GET /api/channex/properties/:id/channels/:channel/connect_url` y renderiza enlace directo
- Botón "Try again" → re-monta el IFrame y solicita nuevo token

---

#### AirbnbIntegration — Máquina de estados

**Archivo:** `apps/frontend/src/integrations/airbnb/AirbnbIntegration.tsx`

Orquestador del flujo completo de Airbnb. Gestiona el estado de la integración escuchando Firestore en tiempo real (`channex_integrations/{tenantId}`).

```
loading
  ↓ (Firestore hydrated)
unprovisioned           → PropertyProvisioningForm
  ↓ (onProvisioned)
connecting              → ChannexIFrame (popup OAuth)
  ↓ (onConnected)
connected               → Sidebar + 4 tabs (inbox / inventory / reservations / settings)
  ↓ (error)
error                   → Panel de error con botón Retry
```

La sidebar (`AirbnbSidebar`) muestra la lista de properties/listings sincronizados (desde subcolección `channex_integrations/{tenantId}/properties`). Cuando hay más de un listing, el usuario puede seleccionar cuál ver.

---

#### MappingReviewModal — Stage 2 del onboarding Airbnb

**Archivo:** `apps/frontend/src/airbnb/components/MappingReviewModal.tsx`

Se muestra después del OAuth para revisar y confirmar el mapping de listings Airbnb ↔ Rate Plans de Channex.

- Tabla con una fila por listing: título del listing, precio, moneda, dropdown para seleccionar el Rate Plan
- Los Rate Plans se pre-seleccionan automáticamente (auto-match)
- **Botón "Map"** (por fila): confirma ese mapping individual → `POST /api/channex/properties/:id/commit_mapping`
- **Botón "Auto-Map All"**: confirma todas las filas pendientes de una vez
- Cuando todas las filas están mapeadas aparece el CTA "Complete Setup"

---

### 7.3 Certificación — UI de los Test Cases

#### Full Sync Modal (Test #1)

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

Botón **"Full Sync"** en el header del ARI Calendar abre un modal con los 7 campos de configuración más el número de días.

**Campos del modal:**

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| Availability | number | `1` | Disponibilidad para todos los room types |
| Rate | string (decimal) | `"100"` | Tarifa base para todos los rate plans |
| Min Stay Arrival | number | `1` | Mínimo de noches en fecha de llegada |
| Max Stay | number | `30` | Máximo de noches |
| Stop Sell | boolean (toggle) | `false` | Cerrar ventas |
| Closed To Arrival | boolean (toggle) | `false` | Bloquear check-in |
| Closed To Departure | boolean (toggle) | `false` | Bloquear check-out |
| Days | number | `500` | Rango de días a partir de hoy |

Al confirmar → `POST /api/channex/properties/:id/full-sync`

El modal muestra los task IDs retornados (uno por avail + uno por restrictions) — estos son la evidencia para el formulario de certificación.

---

#### ARI Calendar — Editor de rangos por fecha (Tests #2–#10)

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

El calendario permite seleccionar rangos de fechas con click-click (primer click = inicio, segundo click = fin) y abrir un panel lateral de edición.

**Flujo de uso:**
1. Click en fecha 1 → preview de la fecha (popup)
2. Click en fecha 2 → abre el panel de edición con el rango seleccionado
3. En el panel: seleccionar Room Type, Rate Plan, y los campos a actualizar
4. **Add to Batch**: agrega la entrada a la cola de batch (permite acumular múltiples entries)
5. **Save Batch**: envía todo en una sola llamada a Channex
   - Availability entries → `POST /api/channex/properties/:id/push-availability`
   - Restriction entries → `POST /api/channex/properties/:id/push-restrictions`

**Campos del panel de edición:**

| Campo | Tipo | Test case que lo usa |
|-------|------|---------------------|
| Room Type | select | todos |
| Rate Plan | select | #2–#8 (restrictions) |
| Availability | number | #9, #10 |
| Rate | decimal | #2, #3, #4, #8 |
| Min Stay | number | #5, #7, #8 |
| Max Stay | number | #7, #8 |
| Stop Sell | toggle | #6 |
| Closed To Arrival | toggle | #7, #8 |
| Closed To Departure | toggle | #7, #8 |

El calendario también muestra los **últimos task IDs** después de cada Save Batch — visible en la UI directamente bajo el calendario como evidencia de certificación.

**Refresh Calendar** → `GET /api/channex/properties/:id/ari-snapshot` — recarga el estado actual de ARI desde Channex para mostrarlo en las celdas del calendario (rate, availability, restricciones activas por día).
