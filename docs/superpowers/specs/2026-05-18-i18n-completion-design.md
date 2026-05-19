# Design Spec: i18n Completion — Full Frontend Migration

**Date:** 2026-05-18  
**Branch:** main  
**Status:** Approved  
**Predecessor spec:** `2026-05-13-i18n-language-system-design.md`

---

## 1. Scope

The original i18n spec (2026-05-13) built the foundation: `LanguageContext`, `useLanguage()`, `es.ts`/`en.ts`, and migrated ~17 components. This spec covers the **remaining ~35 components** with hardcoded text, plus a required extension to `t()` for interpolation and plural patterns.

**In scope:**
- Extend `t()` to support variable interpolation and plural key patterns
- Migrate all remaining components to use `t()` — zero hardcoded user-visible strings
- Add all missing translation keys to `es.ts` and `en.ts`

**Out of scope:**
- No functionality changes of any kind
- No routing, state, API, or logic changes
- No backend strings
- No migration of: CSS class names, API field names, Firestore collection names, enum values, proper nouns identical in both languages (WhatsApp, Instagram, Booking.com, Channex, Airbnb)
- No new dependencies

---

## 2. Architecture Changes

### 2.1 Extend `t()` with interpolation

**File:** `apps/frontend/src/context/LanguageContext.tsx`

Current signature:
```ts
t: (key: TranslationKey) => string
```

New signature:
```ts
t: (key: TranslationKey, vars?: Record<string, string | number>) => string
```

Implementation:
```ts
const t = (key: TranslationKey, vars?: Record<string, string | number>): string => {
  let str = locales[lang][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars))
      str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
};
```

### 2.2 Plural pattern — double key, no library

Plurals use two explicit keys. The component decides which to use:

```ts
// es.ts
'channex.pools.conn.one':  '1 conexión',
'channex.pools.conn.many': '{n} conexiones',

// Component usage
t(count === 1 ? 'channex.pools.conn.one' : 'channex.pools.conn.many', { n: count })
```

### 2.3 No changes to `TranslationKey` type strategy

`es.ts` remains the source of truth. `en.ts` is typed as `Record<TranslationKey, string>`. Every new key added to `es.ts` must also be added to `en.ts` or TypeScript will error.

---

## 3. Key Namespace Map

All new keys follow the existing dot-notation convention. Namespaces below are new additions; existing keys in `es.ts` are unchanged.

| Namespace prefix | Component(s) |
|---|---|
| `channex.hub.*` | `ChannexHub.tsx` (3 missing strings) |
| `channex.props.*` | `PropertiesList.tsx`, `PropertyCard.tsx` |
| `channex.detail.*` | `PropertyDetail.tsx` |
| `channex.wizard.*` | `PropertySetupWizard.tsx` |
| `channex.rooms.*` | `RoomRateManager.tsx` |
| `channex.ari.*` | `ARICalendar.tsx` |
| `channex.glossary.*` | `ARIGlossaryButton.tsx` |
| `channex.pools.*` | `PoolsList.tsx`, `PoolDetail.tsx` |
| `channex.poolCreate.*` | `PoolCreateForm.tsx` |
| `channex.poolEdit.*` | `PoolEditModal.tsx` |
| `channex.poolSync.*` | `PoolSyncModal.tsx` |
| `channex.poolAri.*` | `PoolAriPanel.tsx` |
| `channex.assign.*` | `AssignConnectionModal.tsx` |
| `channex.guide.*` | `NoPropertyGuide.tsx` |
| `channex.chanMgmt.*` | `ChannelManagementPanel.tsx` |
| `channex.bdcModal.*` | `BdcChannelSelectModal.tsx` |
| `channex.syncNaming.*` | `SyncNamingModal.tsx` |
| `channex.airbnbConn.*` | `AirbnbConnectionPanel.tsx` |
| `channex.bdcConn.*` | `BookingConnectionPanel.tsx` |
| `channex.reserv.*` | `ReservationsPanel.tsx` |
| `channex.reservDetail.*` | `ReservationDetailModal.tsx` |
| `channex.noShow.*` | `NoShowConfirmModal.tsx` |
| `channex.messages.*` | `MessagesInbox.tsx` |
| `inventory.*` | `InventoryPage.tsx` |
| `inventory.autoReply.*` | `AutoReplyManager.tsx` |
| `inventory.catalog.*` | `CatalogManager.tsx` |
| `inventory.product.*` | `ProductManager.tsx` |
| `inventory.variant.*` | `VariantManager.tsx` |
| `catalog.*` | `CatalogView/index.tsx` (legacy) |
| `cart.*` | `CartViewer.tsx` |
| `instagram.*` | `InstagramConnect/index.tsx` |
| `messenger.*` | `MessengerConnect/index.tsx` |

---

## 4. Complete Key Definitions

### 4.1 Channex — Hub, Properties, PropertyCard, PropertyDetail

```ts
// ChannexHub — 3 missing strings
'channex.hub.loadingProps':          'Cargando propiedades…',
'channex.hub.loadingPools':          'Cargando pools…',
'channex.hub.backToProps':           '← Volver a propiedades',

// PropertiesList
'channex.props.title':               'Propiedades',
'channex.props.desc':                'Gestiona propiedades Channex, tipos de habitación, planes tarifarios y ARI.',
'channex.props.new':                 '+ Nueva Propiedad',
'channex.props.empty.title':         'Sin propiedades aún',
'channex.props.empty.desc':          'Crea una propiedad para comenzar a gestionar ARI y conectar canales OTA.',
'channex.props.empty.action':        'Crear primera propiedad',
'channex.props.roomType.one':        '1 tipo de habitación',
'channex.props.roomType.many':       '{n} tipos de habitación',

// PropertyDetail — tabs
'channex.detail.tab.rooms':          'Habitaciones y Tarifas',
'channex.detail.tab.ari':            'Calendario ARI',
'channex.detail.tab.reservations':   'Reservaciones',
'channex.detail.tab.messages':       'Mensajes',
// PropertyDetail — health checks
'channex.detail.existsInChannex':    'Propiedad existe en Channex',
'channex.detail.roomsConfigured':    'Habitaciones configuradas',
'channex.detail.tenantMatch':        'Coincidencia de grupo',
'channex.detail.webhookSubscribed':  'Webhook suscrito',
'channex.detail.messagesInstalled':  'App de mensajes instalada',
'channex.detail.sync':               'Sincronizar',
'channex.detail.syncing':            'Sincronizando…',
'channex.detail.room.one':           '1 habitación',
'channex.detail.room.many':          '{n} habitaciones',
```

