# Plan de Pruebas — Certificación Channex (Sesión en Vivo)

**Fecha:** 2026-05-06  
**Ruta de UI:** ChannexHub → tab **Properties** → seleccionar property → tab **ARI Calendar**

Antes de cada prueba: tener el formulario de certificación de Channex abierto en otra pestaña.  
El backend debe estar corriendo en `localhost:3001` con ngrok activo y `CHANNEX_WEBHOOK_CALLBACK_URL` actualizada.

---

## Prerequisito — Verificar Setup de la Property

Antes de iniciar los tests, confirmar en **Rooms & Rates** que la property tiene:

| Entidad | Nombre | Detalles |
|---------|--------|---------|
| Room Type | Twin Room | Occupancy 2 |
| Room Type | Double Room | Occupancy 2 |
| Rate Plan (Twin) | Best Available Rate | $100 base |
| Rate Plan (Twin) | Bed and Breakfast | $120 base |
| Rate Plan (Double) | Best Available Rate | $100 base |
| Rate Plan (Double) | Bed and Breakfast | $120 base |

Si faltan entidades, crearlas desde **Rooms & Rates** antes de continuar.  
Anotar los UUIDs de property, room types y rate plans para el formulario (Sección 2).

---

## Nota sobre el Batch

El panel ARI permite acumular múltiples entries en el batch antes de hacer el envío.  
Flujo para entries con **distintas fechas**:

1. Seleccionar rango de fechas en el calendario → panel se abre mostrando el rango
2. Elegir Room Type, Rate Plan y los campos a actualizar
3. Presionar **"+ Add to Batch"** — el entry queda guardado con su propio rango de fechas
4. Hacer clic en un nuevo rango de fechas en el calendario → el panel actualiza el rango sin perder el batch
5. Repetir pasos 2-4 para cada entry adicional
6. Presionar **"Save (N)"** cuando el batch esté completo — se despacha en 1 sola llamada a Channex

---

## Test #1 — Full Sync

**Formulario:** Sección 4  
**Llamadas Channex:** 2 (1 de availability + 1 de restrictions)

1. En **ARI Calendar**, presionar **"Full Sync"** (botón superior derecho)
2. Verificar/ajustar los valores en el modal:
   - Availability: `1`
   - Rate: `100`
   - Days: `500`
3. Presionar **"Run Full Sync"**
4. Copiar los 2 task IDs del bloque verde:
   - **Availability Task ID** → Sección 4 del formulario
   - **Restrictions Task ID** → Sección 4 del formulario

---

## Test #2 — Single date / single rate

**Formulario:** Sección 5–6  
**Llamadas Channex:** 1

1. Clic en **Nov 22** → clic en **Nov 22** → panel se abre
2. Campos del panel:
   - Room Type: **Twin Room**
   - Rate Plan: **Best Available Rate**
   - Rate: `333`
   - Dejar todos los demás campos vacíos
3. Presionar **"+ Add to Batch"**
4. Presionar **"Save (1)"**
5. Copiar el **Task ID** del banner verde → Sección 6

---

## Test #3 — Single date / múltiples rates (batch)

**Formulario:** Sección 8–9  
**Llamadas Channex:** 1

1. Clic **Nov 21** → clic **Nov 21** → panel se abre

**Entry 1:**
- Room Type: **Twin Room** | Rate Plan: **Best Available Rate** | Rate: `333`
- Presionar **"+ Add to Batch"**

**Entry 2** (misma fecha, mismo panel abierto):
- Room Type: **Double Room** | Rate Plan: **Best Available Rate** | Rate: `444`
- Presionar **"+ Add to Batch"**

**Entry 3:**
- Room Type: **Double Room** | Rate Plan: **Bed and Breakfast** | Rate: `456.23`
- Presionar **"+ Add to Batch"**

5. Presionar **"Save (3)"**
6. Copiar **Task ID** → Sección 9

---

## Test #4 — Múltiples fechas / múltiples rates (batch)

**Formulario:** Sección 11–12  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 1** → clic **Nov 10** → panel muestra rango Nov 01–10
- Twin Room | Best Available Rate | Rate: `241`
- Presionar **"+ Add to Batch"**

**Entry 2** (el batch queda, cambiar rango):
- Clic **Nov 10** → clic **Nov 16** → panel actualiza rango a Nov 10–16
- Double Room | Best Available Rate | Rate: `312.66`
- Presionar **"+ Add to Batch"**

**Entry 3:**
- Clic **Nov 1** → clic **Nov 20** → panel actualiza rango a Nov 01–20
- Double Room | Bed and Breakfast | Rate: `111`
- Presionar **"+ Add to Batch"**

4. Presionar **"Save (3)"**
5. Copiar **Task ID** → Sección 12

---

## Test #5 — Min Stay (batch)

**Formulario:** Sección 14–15  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 23** → clic **Nov 23**
- Twin Room | Best Available Rate | Min Stay: `3`
- Presionar **"+ Add to Batch"**

**Entry 2:**
- Clic **Nov 25** → clic **Nov 25**
- Double Room | Best Available Rate | Min Stay: `2`
- Presionar **"+ Add to Batch"**

**Entry 3:**
- Clic **Nov 15** → clic **Nov 15**
- Double Room | Bed and Breakfast | Min Stay: `5`
- Presionar **"+ Add to Batch"**

4. Presionar **"Save (3)"**
5. Copiar **Task ID** → Sección 15

---

## Test #6 — Stop Sell (batch)

**Formulario:** Sección 17–18  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 14** → clic **Nov 14**
- Twin Room | Best Available Rate | ☑ Stop Sell
- Presionar **"+ Add to Batch"**

