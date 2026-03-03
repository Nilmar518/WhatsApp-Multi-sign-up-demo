const dotenv = require('dotenv');
dotenv.config();
dotenv.config({ path: '.env.secrets' });

const admin = require('firebase-admin');

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
  privateKey = privateKey.replace(/\\n/g, '\n');
} else {
  console.error("Missing FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

if (!process.env.FIREBASE_PROJECT_ID) {
  console.error("Missing FIREBASE_PROJECT_ID");
  process.exit(1);
}

if (!process.env.FIREBASE_CLIENT_EMAIL) {
  console.error("Missing FIREBASE_CLIENT_EMAIL");
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
  console.log("Firebase Admin Initialized");
} catch (err) {
  console.error("Failed to initialize Firebase Admin:", err);
  process.exit(1);
}

const db = admin.firestore();

async function testConnection() {
  try {
    console.log("Testing connection...");
    const snapshot = await db.collection('integrations').limit(1).get();
    console.log('✅ Successfully connected to Firestore!');
    console.log('Integrations found:', snapshot.size);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error connecting to Firestore:', error);
    process.exit(1);
  }
}

testConnection();
