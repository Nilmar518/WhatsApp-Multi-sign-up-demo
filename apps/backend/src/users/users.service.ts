import { Injectable, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { COUNTRY_DIAL_CODES } from './enums/country.enum';

@Injectable()
export class UsersService {
  private readonly col = 'users';

  constructor(private firebase: FirebaseService) {}

  async create(dto: CreateUserDto) {
    const db = this.firebase.getFirestore();
    const ref = db.collection(this.col).doc(dto.uid);
    const now = admin.firestore.Timestamp.now();
    const doc = {
      ...dto,
      dialCode: COUNTRY_DIAL_CODES[dto.country],
      createdAt: now,
      updatedAt: now,
    };
    await this.firebase.set(ref, doc);
    return doc;
  }

  async findAll() {
    const db = this.firebase.getFirestore();
    const snap = await db.collection(this.col).get();
    return snap.docs.map((d) => d.data());
  }

  async findOne(uid: string) {
    const db = this.firebase.getFirestore();
    const snap = await db.collection(this.col).doc(uid).get();
    if (!snap.exists) throw new NotFoundException(`User ${uid} not found`);
    return snap.data()!;
  }

  async update(uid: string, dto: UpdateUserDto) {
    const db = this.firebase.getFirestore();
    const ref = db.collection(this.col).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`User ${uid} not found`);

    const updates: Record<string, unknown> = {
      ...dto,
      updatedAt: admin.firestore.Timestamp.now(),
    };
    if (dto.country) updates['dialCode'] = COUNTRY_DIAL_CODES[dto.country];

    await this.firebase.update(ref, updates);
    return { ...(snap.data() as object), ...updates };
  }

  async remove(uid: string) {
    const db = this.firebase.getFirestore();
    const ref = db.collection(this.col).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`User ${uid} not found`);
    await ref.delete();
    return { deleted: true, uid };
  }
}