### 4.2 Channex — PropertySetupWizard

```ts
'channex.wizard.step.details':       'Detalles de propiedad',
'channex.wizard.step.rooms':         'Tipos de habitación',
'channex.wizard.step.rates':         'Planes tarifarios',
'channex.wizard.step.confirm':       'Confirmar',
'channex.wizard.name':               'Nombre',
'channex.wizard.currency':           'Moneda',
'channex.wizard.timezone':           'Zona horaria',
'channex.wizard.occupancy':          'Ocupación',
'channex.wizard.addRoom':            '+ Agregar tipo de habitación',
'channex.wizard.baseRate':           'Tarifa base',
'channex.wizard.complete':           'Configuración completa',
'channex.wizard.create':             'Crear Propiedad →',
'channex.wizard.creating':           'Creando…',
'channex.wizard.createRooms':        'Crear Tipos de Habitación →',
'channex.wizard.createRates':        'Crear Planes Tarifarios →',
'channex.wizard.goTo':               'Ir a la propiedad →',
'channex.wizard.back':               '← Atrás',
'channex.wizard.cancel':             'Cancelar',
'channex.wizard.err.property':       'Error al crear la propiedad.',
'channex.wizard.err.rooms':          'Error al crear tipos de habitación.',
'channex.wizard.err.rates':          'Error al crear planes tarifarios.',
```

### 4.3 Channex — RoomRateManager

```ts
'channex.rooms.loading':             'Cargando tipos de habitación…',
'channex.rooms.editRoom':            'Editar tipo de habitación',
'channex.rooms.saving':              'Guardando…',
'channex.rooms.save':                'Guardar cambios',
'channex.rooms.cancel':              '✕ Cancelar',
'channex.rooms.unit.one':            '1 unidad',
'channex.rooms.unit.many':           '{n} unidades',
'channex.rooms.adults':              'Adultos:',
'channex.rooms.children':            'Niños:',
'channex.rooms.babies':              'Bebés:',
'channex.rooms.ratePlans':           'Planes tarifarios ({n})',
'channex.rooms.noRatePlans':         'Sin planes tarifarios aún.',
'channex.rooms.primary':             'Principal',
'channex.rooms.rateName':            'Nombre del plan tarifario',
'channex.rooms.baseRate':            'Tarifa base',
'channex.rooms.add':                 'Agregar',
'channex.rooms.newRoom':             'Nuevo tipo de habitación',
'channex.rooms.createRoom':          'Crear Tipo de Habitación',
'channex.rooms.addRoom':             '+ Agregar tipo de habitación',
```

### 4.4 Channex — ARICalendar

```ts
'channex.ari.title':                 'Calendario ARI',
'channex.ari.desc':                  'Haz click en una fecha para previsualizar, haz click en una segunda fecha para abrir el panel de actualización.',
'channex.ari.refreshing':            'Actualizando…',
'channex.ari.refresh':               '↻ Actualizar Calendario',
'channex.ari.fullSync':              'Sincronización completa ({n} días)',
'channex.ari.taskIds':               'IDs de tarea',
'channex.ari.noData':                'Sin datos — usa ↻ Actualizar Calendario para cargar desde Channex.',
'channex.ari.selectPh':              '— seleccionar —',
'channex.ari.avail.label':           'Disponibilidad (unidades) — dejar en blanco para omitir',
'channex.ari.avail.ph':              'ej. 7',
'channex.ari.rate.label':            'Tarifa ({currency}) — dejar en blanco para omitir',
'channex.ari.rate.ph':               'ej. 333',
'channex.ari.minStay.label':         'Estadía mínima (noches) — dejar en blanco para omitir',
'channex.ari.minStay.ph':            'ej. 3',
'channex.ari.maxStay.label':         'Estadía máxima (noches) — dejar en blanco para omitir',
'channex.ari.maxStay.ph':            'ej. 14',
'channex.ari.restrictions':          'Restricciones',
'channex.ari.stopSell':              'Bloquear venta',
'channex.ari.openSell':              'Abrir venta (quitar bloqueo)',
'channex.ari.cta':                   'Cerrado a llegadas',
'channex.ari.ctd':                   'Cerrado a salidas',
'channex.ari.batchQueue':            'Cola de actualización ({n} cambios)',
'channex.ari.addToBatch':            '+ Agregar al lote',
'channex.ari.save':                  'Guardar ({n})',
'channex.ari.updatePanel':           'Actualizar ARI',
'channex.ari.range':                 'Rango: {from} → {to}',
'channex.ari.prev':                  'Ant',
'channex.ari.next':                  'Sig',
'channex.ari.noDataCell':            'sin datos',
'channex.ari.clickSecond':           'Haz click en otra fecha para definir un rango.',
// Nueva reserva modal
'channex.ari.registerReserv':        'Registrar Reserva',
'channex.ari.addReserv':             '+ Nueva Reserva',
'channex.ari.newReserv':             'Nueva Reserva',
'channex.ari.dates':                 'Fechas: {from} → {to}',
'channex.ari.type':                  'Tipo',
'channex.ari.type.walkin':           'Walk-in',
'channex.ari.type.maintenance':      'Mantenimiento',
'channex.ari.type.owner':            'Uso propietario',
'channex.ari.type.direct':           'Directa',
'channex.ari.room':                  'Habitación',
'channex.ari.ratePlan':              'Plan tarifario',
'channex.ari.noRatePlan':            '— sin plan —',
'channex.ari.customPrice':           '(precio personalizado)',
'channex.ari.quantity':              'Cantidad de unidades',
'channex.ari.pricePerUnit':          'Precio por unidad ({currency})',
'channex.ari.total':                 'Total',
'channex.ari.guestName':             'Nombre del huésped (opcional)',
'channex.ari.guestNamePh':           'Ej. Juan Pérez',
'channex.ari.phone':                 'Teléfono (opcional)',
'channex.ari.phonePh':               '+52 55 0000 0000',
'channex.ari.notes':                 'Notas (opcional)',
'channex.ari.notesPh':               'Observaciones adicionales…',
'channex.ari.reservSuccess':         '✓ Reserva registrada correctamente',
'channex.ari.saving':                'Guardando…',
'channex.ari.confirmReserv':         'Confirmar Reserva',
// Full sync modal
'channex.ari.fullSyncTitle':         'Sincronización Completa',
'channex.ari.fullSyncDesc':          'Envía {n} días de ARI a Channex...',
'channex.ari.fieldRefBtn':           'Referencia de campos',
'channex.ari.fieldRef':              'Referencia de campos',
'channex.ari.daysForward':           'Días hacia adelante',
'channex.ari.close':                 'Cerrar',
'channex.ari.cancel':                'Cancelar',
'channex.ari.runSync':               'Ejecutar Sincronización Completa',
'channex.ari.syncing':               'Sincronizando…',
```

