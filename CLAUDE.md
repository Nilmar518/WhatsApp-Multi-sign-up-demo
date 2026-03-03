# Standard Operating Procedure (SOP)

This project follows specific rules defined in the `.cursor/rules/` directory.

## Project Rules Reference
When working on this project, adhere strictly to the guidelines defined in our granular rules system:

### Coding Standards
- **NestJS:** See `.cursor/rules/coding-standards/nestjs.mdc`
- **React:** See `.cursor/rules/coding-standards/react.mdc`

### Integrations
- **Meta API:** See `.cursor/rules/integrations/meta-api.mdc`

### Firebase
- **Firestore Conventions:** See `.cursor/rules/firebase/firestore-conventions.mdc`

### Infrastructure
- **Node & pnpm:** See `.cursor/rules/infrastructure/node-pnpm.mdc`

## Development Planning
- **Roadmap:** High-level project milestones are tracked in `.planning/roadmap.md`.
- **Tasks:** Granular sub-issue tracking is maintained in `.planning/tasks.md`.

Always consult these documents to ensure best practices, architectural alignment, and appropriate conventions are maintained throughout development.

---

## ngrok SOP — Keeping Webhook URLs Synchronized

ngrok generates a new public URL every time it restarts. Failure to update both the `.env` and the Meta App Dashboard will cause webhook verification and inbound message delivery to fail silently.

### Every time ngrok is restarted:

**Step 1 — Get the new URL**
```bash
# The URL is printed in the ngrok terminal, or query it:
curl http://localhost:4040/api/tunnels | jq '.tunnels[0].public_url'
```

**Step 2 — Update the backend `.env`**
```bash
# apps/backend/.env
NGROK_URL=https://xxxx-xx-xx-xx-xx.ngrok-free.app
```
Then restart the NestJS dev server so the new value is loaded.

**Step 3 — Re-register the webhook in Meta App Dashboard**
1. Go to [Meta App Dashboard](https://developers.facebook.com/apps/) → your app → **WhatsApp → Configuration**
2. Under **Webhook**, click **Edit**
3. Set **Callback URL** to `{NGROK_URL}/webhook`
4. Set **Verify token** to the value in `META_WEBHOOK_VERIFY_TOKEN`
5. Click **Verify and Save** — the backend will log `[WEBHOOK_VERIFY] ✓`
6. Under **Webhook fields**, ensure `messages` is subscribed

### Testing without restarting ngrok
Use the curl commands in `docs/TESTING.md` to mock inbound events against `http://localhost:3001/webhook` directly — no ngrok needed for local integration tests.

---

## GCP Secret Manager — Emulator & Production Swap

### How it works (development)

`SecretManagerService` (`src/common/secrets/secret-manager.service.ts`) emulates GCP Secret Manager:

1. On startup it reads `.env.secrets` (if present) and stores all key-value pairs in memory
2. Every call to `secrets.get('SECRET_NAME')` logs `[GCP-SECRET-EMULATOR] Accessing secret: SECRET_NAME`
3. Falls back to `process.env` if the key is not found in `.env.secrets`

**Priority:** `.env.secrets` → `process.env` (via `.env`)

Sensitive keys managed by this service: `META_APP_ID`, `META_APP_SECRET`, `FIREBASE_PRIVATE_KEY`, `META_BUSINESS_ID`, `META_SYSTEM_USER_ID`.

### Setup for local development

```bash
# Copy the template and fill in real credentials
cp apps/backend/.env.secrets.example apps/backend/.env.secrets
# Edit .env.secrets — it is gitignored, never commit it
```

### Production swap (GCP deployment)

Replace `SecretManagerService.get()` body with a call to `@google-cloud/secret-manager`:

```typescript
// Install: pnpm --filter @migo-uit/backend add @google-cloud/secret-manager
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

async get(secretName: string): Promise<string | undefined> {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
  });
  return version.payload?.data?.toString();
}
```

**No other code changes are required** — all services that inject `SecretManagerService` call `.get()` and are unaffected by the swap.
