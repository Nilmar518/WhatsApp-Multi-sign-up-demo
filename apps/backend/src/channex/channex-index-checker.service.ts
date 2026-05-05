import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

interface IndexSpec {
  label: string;
  collectionGroup: string;
  field: string;
  testValue: string;
}

// All collectionGroup queries used by the Channex integration.
// Keep this list in sync with firestore.indexes.json fieldOverrides.
const REQUIRED_INDEXES: IndexSpec[] = [
  {
    label: 'properties.channex_property_id (collectionGroup)',
    collectionGroup: 'properties',
    field: 'channex_property_id',
    testValue: '__index_check__',
  },
  {
    label: 'properties.tenant_id (collectionGroup)',
    collectionGroup: 'properties',
    field: 'tenant_id',
    testValue: '__index_check__',
  },
];

@Injectable()
export class ChannexIndexCheckerService implements OnModuleInit {
  private readonly logger = new Logger(ChannexIndexCheckerService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('[INDEX_CHECK] Verifying Firestore collectionGroup indexes…');

    const missing: string[] = [];

    for (const spec of REQUIRED_INDEXES) {
      const ok = await this.checkIndex(spec);
      if (!ok) missing.push(spec.label);
    }

    if (missing.length === 0) {
      this.logger.log('[INDEX_CHECK] ✓ All required Firestore indexes are present.');
      return;
    }

    this.logger.error(
      `[INDEX_CHECK] ✗ Missing Firestore indexes detected (${missing.length}):\n` +
      missing.map((m) => `    - ${m}`).join('\n') + '\n\n' +
      '  To deploy all required indexes run:\n' +
      '    npx firebase-tools deploy --only firestore:indexes --project smart-service-85369\n' +
      '  (definition file: firestore.indexes.json at repo root)\n',
    );
  }

  private async checkIndex(spec: IndexSpec): Promise<boolean> {
    try {
      const db = this.firebase.getFirestore();
      await db
        .collectionGroup(spec.collectionGroup)
        .where(spec.field, '==', spec.testValue)
        .limit(1)
        .get();
      this.logger.log(`[INDEX_CHECK] ✓ ${spec.label}`);
      return true;
    } catch (err: any) {
      // FAILED_PRECONDITION (gRPC code 9) = index missing
      if (err?.code === 9 || String(err?.code) === 'failed-precondition') {
        this.logger.warn(`[INDEX_CHECK] ✗ MISSING — ${spec.label}`);
        return false;
      }
      // Any other error (permissions, network) → don't block startup
      this.logger.warn(
        `[INDEX_CHECK] Could not verify "${spec.label}" — ${err?.message ?? err}`,
      );
      return true;
    }
  }
}
