import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import type { Firestore, DocumentReference, SetOptions, Query, QuerySnapshot } from 'firebase-admin/firestore';
import { SecretManagerService } from '../common/secrets/secret-manager.service';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firestore: Firestore;

  constructor(
    private config: ConfigService,
    private secrets: SecretManagerService,
  ) {}

  onModuleInit() {
    if (!admin.apps.length) {
      const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
      admin.initializeApp({
        projectId,
        credential: admin.credential.cert({
          projectId,
          clientEmail: this.secrets.get('FIREBASE_CLIENT_EMAIL'),
          privateKey: this.secrets.get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
        }),
      });
      this.logger.log(
        `[Firebase] Admin SDK initialized for project: ${this.config.get<string>('FIREBASE_PROJECT_ID')}`,
      );
    }
    this.firestore = admin.firestore();
  }

  getFirestore(): Firestore {
    return this.firestore;
  }

  // ── Safe write wrappers ────────────────────────────────────────────────────
  // Every Firestore write goes through these methods so that PERMISSION_DENIED
  // and other Firestore error codes are logged together with the project ID
  // before the error is re-thrown to the caller.

  async set(
    ref: DocumentReference,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
    options?: SetOptions,
  ): Promise<void> {
    try {
      await (options ? ref.set(data, options) : ref.set(data));
    } catch (err: any) {
      this.logger.error(
        `[FIRESTORE_WRITE_ERROR] set failed — code=${err?.code ?? 'unknown'} project=${this.config.get<string>('FIREBASE_PROJECT_ID')} path=${ref.path}`,
      );
      throw err;
    }
  }

  async update(
    ref: DocumentReference,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
  ): Promise<void> {
    try {
      await ref.update(data);
    } catch (err: any) {
      this.logger.error(
        `[FIRESTORE_WRITE_ERROR] update failed — code=${err?.code ?? 'unknown'} project=${this.config.get<string>('FIREBASE_PROJECT_ID')} path=${ref.path}`,
      );
      throw err;
    }
  }

  // Wraps any Firestore query .get() so that missing-index errors (which embed
  // the index creation URL inside err.message) are fully logged before re-throw.
  async queryGet(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: Query<any>,
    context: string,
  ): Promise<QuerySnapshot> {
    try {
      return await query.get();
    } catch (err: any) {
      // The gRPC transport used by the Admin SDK does NOT include the index
      // creation URL in err.message — it lives in the status details trailer.
      // We serialize the full error object so nothing is lost.
      let details = '';
      try {
        details = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
      } catch {
        details = String(err);
      }

      this.logger.error(
        `[FIRESTORE_QUERY_ERROR] ${context}\n` +
        `  code   : ${err?.code ?? 'unknown'}\n` +
        `  message: ${err?.message ?? ''}\n` +
        `  details: ${err?.details ?? ''}\n` +
        `  project: ${this.config.get<string>('FIREBASE_PROJECT_ID')}\n` +
        `  full   : ${details}`,
      );
      throw err;
    }
  }
}