### 4.5 Channex — ARIGlossaryButton

```ts
'channex.glossary.btn':              'Guía de términos ARI',
'channex.glossary.title':            'Guía de términos ARI',
'channex.glossary.col.term':         'Término',
'channex.glossary.col.full':         'Nombre completo',
'channex.glossary.col.desc':         'Descripción',
'channex.glossary.ari.term':         'ARI',
'channex.glossary.ari.full':         'Availability, Rates & Inventory',
'channex.glossary.ari.desc':         'Conjunto de datos de disponibilidad, tarifas y restricciones que se sincroniza con las OTAs.',
'channex.glossary.ss.term':          'SS',
'channex.glossary.ss.full':          'Stop Sell',
'channex.glossary.ss.desc':          'Bloquea toda venta en esa fecha sin importar la disponibilidad real.',
'channex.glossary.cta.term':         'CTA',
'channex.glossary.cta.full':         'Closed to Arrival',
'channex.glossary.cta.desc':         'No se aceptan nuevas llegadas en esa fecha.',
'channex.glossary.ctd.term':         'CTD',
'channex.glossary.ctd.full':         'Closed to Departure',
'channex.glossary.ctd.desc':         'No se aceptan salidas en esa fecha.',
'channex.glossary.minStay.term':     'Min Stay',
'channex.glossary.minStay.full':     'Minimum Stay on Arrival',
'channex.glossary.minStay.desc':     'Noches mínimas requeridas si el huésped llega ese día.',
'channex.glossary.maxStay.term':     'Max Stay',
'channex.glossary.maxStay.full':     'Maximum Stay',
'channex.glossary.maxStay.desc':     'Noches máximas de estancia permitidas.',
```

### 4.6 Channex — Pools

```ts
// PoolsList
'channex.pools.title':               'Pools de Propiedad',
'channex.pools.desc':                'Agrupa listados OTA en pools de disponibilidad compartida.',
'channex.pools.new':                 '+ Nuevo Pool',
'channex.pools.empty.title':         'Sin pools aún',
'channex.pools.empty.desc':          'Crea un pool para rastrear disponibilidad en múltiples listados OTA.',
'channex.pools.empty.action':        'Crear primer pool',
'channex.pools.conn.one':            '1 conexión',
'channex.pools.conn.many':           '{n} conexiones',
'channex.pools.noPlatforms':         'Sin plataformas',
'channex.pools.editPool':            'Editar pool',
'channex.pools.edit':                'Editar',

// PoolDetail
'channex.pools.back':                '← Volver a pools',
'channex.pools.available':           'disponible',
'channex.pools.alertHint':           'alerta ≤ {n}',
'channex.pools.adjustCapacity':      'Ajustar capacidad',
'channex.pools.adjusting':           'Ajustando…',
'channex.pools.resetFull':           'Restablecer al máximo',
'channex.pools.resetting':           'Restableciendo…',
'channex.pools.platformConns':       'Conexiones de Plataforma',
'channex.pools.addConn':             '+ Agregar',
'channex.pools.noConns':             'Sin conexiones aún. Agrega una conexión de plataforma arriba.',
'channex.pools.syncEnabled':         'Sincronizar',
'channex.pools.remove':              'Eliminar',

// PoolCreateForm
'channex.poolCreate.title':          'Nuevo Pool de Propiedad',
'channex.poolCreate.name':           'Nombre del pool',
'channex.poolCreate.namePh':         'ej. Estudio Completo',
'channex.poolCreate.alertThreshold': 'Umbral de alerta',
'channex.poolCreate.alertHelp':      'Mostrar alerta cuando la disponibilidad caiga a este número o menos. Predeterminado: 0.',
'channex.poolCreate.capacityNote':   'La capacidad del pool se calcula automáticamente al agregar conexiones de plataforma.',
'channex.poolCreate.create':         'Crear Pool',
'channex.poolCreate.creating':       'Creando…',
'channex.poolCreate.cancel':         'Cancelar',
'channex.poolCreate.err.name':       'El nombre del pool es requerido.',

// PoolEditModal
'channex.poolEdit.title':            'Editar Pool',
'channex.poolEdit.name':             'Nombre del pool',
'channex.poolEdit.alertThreshold':   'Umbral de alerta',
'channex.poolEdit.capacity':         'Unidades totales (capacidad)',
'channex.poolEdit.capacityNote':     'Editar esto anula la capacidad calculada automáticamente de las conexiones.',
'channex.poolEdit.err.units':        'Las unidades totales deben ser 0 o más.',
'channex.poolEdit.err.threshold':    'El umbral de alerta debe ser 0 o más.',
'channex.poolEdit.err.name':         'El nombre del pool es requerido.',
'channex.poolEdit.save':             'Guardar cambios',
'channex.poolEdit.saving':           'Guardando…',
'channex.poolEdit.cancel':           'Cancelar',

// PoolSyncModal
'channex.poolSync.title':            'Discrepancia de capacidad en pool',
'channex.poolSync.desc':             'Tus propiedades conectadas suman {sum} unidades, pero el pool está configurado en {pool}.',
'channex.poolSync.current':          'Actual',
'channex.poolSync.after':            'Después del ajuste',
'channex.poolSync.unit.one':         '1 unidad',
'channex.poolSync.unit.many':        '{n} unidades',
'channex.poolSync.adjust':           'Ajustar a {n} unidades',
'channex.poolSync.adjusting':        'Ajustando…',
'channex.poolSync.dismiss':          'Descartar',
'channex.poolSync.dontShow':         'No mostrar esta sugerencia nuevamente',
'channex.poolSync.err':              'Error al ajustar',

// PoolAriPanel
'channex.poolAri.title':             'Fan-out de ARI',
'channex.poolAri.desc':              'Envía actualizaciones ARI a las {n} plataformas habilitadas simultáneamente.',
'channex.poolAri.dateFrom':          'Fecha desde',
'channex.poolAri.dateTo':            'Fecha hasta',
'channex.poolAri.stopSell':          'Bloquear venta',
'channex.poolAri.stopSellDesc':      'Cierra todas las reservas para este período',
'channex.poolAri.availOverride':     'Disponibilidad (opcional)',
'channex.poolAri.availPh':           'Dejar en blanco para omitir',
'channex.poolAri.push':              'Enviar a todas las plataformas',
'channex.poolAri.pushing':           'Enviando…',
'channex.poolAri.succeeded':         '✓ Exitoso ({n})',
'channex.poolAri.failed':            '✗ Fallido ({n})',
'channex.poolAri.err.dateRequired':  'El rango de fechas es requerido.',
'channex.poolAri.err.pushFailed':    'Error al enviar',

// AssignConnectionModal
'channex.assign.title':              'Asignar Conexión de Plataforma',
'channex.assign.loadingProps':       'Cargando propiedades…',
'channex.assign.allConnected':       'Todas las propiedades Channex registradas ya están conectadas.',
'channex.assign.property':           'Propiedad Channex',
'channex.assign.selectProp':         'Selecciona una propiedad…',
'channex.assign.noRooms':            'Sin habitaciones configuradas. Ve a Propiedades → Habitaciones y Tarifas...',
'channex.assign.willAdd.one':        'Esta conexión agregará 1 habitación a la capacidad del pool.',
'channex.assign.willAdd.many':       'Esta conexión agregará {n} habitaciones a la capacidad del pool.',
'channex.assign.platform':           'Plataforma',
'channex.assign.listingTitle':       'Título del listado OTA',
'channex.assign.listingPh':          'ej. Estudio Vista Grande',
'channex.assign.syncEnabled':        'Sincronización habilitada (incluir en fan-out ARI)',
'channex.assign.assigning':          'Asignando…',
'channex.assign.assign':             'Asignar',
'channex.assign.cancel':             'Cancelar',
'channex.assign.err.required':       'Selecciona una propiedad e ingresa un título para el listado.',
```

