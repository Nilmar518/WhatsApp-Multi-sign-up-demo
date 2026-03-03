# Local Testing Guide — Migo UIT Webhook & Messaging

## Prerequisites

- Backend running on `http://localhost:3001` (`pnpm --filter @migo-uit/backend run dev`)
- ngrok tunnel active (`ngrok http 3001`)
- `.env` populated with valid `META_WEBHOOK_VERIFY_TOKEN` and a Firestore integration document at `integrations/{businessId}` with `metaData.phoneNumberId` set

---

## 1. Webhook Verification (hub challenge)

Simulates Meta calling your endpoint during webhook registration:

```bash
curl -G "http://localhost:3001/webhook" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=migo_verify_secret_2024" \
  --data-urlencode "hub.challenge=CHALLENGE_STRING_123"
```

**Expected response:** `CHALLENGE_STRING_123` with HTTP 200.

---

## 2. Mock Inbound Message (POST /webhook)

Simulates a user sending "Hello!" to your WhatsApp number.
Replace `PHONE_NUMBER_ID` with the value stored in `integrations/{businessId}/metaData.phoneNumberId`.

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "WABA_ID_PLACEHOLDER",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "metadata": {
                "display_phone_number": "15550001234",
                "phone_number_id": "PHONE_NUMBER_ID"
              },
              "messages": [
                {
                  "from": "5491112345678",
                  "id": "wamid.test_HBgMNTQ5MTExMjM0NTY3OBUCABIYAA==",
                  "timestamp": "'"$(date +%s)"'",
                  "type": "text",
                  "text": { "body": "Hello from test user!" }
                }
              ]
            }
          }
        ]
      }
    ]
  }'
```

**Expected response:** `{"received":true}` with HTTP 200.

**Expected Firestore side-effect:** `integrations/{businessId}.messages` array gains a new `inbound` entry. The frontend `ChatConsole` updates in real-time via `onSnapshot`.

---

## 3. Mock Outbound Message (POST /messages/send)

Sends a reply from the dashboard. Replace values as needed.

```bash
curl -X POST http://localhost:3001/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "demo-business-001",
    "recipientPhoneNumber": "5491112345678",
    "text": "Hello from Migo UIT!"
  }'
```

**Expected response:** `{"messageId":"wamid.xxxx"}` with HTTP 200.

> ⚠️ **User Must Message First:** This call will return Meta error `131047` if the recipient has not sent a message to your WhatsApp number within the last 24 hours.

---

## 4. Mock Status/Delivery Receipt (ignored by design)

Meta also sends delivery receipts. The backend logs and discards them:

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "WABA_ID_PLACEHOLDER",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "metadata": { "phone_number_id": "PHONE_NUMBER_ID" },
              "statuses": [
                {
                  "id": "wamid.test_xxx",
                  "status": "delivered",
                  "timestamp": "1700000000",
                  "recipient_id": "5491112345678"
                }
              ]
            }
          }
        ]
      }
    ]
  }'
```

**Expected:** `{"received":true}` — no Firestore write, log line `No actionable text messages in payload`.

---

## 5. Catalog Fetch

Triggers Meta catalog sync for a connected integration (requires `ACTIVE` status in Firestore):

```bash
curl "http://localhost:3001/catalog?businessId=demo-business-001"
```

**Expected response:**
```json
{
  "catalogId": "CATALOG_ID",
  "catalogName": "My Product Catalog",
  "products": [
    { "id": "PROD_1", "name": "Widget", "retailer_id": "SKU-001", "availability": "in stock", "price": "9.99", "currency": "USD" }
  ],
  "fetchedAt": "2026-02-23T18:00:00.000Z"
}
```

Also stored in `integrations/demo-business-001.catalog` — the `CatalogView` component updates automatically via `onSnapshot`.

---

## 6. Integration Reset (Dev Only)

Wipes the Firestore document so the UI returns to the initial wizard state:

```bash
curl -X DELETE "http://localhost:3001/integrations/demo-business-001"
```

**Expected response:** `{"reset":true,"businessId":"demo-business-001"}`

