import {
  Controller,
  Delete,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * POST /integrations/:businessId/disconnect
   *
   * Gracefully disconnects a WhatsApp integration by resetting the root
   * document's status and nulling out all credentials.  The messages
   * sub-collection is intentionally left intact so conversation history
   * is preserved for when the business reconnects.
   *
   * The frontend's onSnapshot listener fires automatically when status
   * becomes 'IDLE', returning the UI to the onboarding flow.
   */
  @Post(':businessId/disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect(@Param('businessId') businessId: string) {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    // Dot-notation paths update only these fields — the messages sub-collection
    // and all other root-doc fields (e.g. catalog) are untouched.
    await this.firebase.update(docRef, {
      status: 'IDLE',
      'metaData.accessToken': null,
      'metaData.phoneNumberId': null,
      'metaData.wabaId': null,
      'metaData.tokenType': null,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `[INTEGRATION_DISCONNECT] ✓ businessId=${businessId} — credentials cleared, messages preserved`,
    );

    return { disconnected: true, businessId };
  }

  /**
   * DELETE /integrations/:businessId
   *
   * Hard-wipes the Firestore integration document.
   * Kept for development/demo resets only.
   */
  @Delete(':businessId')
  @HttpCode(HttpStatus.OK)
  async reset(@Param('businessId') businessId: string) {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    await docRef.delete();

    this.logger.log(
      `[INTEGRATION_RESET] ✓ Wiped document for businessId=${businessId}`,
    );

    return { reset: true, businessId };
  }
}