### 4.7 Channex — Connection panels

```ts
// NoPropertyGuide
'channex.guide.preamble':            'Todavía no tienes una propiedad en Channex...',
'channex.guide.step1.title':         'Crea tu primera propiedad',
'channex.guide.step1.desc':          'Ve a la pestaña Propiedades y completa el asistente...',
'channex.guide.step1.btn':           '→ Ir a Propiedades',
'channex.guide.step2.title':         'Conecta tu cuenta de {channel}',
'channex.guide.step2.desc':          'Regresa a esta pestaña y autoriza el acceso...',
'channex.guide.step3.title':         'Sincroniza tus propiedades',
'channex.guide.step3.desc':          'Una vez conectado, usa el botón "{label}" para importar...',

// ChannelManagementPanel
'channex.chanMgmt.title':            'Conexiones de Canales',
'channex.chanMgmt.loading':          'Cargando…',
'channex.chanMgmt.count.one':        '1 canal registrado',
'channex.chanMgmt.count.many':       '{n} canales registrados',
'channex.chanMgmt.loadingChannels':  'Cargando canales…',
'channex.chanMgmt.empty':            'Sin canales registrados aún. Conecta una cuenta OTA usando el panel IFrame.',
'channex.chanMgmt.active':           'Activo',
'channex.chanMgmt.inactive':         'Inactivo',
'channex.chanMgmt.deactivating':     'Desactivando…',
'channex.chanMgmt.activating':       'Activando…',
'channex.chanMgmt.deactivate':       'Desactivar',
'channex.chanMgmt.activate':         'Activar',
'channex.chanMgmt.err.title':        'Error en la acción',
'channex.chanMgmt.err.body':         'No se pudo actualizar el estado del canal. Contacta a tu administrador.',
'channex.chanMgmt.close':            'Cerrar',

// BdcChannelSelectModal
'channex.bdcModal.titleAirbnb':      'Seleccionar Canal de Airbnb',
'channex.bdcModal.titleBdc':         'Seleccionar Canal de Booking.com',
'channex.bdcModal.loading':          'Cargando canales…',
'channex.bdcModal.err':              'Error al cargar canales.',
'channex.bdcModal.retry':            'Reintentar',
'channex.bdcModal.empty':            'Sin canales encontrados. Conecta un canal vía IFrame primero.',
'channex.bdcModal.next':             'Siguiente',
'channex.bdcModal.cancel':           'Cancelar',

// SyncNamingModal
'channex.syncNaming.title':          'Confirmar Nombres',
'channex.syncNaming.desc':           'Revisa y edita los nombres de propiedad, habitación y tarifa antes de sincronizar.',
'channex.syncNaming.property':       'Propiedad',
'channex.syncNaming.room':           'Habitación',
'channex.syncNaming.rate':           'Tarifa',
'channex.syncNaming.sync':           'Sincronizar',
'channex.syncNaming.cancel':         'Cancelar',

// AirbnbConnectionPanel
'channex.airbnbConn.title':          'Conexión Airbnb',
'channex.airbnbConn.prop.one':       '1 propiedad conectada',
'channex.airbnbConn.prop.many':      '{n} propiedades conectadas',
'channex.airbnbConn.desc':           'Conecta tu cuenta de Airbnb y sincroniza listados a Channex.',
'channex.airbnbConn.loadingProps':   'Cargando propiedades…',
'channex.airbnbConn.previewErr':     'Error de previsualización: {error}',
'channex.airbnbConn.err':            'Error: {error}',
'channex.airbnbConn.synced.one':     '1 propiedad sincronizada',
'channex.airbnbConn.synced.many':    '{n} propiedades sincronizadas',
'channex.airbnbConn.failed':         'fallidas',
'channex.airbnbConn.reconnect':      'Reconectar Airbnb',
'channex.airbnbConn.sync':           'Sincronizar Listados',
'channex.airbnbConn.syncing':        'Sincronizando listados…',
'channex.airbnbConn.loadingPreview': 'Cargando previsualización…',
'channex.airbnbConn.messages':       'Mensajes',
'channex.airbnbConn.connectedProps': 'Propiedades Airbnb Conectadas',
'channex.airbnbConn.back':           '← Volver a Airbnb',

// BookingConnectionPanel
'channex.bdcConn.title':             'Conexión Booking.com',
'channex.bdcConn.prop.one':          '1 propiedad conectada',
'channex.bdcConn.prop.many':         '{n} propiedades conectadas',
'channex.bdcConn.desc':              'Conecta tu cuenta de Booking.com y sincroniza habitaciones vía Channex.',
'channex.bdcConn.loadingProps':      'Cargando propiedades…',
'channex.bdcConn.previewErr':        'Error de previsualización: {error}',
'channex.bdcConn.err':               'Error: {error}',
'channex.bdcConn.synced.one':        '1 habitación sincronizada',
'channex.bdcConn.synced.many':       '{n} habitaciones sincronizadas',
'channex.bdcConn.failed':            'fallidas',
'channex.bdcConn.reconnect':         'Reconectar Booking.com',
'channex.bdcConn.sync':              'Sincronizar Habitaciones y Tarifas',
'channex.bdcConn.syncing':           'Sincronizando…',
'channex.bdcConn.loadingPreview':    'Cargando previsualización…',
'channex.bdcConn.messages':          'Mensajes',
'channex.bdcConn.connectedProps':    'Propiedades Booking.com Conectadas',
'channex.bdcConn.back':              '← Volver a Booking.com',
```

