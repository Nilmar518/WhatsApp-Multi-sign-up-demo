import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateMigoPropertyDto } from './dto/create-migo-property.dto';
import { UpdateMigoPropertyDto } from './dto/update-migo-property.dto';
import { AssignConnectionDto } from './dto/assign-connection.dto';
import {
  MIGO_PROPERTY_EVENTS,
  type MigoPropertyAvailabilityAlertEvent,
} from '../channex/channex.types';

const COLLECTION = 'migo_properties';

export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
}

export interface MigoPropertyDoc {
  id: string;
  tenant_id: string;
  title: string;
  total_units: number;
  current_availability: number;
  alert_threshold: number;
  platform_connections: PlatformConnection[];
  created_at: string;
  updated_at: string;
}

@Injectable()
export class MigoPropertyService {
  private readonly logger = new Logger(MigoPropertyService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createPropertyType(dto: CreateMigoPropertyDto): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc();
    const now = new Date().toISOString();
    const doc: MigoPropertyDoc = {
      id: ref.id,
      tenant_id: dto.tenantId,
      title: dto.title,
      total_units: dto.total_units,
      current_availability: dto.total_units,
      alert_threshold: dto.alert_threshold ?? 0,
      platform_connections: [],
      created_at: now,
      updated_at: now,
    };
    await this.firebase.set(ref, doc as unknown as Record<string, unknown>);
    this.logger.log(
      `[MIGO-PROPERTY] Created — id=${ref.id} title="${dto.title}" units=${dto.total_units}`,
    );
    return doc;
  }

  async listPropertyTypes(tenantId: string): Promise<MigoPropertyDoc[]> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection(COLLECTION)
      .where('tenant_id', '==', tenantId)
      .orderBy('created_at', 'desc')
      .get();
    return snap.docs.map((d) => d.data() as MigoPropertyDoc);
  }

  async getPropertyType(migoPropertyId: string): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection(COLLECTION).doc(migoPropertyId).get();
    if (!snap.exists) {
      throw new NotFoundException(`MigoProperty not found: ${migoPropertyId}`);
    }
    return snap.data() as MigoPropertyDoc;
  }

  async updatePropertyType(
    migoPropertyId: string,
    dto: UpdateMigoPropertyDto,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.total_units !== undefined) patch.total_units = dto.total_units;
    if (dto.alert_threshold !== undefined) patch.alert_threshold = dto.alert_threshold;
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), patch);
    return { ...doc, ...patch } as MigoPropertyDoc;
  }

  async deletePropertyType(migoPropertyId: string): Promise<void> {
    const doc = await this.getPropertyType(migoPropertyId);
    if (doc.platform_connections.length > 0) {
      const ids = doc.platform_connections
        .map((c) => c.channex_property_id)
        .join(', ');
      throw new BadRequestException(
        `Cannot delete property type with active connections: ${ids}`,
      );
    }
    const db = this.firebase.getFirestore();
    await db.collection(COLLECTION).doc(migoPropertyId).delete();
    this.logger.log(`[MIGO-PROPERTY] Deleted — id=${migoPropertyId}`);
  }

  async assignConnection(
    migoPropertyId: string,
    dto: AssignConnectionDto,
  ): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();

    const propSnap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', dto.channexPropertyId)
      .limit(1)
      .get();
    if (propSnap.empty) {
      throw new NotFoundException(
        `Channex property not found: ${dto.channexPropertyId}`,
      );
    }

    const doc = await this.getPropertyType(migoPropertyId);
    const alreadyConnected = doc.platform_connections.some(
      (c) => c.channex_property_id === dto.channexPropertyId,
    );
    if (alreadyConnected) return doc;

    const newConnection: PlatformConnection = {
      platform: dto.platform,
      channex_property_id: dto.channexPropertyId,
      listing_title: dto.listingTitle,
      is_sync_enabled: dto.isSyncEnabled ?? true,
    };

    const updatedConnections = [...doc.platform_connections, newConnection];
    const now = new Date().toISOString();

    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });

    await this.firebase.update(propSnap.docs[0].ref, {
      migo_property_id: migoPropertyId,
    });

    this.logger.log(
      `[MIGO-PROPERTY] Connection assigned — migoPropertyId=${migoPropertyId} ` +
        `channexPropertyId=${dto.channexPropertyId}`,
    );

    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  async removeConnection(
    migoPropertyId: string,
    channexPropertyId: string,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const updatedConnections = doc.platform_connections.filter(
      (c) => c.channex_property_id !== channexPropertyId,
    );
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();

    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });

    const propSnap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();
    if (!propSnap.empty) {
      await this.firebase.update(propSnap.docs[0].ref, { migo_property_id: null });
    }

    this.logger.log(
      `[MIGO-PROPERTY] Connection removed — migoPropertyId=${migoPropertyId} ` +
        `channexPropertyId=${channexPropertyId}`,
    );

    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  async toggleSync(
    migoPropertyId: string,
    channexPropertyId: string,
    enabled: boolean,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const updatedConnections = doc.platform_connections.map((c) =>
      c.channex_property_id === channexPropertyId
        ? { ...c, is_sync_enabled: enabled }
        : c,
    );
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });
    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  async decrementAvailability(migoPropertyId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc(migoPropertyId);
    const initial = await ref.get();
    if (!initial.exists) {
      this.logger.warn(
        `[MIGO-PROPERTY] decrementAvailability — doc not found: ${migoPropertyId}`,
      );
      return;
    }
    await this.firebase.update(ref, {
      current_availability: FieldValue.increment(-1),
    });
    const updated = await ref.get();
    const data = updated.data() as MigoPropertyDoc;
    const newAvailability = data.current_availability;
    this.logger.log(
      `[MIGO-PROPERTY] Availability decremented — id=${migoPropertyId} availability=${newAvailability}`,
    );

    if (newAvailability <= (data.alert_threshold ?? 0)) {
      const alertPayload: MigoPropertyAvailabilityAlertEvent = {
        tenantId: data.tenant_id,
        migoPropertyId,
        title: data.title,
        current_availability: newAvailability,
        timestamp: new Date().toISOString(),
      };
      this.eventEmitter.emit(MIGO_PROPERTY_EVENTS.AVAILABILITY_ALERT, alertPayload);
      this.logger.warn(
        `[MIGO-PROPERTY] Availability alert — id=${migoPropertyId} ` +
          `title="${data.title}" availability=${newAvailability}`,
      );
    }
  }

  async incrementAvailability(migoPropertyId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc(migoPropertyId);
    const snap = await ref.get();
    if (!snap.exists) {
      this.logger.warn(
        `[MIGO-PROPERTY] incrementAvailability — doc not found: ${migoPropertyId}`,
      );
      return;
    }
    await this.firebase.update(ref, {
      current_availability: FieldValue.increment(1),
    });
    this.logger.log(
      `[MIGO-PROPERTY] Availability incremented — id=${migoPropertyId}`,
    );
  }

  async resetAvailability(migoPropertyId: string): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      current_availability: doc.total_units,
      updated_at: now,
    });
    return { ...doc, current_availability: doc.total_units, updated_at: now };
  }
}
