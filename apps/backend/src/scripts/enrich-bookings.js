/**
 * enrich-bookings.js — Batch Booking Enrichment Script
 *
 * Fetches full booking details from Channex for all reservations that were saved
 * before the enrichment feature was implemented (2026-05-31), identified by:
 *   - rooms_detail is missing/null
 *   - channex_booking_id is present
 *   - booking_status !== 'cancelled'
 *
 * For each booking, calls GET /api/v1/bookings/:id on Channex and merges:
 *   rooms_detail, room_title, customer_phone, customer_email,
 *   customer_country, arrival_hour, is_genius, room_type_id (backfill)
 *
 * Usage:
 *   node apps/backend/src/scripts/enrich-bookings.js
 *   node apps/backend/src/scripts/enrich-bookings.js --tenantId=787167007221172
 *   node apps/backend/src/scripts/enrich-bookings.js --dry-run
 *
 * Options:
 *   --tenantId=ID   Process only this tenant (default: all tenants)
 *   --dry-run       Fetch from Channex but do NOT write to Firestore
 *   --delay=MS      Milliseconds between Channex calls (default: 600)
 *   --limit=N       Max bookings to process (default: unlimited)
 */

'use strict';

const path = require('path');
const https = require('https');
const dotenv = require('dotenv');

// ─── Load env ─────────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.secrets') });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    }),
);

const TARGET_TENANT  = args['tenantId'] || null;
const DRY_RUN        = args['dry-run'] === true || args['dry-run'] === 'true';
const DELAY_MS       = parseInt(args['delay'] || '600', 10);
const LIMIT          = args['limit'] ? parseInt(args['limit'], 10) : Infinity;
const CHANNEX_KEY    = process.env.CHANNEX_API_KEY;
const CHANNEX_BASE   = 'app.channex.io';

if (!CHANNEX_KEY) {
  console.error('[ERROR] CHANNEX_API_KEY not found in .env or .env.secrets');
  process.exit(1);
}

// ─── Firebase init ─────────────────────────────────────────────────────────────
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = admin.firestore();
const INTEGRATIONS = 'channex_integrations';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: CHANNEX_BASE,
      path,
      method:  'GET',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     CHANNEX_KEY,
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchBooking(channexBookingId) {
  const res = await httpsGet(`/api/v1/bookings/${channexBookingId}`);
  if (res.status !== 200) return null;
  return res.body?.data?.attributes ?? null;
}