### 4.8 Channex — Reservations, Messages

```ts
// ReservationsPanel
'channex.reserv.count.one':          '1 reservación',
'channex.reserv.count.many':         '{n} reservaciones',
'channex.reserv.refresh':            'Sincronizar desde Channex',
'channex.reserv.refreshing':         'Sincronizando…',
'channex.reserv.syncDone.one':       '✓ Sincronización completa — 1 reserva importada de Channex',
'channex.reserv.syncDone.many':      '✓ Sincronización completa — {n} reservas importadas de Channex',
'channex.reserv.empty.title':        'Sin reservaciones aún',
'channex.reserv.empty.desc':         'Las reservas de Airbnb y Booking.com aparecerán aquí automáticamente.',
'channex.reserv.empty.hasOta':       '¿Ya tienes reservas en tu OTA? Impórtalas ahora.',
'channex.reserv.import':             'Importar Reservas Pasadas',
'channex.reserv.importing':          'Importando…',
'channex.reserv.importStarted':      'Importación iniciada — las reservas aparecerán en unos segundos.',
'channex.reserv.gross':              'bruto',
'channex.reserv.net':                'neto',
'channex.reserv.updated':            'Actualizado {timestamp}',
'channex.reserv.cancel':             'Cancelar reserva',
'channex.reserv.cancelling':         'Cancelando…',

// ReservationDetailModal
'channex.reservDetail.stay':         'Estadía',
'channex.reservDetail.checkin':      'Check-in',
'channex.reservDetail.checkout':     'Check-out',
'channex.reservDetail.duration':     'Duración',
'channex.reservDetail.guests':       'Huéspedes',
'channex.reservDetail.mealPlan':     'Plan de comidas',
'channex.reservDetail.financial':    'Financiero',
'channex.reservDetail.grossTotal':   'Total (bruto)',
'channex.reservDetail.otaComm':      'Comisión OTA',
'channex.reservDetail.netPayout':    'Pago neto',
'channex.reservDetail.payCollect':   'Cobro de pago',
'channex.reservDetail.payType':      'Tipo de pago',
'channex.reservDetail.guestSection': 'Huésped',
'channex.reservDetail.name':         'Nombre',
'channex.reservDetail.email':        'Email',
'channex.reservDetail.phone':        'Teléfono',
'channex.reservDetail.country':      'País',
'channex.reservDetail.bookingInfo':  'Información de reserva',
'channex.reservDetail.otaId':        'ID de reserva OTA',
'channex.reservDetail.reservId':     'ID de reservación',
'channex.reservDetail.channel':      'Canal',
'channex.reservDetail.pmsId':        'ID PMS',
'channex.reservDetail.notes':        'Notas',
'channex.reservDetail.noShowTitle':  'Reportar No Show',
'channex.reservDetail.noShowDesc':   'El huésped no se presentó. Esta acción será comunicada a Booking.com.',
'channex.reservDetail.noShowBtn':    'No show',

// NoShowConfirmModal
'channex.noShow.title':              'Reportar No Show',
'channex.noShow.guestFallback':      'el huésped',
'channex.noShow.body':               'Esta acción es irreversible y será comunicada a Booking.com.',
'channex.noShow.charged':            'Se cobró el importe de la reserva al huésped',
'channex.noShow.commCharged':        'Booking.com cobrará su comisión.',
'channex.noShow.commWaived':         'Booking.com condonará su comisión.',
'channex.noShow.err.title':          'No se pudo registrar el no show:',
'channex.noShow.err.unknown':        'Error desconocido. Intenta nuevamente.',
'channex.noShow.success':            '✓ No show registrado correctamente.',
'channex.noShow.successDetail':      'Booking.com ha sido notificado.',
'channex.noShow.cancel':             'Cancelar',
'channex.noShow.sending':            'Enviando…',
'channex.noShow.confirm':            'Confirmar No Show',
'channex.noShow.close':              'Cerrar',
'channex.noShow.retry':              'Reintentar',
'channex.noShow.understood':         'Entendido',

// MessagesInbox
'channex.messages.loading':          'Cargando mensajes…',
'channex.messages.empty':            'No hay mensajes en este hilo aún.',
'channex.messages.inquiry':          'Consulta',
'channex.messages.selectConv':       'Selecciona una conversación',
'channex.messages.replyPh':          'Responder… (Enter para enviar, Shift+Enter para nueva línea)',
'channex.messages.send':             'Enviar',
'channex.messages.sending':          '…',
```

### 4.9 Inventory

