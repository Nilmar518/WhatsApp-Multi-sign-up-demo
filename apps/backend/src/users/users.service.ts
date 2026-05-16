import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { COUNTRY_DIAL_CODES } from './enums/country.enum';

@Injectable()
export class UsersService {
  private readonly col = 'users';

  constructor(private firebase: FirebaseService) {}

  private generateTempPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const symbols = '!@#$%^&*';
    const all = upper + lower + digits + symbols;
    const max = Math.floor(256 / all.length) * all.length;
    const chars: string[] = [
      upper[crypto.randomBytes(1)[0] % upper.length],
      lower[crypto.randomBytes(1)[0] % lower.length],
      digits[crypto.randomBytes(1)[0] % digits.length],
      symbols[crypto.randomBytes(1)[0] % symbols.length],
    ];
    while (chars.length < 12) {
      const b = crypto.randomBytes(1)[0];
      if (b < max) chars.push(all[b % all.length]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  async create(dto: CreateUserDto) {
    const tempPassword = this.generateTempPassword();
    const authUser = await admin.auth().createUser({
      email: dto.email,
      password: tempPassword,
      displayName: dto.name,
    });
    const uid = authUser.uid;
    const db = this.firebase.getFirestore();
    const ref = db.collection(this.col).doc(uid);
    const now = admin.firestore.Timestamp.now();
    const doc = {
      ...dto,
      uid,
      dialCode: COUNTRY_DIAL_CODES[dto.country],
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.firebase.set(ref, doc);
    return { ...doc, temporaryPassword: tempPassword };
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
    try {
      await admin.auth().deleteUser(uid);
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
    }
    return { deleted: true, uid };
  }
}
