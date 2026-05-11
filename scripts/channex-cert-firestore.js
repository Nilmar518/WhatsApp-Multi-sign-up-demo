#!/usr/bin/env node
/**
 * Channex Certification — Firestore room_types updater
 *
 * Updates the channex_integrations document with all 4 room type / rate plan
 * combinations required for Channex certification (Twin+BAR, Twin+B&B,
 * Double+BAR, Double+B&B).
 *
 * Usage:
 *   node channex-cert-firestore.js \
 *     <firestoreDocId> \
 *     <twinRoomTypeId> <twinBarRatePlanId> <twinBbRatePlanId> \
 *     <doubleRoomTypeId> <doubleBarRatePlanId> <doubleBbRatePlanId>
 *
 * Run from apps/backend/ so .env.secrets is found.
 */

const dotenv = require('dotenv');
dotenv.config();
dotenv.config({ path: '.env.secrets' });

const admin = require('firebase-admin');

// ── Args ──────────────────────────────────────────────────────────────────────

const [
  ,
  ,
  FIRESTORE_DOC_ID,
  TWIN_ROOM_TYPE_ID,
  TWIN_BAR_RATE_PLAN_ID,
  TWIN_BB_RATE_PLAN_ID,
  DOUBLE_ROOM_TYPE_ID,
  DOUBLE_BAR_RATE_PLAN_ID,
  DOUBLE_BB_RATE_PLAN_ID,
] = process.argv;

if (
  !FIRESTORE_DOC_ID ||
  !TWIN_ROOM_TYPE_ID ||
  !TWIN_BAR_RATE_PLAN_ID ||
  !TWIN_BB_RATE_PLAN_ID ||
  !DOUBLE_ROOM_TYPE_ID ||
  !DOUBLE_BAR_RATE_PLAN_ID ||
  !DOUBLE_BB_RATE_PLAN_ID
) {
  console.error('Usage: node channex-cert-firestore.js <firestoreDocId> <twinRoomTypeId> <twinBarRatePlanId> <twinBbRatePlanId> <doubleRoomTypeId> <doubleBarRatePlanId> <doubleBbRatePlanId>');
  process.exit(1);
}

// ── Firebase init ─────────────────────────────────────────────────────────────

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (!privateKey) { console.error('Missing FIREBASE_PRIVATE_KEY'); process.exit(1); }
privateKey = privateKey.replace(/\\n/g, '\n');

if (!process.env.FIREBASE_PROJECT_ID) { console.error('Missing FIREBASE_PROJECT_ID'); process.exit(1); }
if (!process.env.FIREBASE_CLIENT_EMAIL) { console.error('Missing FIREBASE_CLIENT_EMAIL'); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
});

const db = admin.firestore();

// ── Write ─────────────────────────────────────────────────────────────────────

async function updateRoomTypes() {
  const roomTypes = [
    {
      room_type_id: TWIN_ROOM_TYPE_ID,
      title: 'Twin Room',
      default_occupancy: 2,
      rate_plan_id: TWIN_BAR_RATE_PLAN_ID,
    },
    {
      room_type_id: TWIN_ROOM_TYPE_ID,
      title: 'Twin Room',
      default_occupancy: 2,
      rate_plan_id: TWIN_BB_RATE_PLAN_ID,
    },
    {
      room_type_id: DOUBLE_ROOM_TYPE_ID,
      title: 'Double Room',
      default_occupancy: 2,
      rate_plan_id: DOUBLE_BAR_RATE_PLAN_ID,
    },
    {
      room_type_id: DOUBLE_ROOM_TYPE_ID,
      title: 'Double Room',
      default_occupancy: 2,
      rate_plan_id: DOUBLE_BB_RATE_PLAN_ID,
    },
  ];

  const ref = db.collection('channex_integrations').doc(FIRESTORE_DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    console.error(`Document not found: channex_integrations/${FIRESTORE_DOC_ID}`);
    process.exit(1);
  }

  await ref.update({
    room_types: roomTypes,
    updated_at: new Date().toISOString(),
  });

  console.log(`✓ room_types updated in channex_integrations/${FIRESTORE_DOC_ID}`);
  console.log(JSON.stringify(roomTypes, null, 2));
  process.exit(0);
}

updateRoomTypes().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
