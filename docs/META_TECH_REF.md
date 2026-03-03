# Meta WhatsApp API — Technical Reference

> **Generated from:** Sub-issue 1 Research (Review Meta Docs, Identify Permissions, Technical Summary)
> **Source:** WhatsApp Embedded Signup Builder + Cloud API documentation

---

## 1. Required Permissions (OAuth Scopes)

The Migo UIT application requires the following scopes, configured in the **Facebook Login for Business** product and passed during JavaScript SDK initialization:

| Scope | Access Level | Purpose |
|---|---|---|
| `whatsapp_business_management` | Advanced (recommended) | Manage WABAs, templates, phone numbers for non-affiliated businesses |
| `whatsapp_business_messaging` | Advanced (mandatory) | Send and receive messages via Cloud API; without this a 403 is returned |
| `business_management` | Standard | Link app to client's Business Portfolio; required for system-user token escalation |

> **Note:** Standard Access is sufficient during POC (development mode with tester accounts). Advanced Access requires Meta App Review before going live.

---

## 2. Token Exchange Flow — Three Phases

### Phase 1: Frontend Capture (Authorization Code)

When the user completes the Embedded Signup popup, Meta emits a `message` event to the parent window containing a **single-use authorization code**.

```javascript
// Migo UIT Frontend — event listener
window.addEventListener('message', (event) => {
  if (!event.origin.endsWith('facebook.com')) return;
  const data = JSON.parse(event.data);
  if (data.type === 'WA_EMBEDDED_SIGNUP') {
    if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
      const { phone_number_id, waba_id } = data.data;
      const authCode = data.code; // ⚠️ Single-use — must be exchanged immediately
      initiateTokenExchange(authCode, phone_number_id, waba_id);
    } else if (data.event === 'CANCEL') {
      console.warn('[EmbeddedSignup] User cancelled the flow.');
    } else if (data.event === 'ERROR') {
      console.error('[EmbeddedSignup] Error:', data.data);
    }
  }
});
```

> **Critical:** The `code` is **single-use**. Any retry with the same code will return Meta Error 100 or 190. Immediately forward to the backend.

---

### Phase 2: Backend Exchange (Short-Lived → Long-Lived Token)

The backend calls the Graph API twice to escalate token privileges.

```
Step 1 — Exchange code for a short-lived user access token:
GET https://graph.facebook.com/v19.0/oauth/access_token
  ?client_id={META_APP_ID}
  &client_secret={META_APP_SECRET}
  &code={authCode}

Step 2 — Extend the short-lived token to a 60-day long-lived token:
GET https://graph.facebook.com/v19.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={META_APP_ID}
  &client_secret={META_APP_SECRET}
  &fb_exchange_token={short_lived_token}
```

---

### Phase 3: System User Escalation (Long-Lived → Permanent Token)

For production, the long-lived token should be exchanged for a **System User Access Token** via the Business Manager API. This token does not expire.

```
POST https://graph.facebook.com/v19.0/{BUSINESS_ID}/system_user_access_tokens
  ?system_user_id={SYSTEM_USER_ID}
  &scope=whatsapp_business_messaging,whatsapp_business_management
  &set_token_expires_in_60_days=false
  Authorization: Bearer {LONG_LIVED_TOKEN}
```

> **Recommendation:** Store the system user token encrypted in Firestore under `integrations/{businessId}/metaData.accessToken`.

---

## 3. Meta Error Codes — Critical Handling

| Code | Name | Cause | Recovery |
|---|---|---|---|
| `100` | Invalid Parameter | Code was already used or malformed | Restart the Embedded Signup flow; notify user |
| `190` | Access Token Expired/Invalid | Token was used, expired, or revoked | Restart the Embedded Signup flow; notify user |
| `4` | Rate Limit | Too many calls | Implement exponential backoff (wait ≥ 1s) |
| `10` | Permission Denied | Missing scope in App Review | Check Advanced Access approval |
| `200-299` | Permission Errors | App not approved or scope not granted | Verify App Review status |

---

## 4. Webhook Requirements

The Migo UIT backend must expose a webhook endpoint for Meta to deliver inbound messages and status updates.

### Verification (one-time)
```
GET {NGROK_URL}/webhook
  ?hub.mode=subscribe
  &hub.verify_token={META_WEBHOOK_VERIFY_TOKEN}
  &hub.challenge={CHALLENGE_STRING}

→ Backend responds with the challenge string (200 OK)
```

### Inbound Events
```
POST {NGROK_URL}/webhook
  Body: { object: "whatsapp_business_account", entry: [...] }
```

Subscribe to field: `messages` on the WABA.

---

## 5. Phone Number Prerequisites

- The number must **not** be registered with WhatsApp (consumer) or WhatsApp Business mobile apps.
- If already registered, the user must delete the account from the mobile app's **Account → Delete my account** settings before it can be migrated to Cloud API.
- Business Verification is required before the number can send messages to general users.

---

## 6. Key Graph API Versions

Use **v19.0** or higher. Always pin the version in API calls; never use `/vX.X/` alias.

```
Base: https://graph.facebook.com/v19.0/
Messaging: POST /{PHONE_NUMBER_ID}/messages
Templates: GET /{WABA_ID}/message_templates
```
