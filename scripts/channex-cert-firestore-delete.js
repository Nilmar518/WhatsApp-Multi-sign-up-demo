#!/usr/bin/env node
/**
 * Deletes a channex_integrations document from Firestore.
 *
 * Usage (by Firestore doc ID):
 *   node channex-cert-firestore-delete.js <firestoreDocId>
 *
 * Usage (by Channex property ID — discovery fallback):
 *   node channex-cert-firestore-delete.js --by-property-id <channexPropertyId>
 *
 * Run from apps/backend/ so .env.secrets is found.
 */

const dotenv = require('dotenv');
dotenv.config();
dotenv.config({ path: '.env.secrets' });

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const BY_PROPERTY_ID = args[0] === '--by-property-id';
const ID_VALUE = BY_PROPERTY_ID ? args[1] : args[0];

if (!ID_VALUE) {
  console.error('Usage:');
  console.error('  node channex-cert-firestore-delete.js <firestoreDocId>');
  console.error('  node channex-cert-firestore-delete.js --by-property-id <channexPropertyId>');
  process.exit(1);
}

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

async function deleteByDocId(docId) {
  const ref = db.collection('channex_integrations').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  ! Document channex_integrations/${docId} not found — already deleted?`);
    process.exit(0);
  }
  await ref.delete();
  console.log(`  ✓ Deleted channex_integrations/${docId}`);
}

async function deleteByPropertyId(channexPropertyId) {
  const snapshot = await db
    .collection('channex_integrations')
    .where('channex_property_id', '==', channexPropertyId)
    .get();

  if (snapshot.empty) {
    console.log(`  ! No Firestore document found for channex_property_id=${channexPropertyId}`);
    process.exit(0);
  }

  let deleted = 0;
  for (const doc of snapshot.docs) {
    await doc.ref.delete();
    console.log(`  ✓ Deleted channex_integrations/${doc.id}`);
    deleted++;
  }
  console.log(`  ✓ Total deleted: ${deleted}`);
}

const run = BY_PROPERTY_ID
  ? deleteByPropertyId(ID_VALUE)
  : deleteByDocId(ID_VALUE);

run
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('  ✗ Error:', err.message);
    process.exit(1);
  });