```ts
// InventoryPage
'inventory.back':                    '← Dashboard',
'inventory.title':                   'Gestor de Inventario',
'inventory.admin':                   'Admin',
'inventory.business':                'Negocio',
'inventory.menu':                    'Menú',
'inventory.menu.catalogs':           'Catálogos y Productos',
'inventory.menu.triggers':           'Disparadores de Palabras Clave',

// AutoReplyManager
'inventory.autoReply.title':         'Disparadores de Palabras Clave',
'inventory.autoReply.desc':          'Respuesta automática con colecciones de productos al coincidir una palabra clave.',
'inventory.autoReply.new':           '+ Nueva Regla',
'inventory.autoReply.loading':       'Cargando...',
'inventory.autoReply.empty.title':   'Sin disparadores de palabras clave aún.',
'inventory.autoReply.empty.desc':    'Crea una regla para responder automáticamente con productos cuando se reciba una palabra clave.',
'inventory.autoReply.col.trigger':   'Palabra clave',
'inventory.autoReply.col.collection':'Colección',
'inventory.autoReply.col.products':  'Productos',
'inventory.autoReply.col.active':    'Activo',
'inventory.autoReply.col.actions':   'Acciones',
'inventory.autoReply.deactivate':    'Desactivar regla',
'inventory.autoReply.activate':      'Activar regla',
'inventory.autoReply.refresh':       '↻ Actualizar',
'inventory.autoReply.editTitle':     'Editar Regla',
'inventory.autoReply.newTitle':      'Nueva Regla',
'inventory.autoReply.field.trigger': 'Palabra clave',
'inventory.autoReply.field.match':   'Tipo de coincidencia',
'inventory.autoReply.field.collection': 'Título de colección',
'inventory.autoReply.field.products':'Productos a incluir',
'inventory.autoReply.ph.trigger':    'ej. "hola" u "ofertas"',
'inventory.autoReply.help.trigger':  'El texto entrante que activará esta respuesta automática.',
'inventory.autoReply.match.exact':   '= Exacto',
'inventory.autoReply.match.contains':'⊃ Contiene',
'inventory.autoReply.help.exact':    'El mensaje completo debe ser igual a la palabra clave exactamente.',
'inventory.autoReply.help.contains': 'El mensaje solo necesita contener la palabra clave en cualquier parte.',
'inventory.autoReply.ph.collection': 'ej. "Ropa de niños"',
'inventory.autoReply.help.collection': 'Se muestra como encabezado de sección en el mensaje de productos de WhatsApp.',
'inventory.autoReply.selected':      '{n} seleccionado',
'inventory.autoReply.noCatalog':     'Sin catálogos encontrados. Crea un catálogo en "Catálogos y Productos" primero.',
'inventory.autoReply.searchPh':      'Buscar productos…',
'inventory.autoReply.noProducts':    'Sin productos en este catálogo.',
'inventory.autoReply.noSearch':      'Ningún producto coincide con tu búsqueda.',
'inventory.autoReply.count.one':     '1 producto en catálogo · {shown} mostrado',
'inventory.autoReply.count.many':    '{n} productos en catálogo · {shown} mostrados',
'inventory.autoReply.activeLabel':   'Activo',
'inventory.autoReply.activeHelp':    'Las reglas inactivas se guardan pero no se dispararán.',
'inventory.autoReply.val.trigger':   'La palabra clave es requerida',
'inventory.autoReply.val.collection':'El título de la colección es requerido',
'inventory.autoReply.val.products':  'Selecciona al menos un producto',
'inventory.autoReply.ok.updated':    'Regla actualizada',
'inventory.autoReply.ok.created':    'Regla "{word}" creada',
'inventory.autoReply.err.save':      'Error al guardar la regla',
'inventory.autoReply.save':          'Guardar Cambios',
'inventory.autoReply.create':        'Crear Regla',
'inventory.autoReply.saving':        'Guardando…',

// CatalogManager
'inventory.catalog.title':           'Catálogos de Productos',
'inventory.catalog.new':             '+ Nuevo Catálogo',
'inventory.catalog.cancel':          'Cancelar',
'inventory.catalog.nameLbl':         'Nombre del catálogo',
'inventory.catalog.namePh':          'ej. Colección de Verano',
'inventory.catalog.create':          'Crear',
'inventory.catalog.creating':        'Creando…',
'inventory.catalog.loading':         'Cargando...',
'inventory.catalog.empty':           'Sin catálogos encontrados en tu cuenta de Business.',
'inventory.catalog.emptyHint':       'Haz click en "+Nuevo Catálogo" para crear uno.',
'inventory.catalog.manage':          'Productos →',
'inventory.catalog.rename':          'Renombrar',
'inventory.catalog.delete':          'Eliminar',
'inventory.catalog.ok.renamed':      'Catálogo renombrado',
'inventory.catalog.ok.deleted':      'Catálogo "{name}" eliminado',
'inventory.catalog.ok.created':      'Catálogo "{name}" creado',
'inventory.catalog.refresh':         '↻ Actualizar',
'inventory.catalog.confirm.delete':  '¿Eliminar catálogo "{name}"? Esto lo eliminará permanentemente junto con todos sus productos de Meta.',

// ProductManager
'inventory.product.back':            '← Catálogos',
'inventory.product.new':             '+ Nuevo Producto',
'inventory.product.form.newTitle':   'Nuevo Producto',
'inventory.product.form.editTitle':  'Editar Producto',
'inventory.product.cancel':          'Cancelar',
'inventory.product.field.sku':       'SKU / ID de minorista',
'inventory.product.field.name':      'Nombre',
'inventory.product.field.desc':      'Descripción',
'inventory.product.field.price':     'Precio',
'inventory.product.field.currency':  'Moneda',
'inventory.product.field.avail':     'Disponibilidad',
'inventory.product.field.cond':      'Condición',
'inventory.product.field.imageUrl':  'URL de imagen',
'inventory.product.field.pageUrl':   'URL de página de producto',
'inventory.product.ph.sku':          'ej. CAMISA-ROJA-M',
'inventory.product.ph.name':         'ej. Camiseta Roja de Algodón',
'inventory.product.ph.desc':         'Descripción corta del producto',
'inventory.product.avail.inStock':   'en stock',
'inventory.product.avail.outOfStock':'sin stock',
'inventory.product.avail.preorder':  'reserva anticipada',
'inventory.product.avail.available': 'disponible para pedido',
'inventory.product.avail.discontinued': 'descontinuado',
'inventory.product.cond.new':        'nuevo',
'inventory.product.cond.refurbished':'reacondicionado',
'inventory.product.cond.used':       'usado',
'inventory.product.val.price':       'Ingresa un precio válido (ej. 10.00)',
'inventory.product.ok.updated':      '"{name}" actualizado',
'inventory.product.ok.created':      '"{name}" agregado',
'inventory.product.err.op':          'Operación fallida',
'inventory.product.save':            'Guardar Cambios',
'inventory.product.create':          'Crear Producto',
'inventory.product.saving':          'Guardando…',
'inventory.product.creating':        'Creando…',
'inventory.product.badge.inStock':   'En stock',
'inventory.product.badge.outOfStock':'Sin stock',
'inventory.product.edit':            'Editar',
'inventory.product.variants':        'Variantes',
'inventory.product.delete':          'Eliminar',
'inventory.product.loading':         '…',
'inventory.product.empty':           'Sin productos en este catálogo aún.',
'inventory.product.emptyHint':       'Haz click en "+Nuevo Producto" para agregar el primero.',
'inventory.product.count.one':       '1 producto',
'inventory.product.count.many':      '{n} productos',
'inventory.product.refresh':         '↻ Actualizar',
'inventory.product.confirm.delete':  '¿Eliminar "{name}"? Esta acción es permanente y no se puede deshacer.',

// VariantManager
'inventory.variant.back':            '← Productos',
'inventory.variant.badge':           'Variantes',
'inventory.variant.new':             '+ Nueva Variante',
'inventory.variant.form.newTitle':   'Nueva Variante',
'inventory.variant.form.editTitle':  'Editar Variante',
'inventory.variant.cancel':          'Cancelar',
'inventory.variant.notice':          'Regla de agrupación de Meta: El nombre y descripción se heredan del producto padre.',
'inventory.variant.field.attr':      'Atributo',
'inventory.variant.field.value':     'Valor',
'inventory.variant.field.sku':       'SKU / ID de minorista',
'inventory.variant.field.name':      'Nombre',
'inventory.variant.field.desc':      'Descripción',
'inventory.variant.field.price':     'Precio',
'inventory.variant.field.currency':  'Moneda',
'inventory.variant.field.avail':     'Disponibilidad',
'inventory.variant.field.cond':      'Condición',
'inventory.variant.field.imageUrl':  'URL de imagen',
'inventory.variant.field.pageUrl':   'URL del producto',
'inventory.variant.field.groupId':   'item_group_id',
'inventory.variant.custom':          'Personalizado…',
'inventory.variant.ph.attr':         'ej. material',
'inventory.variant.ph.value':        'ej. Rojo, XL, Algodón',
'inventory.variant.ph.sku':          'ej. CAMISA-ROJA-XL',
'inventory.variant.inherited':       'Heredado',
'inventory.variant.noParentDesc':    'Sin descripción en el padre',
'inventory.variant.val.price':       'Ingresa un precio válido (ej. 10.00)',
'inventory.variant.val.attr':        'Ingresa una clave de atributo',
'inventory.variant.ok.updated':      'Variante "{name}" actualizada',
'inventory.variant.ok.created':      'Variante "{key}: {value}" creada',
'inventory.variant.err.neverSynced': 'No se puede eliminar una variante que nunca fue sincronizada con Meta',
'inventory.variant.confirm.archive': '¿Archivar variante "{name}" ({key}: {value})? Se eliminará de Meta y se archivará en Firestore.',
'inventory.variant.ok.archived':     'Variante archivada',
'inventory.variant.save':            'Guardar Cambios',
'inventory.variant.create':          'Crear Variante',
'inventory.variant.saving':          'Guardando…',
'inventory.variant.creating':        'Creando…',
'inventory.variant.col.attr':        'Atributo',
'inventory.variant.col.sku':         'SKU',
'inventory.variant.col.price':       'Precio',
'inventory.variant.col.stock':       'Stock',
'inventory.variant.col.status':      'Estado',
'inventory.variant.actions.edit':    'Editar',
'inventory.variant.actions.archive': 'Archivar',
'inventory.variant.archived.one':    '1 variante archivada',
'inventory.variant.archived.many':   '{n} variantes archivadas',
'inventory.variant.active.one':      '1 variante activa',
'inventory.variant.active.many':     '{n} variantes activas',
'inventory.variant.refresh':         '↻ Actualizar',
'inventory.variant.empty':           'Sin variantes aún.',
'inventory.variant.emptyHint':       'Haz click en "+Nueva Variante" para agregar tallas, colores o materiales.',
```