**Entry 2:**
- Clic **Nov 16** → clic **Nov 16**
- Double Room | Best Available Rate | ☑ Stop Sell
- Presionar **"+ Add to Batch"**

**Entry 3:**
- Clic **Nov 20** → clic **Nov 20**
- Double Room | Bed and Breakfast | ☑ Stop Sell
- Presionar **"+ Add to Batch"**

4. Presionar **"Save (3)"**
5. Copiar **Task ID** → Sección 18

---

## Test #7 — Múltiples restricciones combinadas (batch)

**Formulario:** Sección 20–21  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 1** → clic **Nov 10**
- Twin Room | Best Available Rate | ☑ Closed to Arrival | Max Stay: `4` | Min Stay: `1`
- Presionar **"+ Add to Batch"**

**Entry 2:**
- Clic **Nov 12** → clic **Nov 16**
- Twin Room | Bed and Breakfast | ☑ Closed to Departure | Min Stay: `6`
- Presionar **"+ Add to Batch"**

**Entry 3:**
- Clic **Nov 10** → clic **Nov 16**
- Double Room | Best Available Rate | ☑ Closed to Arrival | Min Stay: `2`
- Presionar **"+ Add to Batch"**

**Entry 4:**
- Clic **Nov 1** → clic **Nov 20**
- Double Room | Bed and Breakfast | Min Stay: `10`
- Presionar **"+ Add to Batch"**

5. Presionar **"Save (4)"**
6. Copiar **Task ID** → Sección 21

---

## Test #8 — Half-year update (batch)

**Formulario:** Sección 23–24  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Dec 1** → navegar con "Next" hasta **Mayo 2027** → clic **May 1**
- Panel muestra rango Dec 01 2026 – May 01 2027
- Twin Room | Best Available Rate | Rate: `432` | ☑ Closed to Arrival | ☑ Closed to Departure | Min Stay: `2`
- Presionar **"+ Add to Batch"**

**Entry 2** (mismo rango en el panel):
- Double Room | Best Available Rate | Rate: `342` | Min Stay: `3`
- Presionar **"+ Add to Batch"**

3. Presionar **"Save (2)"**
4. Copiar **Task ID** → Sección 24

---

## Test #9 — Disponibilidad por fechas individuales (batch)

**Formulario:** Sección 26–27  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 21** → clic **Nov 21**
- Twin Room | Availability: `7`
- Presionar **"+ Add to Batch"**

**Entry 2:**
- Clic **Nov 25** → clic **Nov 25**
- Double Room | Availability: `0`
- Presionar **"+ Add to Batch"**

3. Presionar **"Save (2)"**
4. Copiar **Task ID** → Sección 27

---

## Test #10 — Disponibilidad por rangos (batch)

**Formulario:** Sección 29–30  
**Llamadas Channex:** 1

**Entry 1:**
- Clic **Nov 10** → clic **Nov 16**
- Twin Room | Availability: `3`
- Presionar **"+ Add to Batch"**

**Entry 2:**
- Clic **Nov 17** → clic **Nov 24**
- Double Room | Availability: `4`
- Presionar **"+ Add to Batch"**

3. Presionar **"Save (2)"**
4. Copiar **Task ID** → Sección 30

---

## Test #11 — Webhook (ejecutado por el evaluador de Channex)

**Formulario:** Sección 32

1. Verificar que ngrok esté activo y `CHANNEX_WEBHOOK_CALLBACK_URL` en `.env.secrets` sea la URL vigente
2. El evaluador de Channex hará 3 test pushes desde su panel:
   - `booking_new`
   - `booking_modification`
   - `booking_cancellation`
3. En los logs del backend verificar para cada evento:
   ```
   [ChannexWebhookController] ✓ Webhook received
   [BookingRevisionWorker] Processing revision...
   ```
4. Copiar del log los siguientes IDs → Sección 32:
   - **Booking ID** (común a los 3 eventos)
   - **Revision ID** de `booking_new`
   - **Revision ID** de `booking_modification`
   - **Revision ID** de `booking_cancellation`

---

## Sección 33 — Rate Limits

| Pregunta | Respuesta |
|---------|-----------|
| ¿Puede respetar los rate limits de Channex (10/min por propiedad)? | **Sí** — implementamos `ChannexARIRateLimiter`: sliding window, 10 req/min por propiedad por endpoint |
| ¿Solo envían cambios delta (no full-sync automático por timer)? | **Sí** — los pushes son disparados por acciones del usuario. El Full Sync solo se ejecuta manualmente en el go-live inicial |

---

## Hoja de Recolección de IDs

```
Property ID:     ___________________________________

Twin Room ID:    ___________________________________
Double Room ID:  ___________________________________

Twin / Best Available Rate ID:    _________________
Twin / Bed and Breakfast ID:      _________________
Double / Best Available Rate ID:  _________________
Double / Bed and Breakfast ID:    _________________

Test #1  Task ID (Availability):  _________________
Test #1  Task ID (Restrictions):  _________________
Test #2  Task ID:                 _________________
Test #3  Task ID:                 _________________
Test #4  Task ID:                 _________________
Test #5  Task ID:                 _________________
Test #6  Task ID:                 _________________
Test #7  Task ID:                 _________________
Test #8  Task ID:                 _________________
Test #9  Task ID:                 _________________
Test #10 Task ID:                 _________________

Test #11 Booking ID:              _________________
Test #11 Revision ID (new):       _________________
Test #11 Revision ID (mod):       _________________
Test #11 Revision ID (cancel):    _________________
```
