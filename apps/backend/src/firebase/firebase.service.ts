import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import type { Firestore, DocumentReference, SetOptions } from 'firebase-admin/firestore';
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
}