function buildEnrichment(fullBooking, roomTypeTitleMap) {
  const customer = fullBooking.customer && typeof fullBooking.customer === 'object'
    ? fullBooking.customer : null;
  const meta = fullBooking.meta && typeof fullBooking.meta === 'object'
    ? fullBooking.meta : null;
  const rooms = Array.isArray(fullBooking.rooms) ? fullBooking.rooms : [];

  const enrichment = { updated_at: new Date().toISOString() };

  if (customer?.phone)   enrichment.customer_phone   = customer.phone;
  if (customer?.mail)    enrichment.customer_email    = customer.mail;
  if (customer?.country) enrichment.customer_country  = customer.country;
  if (typeof fullBooking.arrival_hour === 'string') {
    enrichment.arrival_hour = fullBooking.arrival_hour;
  }
  if (typeof meta?.is_genius === 'boolean') {
    enrichment.is_genius = meta.is_genius;
  }

  if (rooms.length > 0) {
    enrichment.rooms_detail = rooms.map(r => {
      const rm = r.meta && typeof r.meta === 'object' ? r.meta : null;
      const rtId = typeof r.room_type_id === 'string' ? r.room_type_id : null;
      return {
        room_type_id:             rtId,
        room_title:               rtId ? (roomTypeTitleMap.get(rtId) ?? null) : null,
        rate_plan_id:             typeof r.rate_plan_id === 'string' ? r.rate_plan_id : null,
        amount:                   r.amount ?? null,
        guests:                   Array.isArray(r.guests) ? r.guests : [],
        room_type_code:           rm?.room_type_code ?? null,
        booking_com_room_index:   rm?.booking_com_room_index ?? null,
        meal_plan:                rm?.meal_plan ?? null,
        smoking_preferences:      rm?.smoking_preferences ?? null,
      };
    });
    const firstRtId = rooms[0]?.room_type_id;
    if (typeof firstRtId === 'string') enrichment.room_type_id = firstRtId;
  }

  return enrichment;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Booking Enrichment Script');
  console.log(`  dry-run  : ${DRY_RUN}`);
  console.log(`  tenantId : ${TARGET_TENANT ?? 'ALL'}`);
  console.log(`  delay    : ${DELAY_MS}ms`);
  console.log(`  limit    : ${isFinite(LIMIT) ? LIMIT : 'unlimited'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Collect tenant IDs to process
  let tenantIds = [];
  if (TARGET_TENANT) {
    tenantIds = [TARGET_TENANT];
  } else {
    const intSnap = await db.collection(INTEGRATIONS).listDocuments();
    tenantIds = intSnap.map(d => d.id);
  }
  console.log(`Tenants to process: ${tenantIds.join(', ')}\n`);

  let totalProcessed = 0;
  let totalEnriched  = 0;
  let totalSkipped   = 0;
  let totalFailed    = 0;

  for (const tenantId of tenantIds) {
    console.log(`\n─── Tenant: ${tenantId} ───────────────────────────────`);

    // Load room type title map for this tenant (all properties)
    const roomTypeTitleMap = new Map();
    const propsSnap = await db
      .collection(INTEGRATIONS).doc(tenantId)
      .collection('properties')
      .get();
    for (const propDoc of propsSnap.docs) {
      const roomTypes = propDoc.data()?.room_types ?? [];
      for (const rt of roomTypes) {
        if (rt.room_type_id && rt.title) {
          roomTypeTitleMap.set(rt.room_type_id, rt.title);
        }
      }
    }
    console.log(`  Room type map: ${roomTypeTitleMap.size} entries`);

    // Query bookings needing enrichment
    const bookingsSnap = await db
      .collection(INTEGRATIONS).doc(tenantId)
      .collection('bookings')
      .get();

    const toEnrich = bookingsSnap.docs.filter(doc => {
      const d = doc.data();
      return (
        d.channex_booking_id &&
        d.booking_status !== 'cancelled' &&
        (!d.rooms_detail || d.rooms_detail.length === 0)
      );
    });

    console.log(`  Bookings needing enrichment: ${toEnrich.length}`);

    for (const doc of toEnrich) {
      if (totalProcessed >= LIMIT) {
        console.log(`\n[LIMIT] Reached limit of ${LIMIT}. Stopping.`);
        break;
      }

      const data = doc.data();
      const channexBookingId = data.channex_booking_id;
      totalProcessed++;

      process.stdout.write(
        `  [${totalProcessed}] ${channexBookingId} (${data.reservation_id ?? '?'}) ... `,
      );

      try {
        const fullBooking = await fetchBooking(channexBookingId);
        if (!fullBooking) {
          console.log('NOT FOUND in Channex — skipped');
          totalSkipped++;
          await sleep(DELAY_MS);
          continue;
        }

        const enrichment = buildEnrichment(fullBooking, roomTypeTitleMap);
        const rooms = enrichment.rooms_detail?.length ?? 0;

        if (DRY_RUN) {
          console.log(`DRY-RUN ✓ (${rooms} rooms, phone=${enrichment.customer_phone ?? '-'})`);
          totalEnriched++;
        } else {
          await db
            .collection(INTEGRATIONS).doc(tenantId)
            .collection('bookings').doc(doc.id)
            .set(enrichment, { merge: true });
          console.log(`✓ enriched (${rooms} rooms, phone=${enrichment.customer_phone ?? '-'})`);
          totalEnriched++;
        }
      } catch (err) {
        console.log(`✗ FAILED: ${err.message}`);
        totalFailed++;
      }

      await sleep(DELAY_MS);
    }

    if (totalProcessed >= LIMIT) break;
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Summary');
  console.log(`  Processed : ${totalProcessed}`);
  console.log(`  Enriched  : ${totalEnriched}`);
  console.log(`  Skipped   : ${totalSkipped}`);
  console.log(`  Failed    : ${totalFailed}`);
  console.log('═══════════════════════════════════════════════════════');

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