**Frontend side-effect:** `onSnapshot` fires with a deleted document → status resets to `IDLE`, ChatConsole and CatalogView disappear.

---

## 7. Postman Collection (quick import)

Save the following as `Migo-UIT.postman_collection.json` and import into Postman:

```json
{
  "info": { "name": "Migo UIT", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": [
    {
      "name": "Webhook Verify",
      "request": {
        "method": "GET",
        "url": "http://localhost:3001/webhook?hub.mode=subscribe&hub.verify_token=migo_verify_secret_2024&hub.challenge=CHALLENGE_123"
      }
    },
    {
      "name": "Mock Inbound Message",
      "request": {
        "method": "POST",
        "url": "http://localhost:3001/webhook",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA_ID\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"phone_number_id\":\"PHONE_NUMBER_ID\"},\"messages\":[{\"from\":\"5491112345678\",\"id\":\"wamid.test_001\",\"timestamp\":\"1700000000\",\"type\":\"text\",\"text\":{\"body\":\"Hello!\"}}]}}]}]}"
        }
      }
    },
    {
      "name": "Send Message",
      "request": {
        "method": "POST",
        "url": "http://localhost:3001/messages/send",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\"businessId\":\"demo-business-001\",\"recipientPhoneNumber\":\"5491112345678\",\"text\":\"Hello from Migo UIT!\"}"
        }
      }
    },
    {
      "name": "Fetch Catalog",
      "request": {
        "method": "GET",
        "url": "http://localhost:3001/catalog?businessId=demo-business-001"
      }
    },
    {
      "name": "Reset Integration",
      "request": {
        "method": "DELETE",
        "url": "http://localhost:3001/integrations/demo-business-001"
      }
    }
  ]
}
```

---

## 8. Final Demo Scenario (Full Walkthrough)

Complete end-to-end demo script for a stakeholder presentation:

### Step 1 — Onboard a Business
1. Open `http://localhost:3000` in a browser
2. Use the **Business Toggle** (top-right) to select **Number 1** (`demo-business-001`)
3. Click **"Connect WhatsApp"**
4. Complete the Meta Embedded Signup flow in the popup — select/create a WABA and phone number
5. **Watch in real-time:** status dot transitions `IDLE → CONNECTING → ACTIVE` without any page refresh
6. Check NestJS logs for:
   - `[GCP-SECRET-EMULATOR] Accessing secret: META_APP_ID`
   - `[TOKEN_EXCHANGE] ✓ Completed for businessId=demo-business-001`
   - `[SYSTEM_USER] ✓ Escalated to permanent System User token` *(if configured in .env.secrets)*

### Step 2 — Verify Connection Status
- Status indicator shows green "Connected"
- Token type stored in Firestore: `metaData.tokenType = 'SYSTEM_USER'` (or `'LONG_LIVED'`)
- The integration will not expire if System User escalation succeeded

### Step 3 — View Product Catalog
1. In the **"Product Catalog"** section, click **"Load Catalog"**
2. Backend calls Meta `/{WABA_ID}/product_catalogs` then `/{CATALOG_ID}/products`
3. Product list appears in the panel via Firestore `onSnapshot` — no page reload

### Step 4 — Receive an Inbound Message
1. Ask the demo user to send a WhatsApp message to your business number
   *(or use the curl command from §2 to mock it locally)*
2. The message bubble appears in the **Chat Console** immediately
3. Status badge shows **"User must message first"** — explains the 24h window rule

### Step 5 — Reply from the Dashboard
1. Enter the recipient phone in the phone field
2. Type a reply and press **Enter** or click **Send**
3. The outbound green bubble appears in the Chat Console in real-time

### Step 6 — Demonstrate Multi-Integration Handling
1. Click **"Number 2"** in the Business Toggle
2. The entire UI context switches to `demo-business-002` with its own isolated state
3. Onboard a second WABA to demonstrate multi-tenant capability

### Step 7 — Reset for the Next Demo Run
1. Switch back to **Number 1**
2. Click **"Clear Integration (Dev Reset)"** at the bottom of the dashboard
3. The Firestore document is deleted — UI returns to the wizard state **automatically**
4. Ready for the next demo without any manual database cleanup