### 4.10 Legacy components (CatalogView, CartViewer, InstagramConnect, MessengerConnect)

```ts
// CatalogView/index.tsx (legacy dashboard catalog card)
'catalog.title':                     'Catálogo de Productos',
'catalog.health.connected':          '● Conectado',
'catalog.health.ok':                 '● OK',
'catalog.health.attention':          '● Atención',
'catalog.health.commerce':           '● Commerce',
'catalog.health.missingScope':       'Scope faltante: {scope}',
'catalog.health.noCommerce':         'Sin cuenta Commerce — la creación de catálogos puede fallar',
'catalog.health.tokenValid':         'Token válido — esperando configuración de cuenta Commerce.',
'catalog.openCommerce':              'Abrir Commerce Manager →',
'catalog.manageInventory':           'Gestionar Inventario →',
'catalog.syncing':                   'Sincronizando…',
'catalog.refresh':                   'Actualizar',
'catalog.load':                      'Cargar Catálogo',
'catalog.linked':                    'Catálogo Vinculado',
'catalog.manage':                    'Gestionar →',
'catalog.unlink':                    'Desvincular',
'catalog.unlinking':                 'Desvinculando…',
'catalog.selectExisting':            'Selecciona un catálogo existente para vincular:',
'catalog.link':                      'Vincular',
'catalog.linking':                   'Vinculando…',
'catalog.or':                        'o',
'catalog.createNew':                 '+ Crear Nuevo Catálogo',
'catalog.nameLbl':                   'Nombre del catálogo',
'catalog.namePh':                    'ej. Colección de Verano',
'catalog.create':                    'Crear',
'catalog.creating':                  'Creando…',
'catalog.noLinked':                  'Sin catálogo vinculado a esta integración.',
'catalog.noLoaded':                  'Sin catálogo cargado aún. Haz click en "Cargar Catálogo" para sincronizar desde Meta.',
'catalog.confirm.unlink':            '¿Desvincular este catálogo de WhatsApp? El catálogo en sí no se elimina.',
'catalog.err.link':                  'Error al vincular catálogo',
'catalog.err.unlink':                'Error al desvincular catálogo',
'catalog.err.create':                'Error al crear catálogo',

// CartViewer
'cart.title':                        'Carrito Actual',
'cart.item.one':                     '1 ítem',
'cart.item.many':                    '{n} ítems',
'cart.noConv':                       'Ninguna conversación seleccionada',
'cart.noConvDesc':                   'Selecciona un chat para ver el carrito del cliente en tiempo real.',
'cart.noCart':                       'El usuario no tiene un carrito activo',
'cart.noCartDesc':                   'Los productos aparecerán aquí cuando el cliente agregue artículos desde WhatsApp.',
'cart.qty':                          'Cant: {n}',
'cart.total':                        'Total estimado',
'cart.archiving':                    'Archivando…',
'cart.archive':                      'Archivar Carrito',
'cart.updated':                      'Actualizado {timestamp}',
'cart.err.archive':                  'No se pudo archivar el carrito. Reintenta en un momento.',

// InstagramConnect/index.tsx
'instagram.title':                   'Conectar Instagram',
'instagram.desc':                    'Vincula una cuenta profesional de Instagram (Empresa o Creador).',
'instagram.scope.profile':           'leer tu perfil de negocio de Instagram',
'instagram.scope.messages':          'enviar y recibir DMs, Menciones en Historias',
'instagram.scope.comments':          'leer comentarios, enviar Respuestas Privadas',
'instagram.err.conn':                'Error de conexión:',
'instagram.tryAgain':                'Intentar de nuevo',
'instagram.redirecting':             'Redirigiendo a Instagram…',
'instagram.connect':                 'Conectar Instagram',
'instagram.httpsGuard':              'Instagram OAuth requiere HTTPS.',

// MessengerConnect/index.tsx
'messenger.title':                   'Conectar Facebook Messenger',
'messenger.desc':                    'Vincula una Página de Facebook para recibir y responder conversaciones de Messenger.',
'messenger.scope.pages':             'listar tus páginas administradas',
'messenger.scope.messaging':         'enviar y recibir mensajes de Messenger',
'messenger.scope.metadata':          'suscribirse a webhooks de la Página',
'messenger.err.conn':                'Error de conexión:',
'messenger.tryAgain':                'Intentar de nuevo',
'messenger.connecting':              'Conectando...',
'messenger.connect':                 'Continuar con Facebook',
'messenger.httpsGuard':              'Login de Facebook requiere HTTPS.',
```

