/**
 * check-permissions.js — Meta Token Pre-flight Verification
 *
 * Runs automatically before `pnpm dev` via the `predev` script.
 * Validates that the configured Meta System User token has all the permissions
 * required for Catalog CRUD and WhatsApp Business operations.
 *
 * Exit codes:
 * 0 — all required scopes present (or check inconclusive due to network)
 * 1 — one or more required scopes are MISSING (definitive API response)
 *
 * Network errors / missing credentials cause a warning but do NOT block startup
 * so that offline development is unaffected.
 */

'use strict';

const path = require('path');
const https = require('https');
const dotenv = require('dotenv');

// ── Env loading ──────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '../../');

// Load standard .env, then explicitly load .env.secrets to override/append
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.secrets') });

// ── Config ───────────────────────────────────────────────────────────────────

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const SYSTEM_TOKEN = process.env.META_SYSTEM_USER_TOKEN;

const REQUIRED_SCOPES = [
  'business_management',
  'catalog_management',
  'whatsapp_business_management',
];

// ads_management is desired but sometimes not required for basic catalog ops
const DESIRED_SCOPES = ['ads_management'];

// ── Console helpers ──────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

function log(msg)  { process.stdout.write(msg + '\n'); }
function ok(msg)   { log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { log(`  ${AMBER}⚠${RESET} ${msg}`); }
function fail(msg) { log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { log(`  ${DIM}·${RESET} ${msg}`); }

// ── HTTP helper (no axios dependency in script context) ───────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data }); }
      });
    }).on('error', reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log(`${BOLD}[PRE-FLIGHT] Meta Permission Check${RESET}`);
  log(`${DIM}${'─'.repeat(45)}${RESET}`);

  // ── Guard: credentials must be present ──────────────────────────────────

  if (!SYSTEM_TOKEN) {
    warn('META_SYSTEM_USER_TOKEN not found in .env.secrets.');
    warn('Skipping scope check — continuing startup.');
    log('');
    process.exit(0);
  }

  // App ID and Secret are still required to authenticate the debug_token request itself
  if (!APP_ID || !APP_SECRET) {
    warn('META_APP_ID or META_APP_SECRET missing. Required to authenticate the debug check.');
    warn('Skipping scope check — continuing startup.');
    log('');
    process.exit(0);
  }

  // Print first 10 characters to confirm the correct token is loaded
  info(`Verifying System User Token: ${SYSTEM_TOKEN.substring(0, 10)}...`);

  // ── Build access token and call debug_token ──────────────────────────────

  const appToken = encodeURIComponent(`${APP_ID}|${APP_SECRET}`);
  const inputToken = encodeURIComponent(SYSTEM_TOKEN);
  
  const debugUrl =
    `https://graph.facebook.com/v25.0/debug_token` +
    `?input_token=${inputToken}` +
    `&access_token=${appToken}`;

  let debugData;
  try {
    const resp = await httpsGet(debugUrl);
    debugData = resp.data;
  } catch (err) {
    warn(`Could not reach Meta API: ${err.message}`);
    warn('Skipping scope check — continuing startup.');
    log('');
    process.exit(0);
  }

  if (!debugData) {
    warn('Unexpected response from debug_token endpoint. Skipping scope check.');
    log('');
    process.exit(0);
  }

  // ── Validity check ───────────────────────────────────────────────────────

  if (!debugData.is_valid) {
    fail(`System User Token is INVALID.`);
    if (debugData.error) {
      fail(`Meta error: ${debugData.error.message}`);
    }
    log('');
    process.exit(1);
  }

  ok(`Token is valid (type: ${debugData.type ?? 'UNKNOWN'})`);

  // ── Scope check ──────────────────────────────────────────────────────────

  const grantedScopes = Array.isArray(debugData.scopes) ? debugData.scopes : [];
  info(`Granted scopes: ${grantedScopes.length ? grantedScopes.join(', ') : '(none)'}`);

  const missing = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));
  const missingDesired = DESIRED_SCOPES.filter((s) => !grantedScopes.includes(s));

  for (const scope of REQUIRED_SCOPES) {
    if (grantedScopes.includes(scope)) {
      ok(`${scope}`);
    } else {
      fail(`${scope} — MISSING`);
    }
  }

  for (const scope of DESIRED_SCOPES) {
    if (grantedScopes.includes(scope)) {
      ok(`${scope}`);
    } else {
      warn(`${scope} — not granted (desired but not required)`);
    }
  }

  log(`${DIM}${'─'.repeat(45)}${RESET}`);

  // ── Result ───────────────────────────────────────────────────────────────

  if (missing.length > 0) {
    log('');
    log(`${RED}${BOLD}[PRE-FLIGHT FAILED]${RESET} Missing required Meta permissions:`);
    for (const s of missing) fail(s);
    log('');
    log(`${AMBER}Action required:${RESET}`);
    log('  1. Open Meta Business Suite → Settings → System Users');
    log('  2. Select your System User → click "Generate New Token"');
    log('  3. Ensure you select the following permissions in the token dialog:');
    for (const s of missing) log(`       • ${s}`);

    if (missing.includes('catalog_management')) {
      log('');
      log(`${AMBER}  catalog_management requires an extra step:${RESET}`);
      log('  ┌─ In Meta Business Suite:');
      log('  │   a. Settings → System Users → select your System User');
      log('  │   b. Click "Add Assets" → choose "Catalogs"');
      log('  │   c. Select your catalog → grant "Manage catalog" permission');
      log('  │   d. Save, then generate a new token with catalog_management checked');
      log('  └─ If no catalog exists yet, create one first in Commerce Manager.');
    }

    log('');
    log('  After updating the token:');
    log('  • Paste the new token into META_SYSTEM_USER_TOKEN in .env.secrets');
    log('  • Restart the dev server (pnpm dev)');
    log('');
    process.exit(1);
  }

  if (missingDesired.length > 0) {
    warn(`Optional scope(s) not granted: ${missingDesired.join(', ')}`);
  }

  log(`${GREEN}${BOLD}[PRE-FLIGHT PASSED]${RESET} All required permissions are present.`);
  log('');
  process.exit(0);
}

main().catch((err) => {
  warn(`Unexpected pre-flight error: ${err.message}`);
  warn('Continuing startup despite check failure.');
  log('');
  process.exit(0);
});