---

## 5. English Translations (`en.ts`) — Representative additions

Every key in section 4 must also appear in `en.ts`. Key examples:

| ES key | ES value | EN value |
|---|---|---|
| `channex.props.title` | Propiedades | Properties |
| `channex.ari.title` | Calendario ARI | ARI Calendar |
| `channex.noShow.title` | Reportar No Show | Report No-Show |
| `channex.reserv.refresh` | Sincronizar desde Channex | Sync from Channex |
| `channex.pools.title` | Pools de Propiedad | Property Pools |
| `inventory.autoReply.title` | Disparadores de Palabras Clave | Keyword Triggers |
| `inventory.catalog.title` | Catálogos de Productos | Product Catalogs |
| `cart.title` | Carrito Actual | Current Cart |
| `instagram.connect` | Conectar Instagram | Connect Instagram |
| `messenger.connect` | Continuar con Facebook | Continue with Facebook |

Full EN equivalents must be defined for all ~400 new keys.

---

## 6. Files Modified

### Core infrastructure (1 file)
| File | Change |
|---|---|
| `src/context/LanguageContext.tsx` | Add `vars` param to `t()` |

### Translation files (2 files)
| File | Change |
|---|---|
| `src/i18n/es.ts` | Add ~400 new keys across all namespaces |
| `src/i18n/en.ts` | Add matching EN translations for all new keys |

### Channex components (19 files)
| File | Missing `useLanguage` |
|---|---|
| `src/channex/ChannexHub.tsx` | Partial — 3 strings remaining |
| `src/channex/components/PropertiesList.tsx` | Full |
| `src/channex/components/PropertySetupWizard.tsx` | Full |
| `src/channex/components/ARIGlossaryButton.tsx` | Full |
| `src/channex/components/shared/PropertyCard.tsx` | Full |
| `src/channex/components/shared/PropertyDetail.tsx` | Full |
| `src/channex/components/shared/RoomRateManager.tsx` | Full |
| `src/channex/components/shared/ARICalendar.tsx` | Full |
| `src/channex/components/shared/MessagesInbox.tsx` | Full |
| `src/channex/components/shared/ReservationsPanel.tsx` | Full |
| `src/channex/components/shared/ReservationDetailModal.tsx` | Full |
| `src/channex/components/shared/NoShowConfirmModal.tsx` | Full |
| `src/channex/components/pools/PoolsList.tsx` | Full |
| `src/channex/components/pools/PoolDetail.tsx` | Full |
| `src/channex/components/pools/PoolCreateForm.tsx` | Full |
| `src/channex/components/pools/PoolEditModal.tsx` | Full |
| `src/channex/components/pools/PoolSyncModal.tsx` | Full |
| `src/channex/components/pools/PoolAriPanel.tsx` | Full |
| `src/channex/components/pools/AssignConnectionModal.tsx` | Full |
| `src/channex/components/connection/NoPropertyGuide.tsx` | Full |
| `src/channex/components/connection/ChannelManagementPanel.tsx` | Full |
| `src/channex/components/connection/BdcChannelSelectModal.tsx` | Full |
| `src/channex/components/connection/SyncNamingModal.tsx` | Full |
| `src/channex/components/connection/AirbnbConnectionPanel.tsx` | Full |
| `src/channex/components/connection/BookingConnectionPanel.tsx` | Full |

### Inventory components (5 files)
| File | |
|---|---|
| `src/inventory/InventoryPage.tsx` | Full |
| `src/inventory/components/AutoReplyManager.tsx` | Full |
| `src/inventory/components/CatalogManager.tsx` | Full |
| `src/inventory/components/ProductManager.tsx` | Full |
| `src/inventory/components/VariantManager.tsx` | Full |

### Legacy / shared components (5 files)
| File | |
|---|---|
| `src/components/CatalogView/index.tsx` | Full |
| `src/components/CartPanel/CartViewer.tsx` | Full |
| `src/components/ConnectButton/index.tsx` | Partial — 1 missing string |
| `src/components/InstagramConnect/index.tsx` | Full |
| `src/components/MessengerConnect/index.tsx` | Full |

`ConnectButton` already uses the existing `conn.*` keys for button labels and step states. Only one new key is needed:

```ts
'conn.sdkUnavailable': 'SDK de Facebook no disponible. Asegúrate de estar en una URL HTTPS.',
```

EN: `'Facebook SDK not available. Ensure you are on an HTTPS URL.'`

**Total:** 37 components + 2 locale files + 1 context file = **40 files**

---

## 7. Constraints

- **Zero functionality changes.** No logic, state, API calls, routing, or side effects may be altered.
- **Do not translate:** channel identifiers (`'whatsapp'`, `'airbnb'`), API field names (`item_group_id`), Firestore paths, CSS classes, proper nouns identical in both languages (WhatsApp, Airbnb, Booking.com, Channex, Meta, OTA, ARI, IFrame, SMS, OTP, PIN).
- **`t()` interpolation only for `{varName}` patterns.** No eval, no template literals in translation values.
- **Plural pairs** must both be added to `es.ts` and `en.ts` in the same commit as the component change.
- **TypeScript must compile cleanly** after each component migration — no partial key additions that leave `en.ts` out of sync.
