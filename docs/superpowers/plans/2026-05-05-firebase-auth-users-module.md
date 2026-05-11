# Firebase Auth + Users Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Authentication (email/password) with a global NestJS JWT guard, a full Firestore `users` CRUD module, and an isolated login screen on the frontend that gates all routes.

**Architecture:** A global `FirebaseAuthGuard` (APP_GUARD) protects all backend endpoints by default; `@Public()` opt-outs are applied to webhook and OAuth-callback routes that are called by third parties without a Bearer token. The frontend patches `window.fetch` inside `AuthGate` so that every `/api/*` request automatically carries the Firebase ID token — zero changes required to the 16 existing API files.

**Tech Stack:** NestJS (APP_GUARD, Reflector, firebase-admin), Firebase Web SDK v10 (`getAuth`, `onAuthStateChanged`, `signInWithEmailAndPassword`), Tailwind CSS, TypeScript, Firestore.

---

## Task 1: FirebaseAuthGuard infrastructure (backend)

**Files:**
- Create: `apps/backend/src/auth-guard/public.decorator.ts`
- Create: `apps/backend/src/auth-guard/firebase-auth.guard.ts`
- Create: `apps/backend/src/auth-guard/auth-guard.module.ts`

- [ ] **Step 1.1: Create @Public() decorator**

```typescript
// apps/backend/src/auth-guard/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 1.2: Create FirebaseAuthGuard**

```typescript
// apps/backend/src/auth-guard/firebase-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const authHeader = req['headers'] as Record<string, string | undefined>;
    const authorization = authHeader['authorization'];

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authorization.slice(7);
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req['user'] = { uid: decoded.uid, email: decoded.email ?? '' };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }
  }
}
```

- [ ] **Step 1.3: Create AuthGuardModule**

```typescript
// apps/backend/src/auth-guard/auth-guard.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: FirebaseAuthGuard,
    },
  ],
})
export class AuthGuardModule {}
```

- [ ] **Step 1.4: Commit**

```bash
git add apps/backend/src/auth-guard/
git commit -m "feat(auth-guard): add FirebaseAuthGuard with @Public() decorator"
```

---

## Task 2: Apply @Public() to all webhook and OAuth-callback endpoints

**Files:**
- Modify: `apps/backend/src/webhook/webhook.controller.ts`
- Modify: `apps/backend/src/channex/channex-webhook.controller.ts`
- Modify: `apps/backend/src/integrations/instagram/instagram-integration.controller.ts`

**Why these three:** `WebhookController` receives Meta events for WhatsApp/Messenger/Instagram. `ChannexWebhookController` receives Channex events for Airbnb and Booking.com. The Instagram `oauth-callback` is redirected to by Instagram's OAuth flow — no Bearer token is present.

- [ ] **Step 2.1: Mark WebhookController public**

Open `apps/backend/src/webhook/webhook.controller.ts`.

Add import at the top (after existing imports):
```typescript
import { Public } from '../auth-guard/public.decorator';
```

Add `@Public()` decorator directly above `@Controller('webhook')`:
```typescript
@Public()
@Controller('webhook')
export class WebhookController {
```

- [ ] **Step 2.2: Mark ChannexWebhookController public**

Open `apps/backend/src/channex/channex-webhook.controller.ts`.

Add import:
```typescript
import { Public } from '../auth-guard/public.decorator';
```

Add `@Public()` above `@Controller('channex/webhook')`:
```typescript
@Public()
@Controller('channex/webhook')
export class ChannexWebhookController {
```

- [ ] **Step 2.3: Mark Instagram oauth-callback public (method-level)**

Open `apps/backend/src/integrations/instagram/instagram-integration.controller.ts`.

Add import:
```typescript
import { Public } from '../../auth-guard/public.decorator';
```

Add `@Public()` on the `oauthCallback` method only (not the whole controller):
```typescript
@Get('oauth-callback')
@Public()
async oauthCallback(
```

- [ ] **Step 2.4: Commit**

```bash
git add apps/backend/src/webhook/webhook.controller.ts \
        apps/backend/src/channex/channex-webhook.controller.ts \
        apps/backend/src/integrations/instagram/instagram-integration.controller.ts
git commit -m "feat(auth-guard): apply @Public() to webhook and OAuth-callback endpoints"
```

---

## Task 3: Users enums — CountryCode and UserRole

**Files:**
- Create: `apps/backend/src/users/enums/country.enum.ts`
- Create: `apps/backend/src/users/enums/user-role.enum.ts`

- [ ] **Step 3.1: Create CountryCode enum with dial codes**

```typescript
// apps/backend/src/users/enums/country.enum.ts

export enum CountryCode {
  AR = 'AR',
  BO = 'BO',
  BR = 'BR',
  CL = 'CL',
  CO = 'CO',
  CR = 'CR',
  EC = 'EC',
  MX = 'MX',
  PE = 'PE',
  PY = 'PY',
  UY = 'UY',
  VE = 'VE',
  US = 'US',
  ES = 'ES',
}

export const COUNTRY_DIAL_CODES: Record<CountryCode, string> = {
  [CountryCode.AR]: '+54',
  [CountryCode.BO]: '+591',
  [CountryCode.BR]: '+55',
  [CountryCode.CL]: '+56',
  [CountryCode.CO]: '+57',
  [CountryCode.CR]: '+506',
  [CountryCode.EC]: '+593',
  [CountryCode.MX]: '+52',
  [CountryCode.PE]: '+51',
  [CountryCode.PY]: '+595',
  [CountryCode.UY]: '+598',
  [CountryCode.VE]: '+58',
  [CountryCode.US]: '+1',
  [CountryCode.ES]: '+34',
};

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  [CountryCode.AR]: 'Argentina',
  [CountryCode.BO]: 'Bolivia',
  [CountryCode.BR]: 'Brasil',
  [CountryCode.CL]: 'Chile',
  [CountryCode.CO]: 'Colombia',
  [CountryCode.CR]: 'Costa Rica',
  [CountryCode.EC]: 'Ecuador',
  [CountryCode.MX]: 'México',
  [CountryCode.PE]: 'Perú',
  [CountryCode.PY]: 'Paraguay',
  [CountryCode.UY]: 'Uruguay',
  [CountryCode.VE]: 'Venezuela',
  [CountryCode.US]: 'Estados Unidos',
  [CountryCode.ES]: 'España',
};
```

- [ ] **Step 3.2: Create UserRole enum**

```typescript
// apps/backend/src/users/enums/user-role.enum.ts

export enum UserRole {
  CUSTOMER = 'customer',
  ADMIN = 'admin',
  OWNER = 'owner',
}
```

- [ ] **Step 3.3: Commit**

```bash
git add apps/backend/src/users/
git commit -m "feat(users): add CountryCode and UserRole enums"
```

---

## Task 4: Users DTOs

**Files:**
- Create: `apps/backend/src/users/dto/create-user.dto.ts`
- Create: `apps/backend/src/users/dto/update-user.dto.ts`

- [ ] **Step 4.1: Create CreateUserDto**

```typescript
// apps/backend/src/users/dto/create-user.dto.ts
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';
import { CountryCode } from '../enums/country.enum';
import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  uid: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'phone must be 6–15 digits, no country code' })
  phone: string;

  @IsEnum(CountryCode)
  country: CountryCode;

  @IsEnum(UserRole)
  role: UserRole;
}
```

- [ ] **Step 4.2: Create UpdateUserDto**

```typescript
// apps/backend/src/users/dto/update-user.dto.ts
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { CountryCode } from '../enums/country.enum';
import { UserRole } from '../enums/user-role.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'phone must be 6–15 digits, no country code' })
  phone?: string;

  @IsOptional()
  @IsEnum(CountryCode)
  country?: CountryCode;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
```

- [ ] **Step 4.3: Commit**

```bash
git add apps/backend/src/users/dto/
git commit -m "feat(users): add CreateUserDto and UpdateUserDto"
```

---

## Task 5: UsersService

**Files:**
- Create: `apps/backend/src/users/users.service.ts`

- [ ] **Step 5.1: Create UsersService**

```typescript
// apps/backend/src/users/users.service.ts
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
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/backend/src/users/users.service.ts
git commit -m "feat(users): add UsersService with Firestore CRUD"
```

---

## Task 6: UsersController + UsersModule

**Files:**
- Create: `apps/backend/src/users/users.controller.ts`
- Create: `apps/backend/src/users/users.module.ts`

- [ ] **Step 6.1: Create UsersController**

```typescript
// apps/backend/src/users/users.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':uid')
  findOne(@Param('uid') uid: string) {
    return this.users.findOne(uid);
  }

  @Patch(':uid')
  update(@Param('uid') uid: string, @Body() dto: UpdateUserDto) {
    return this.users.update(uid, dto);
  }

  @Delete(':uid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uid') uid: string) {
    return this.users.remove(uid);
  }
}
```

- [ ] **Step 6.2: Create UsersModule**

```typescript
// apps/backend/src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6.3: Commit**

```bash
git add apps/backend/src/users/users.controller.ts \
        apps/backend/src/users/users.module.ts
git commit -m "feat(users): add UsersController and UsersModule"
```

---

## Task 7: Register AuthGuardModule + UsersModule in AppModule

**Files:**
- Modify: `apps/backend/src/app.module.ts`

⚠️ **This step activates the global guard.** All frontend API calls will return 401 until the frontend changes (Tasks 9–11) are also deployed/running. If testing incrementally, do the frontend tasks first, then this task.

- [ ] **Step 7.1: Add imports to AppModule**

Open `apps/backend/src/app.module.ts`.

Add imports after the existing import block:
```typescript
import { AuthGuardModule } from './auth-guard/auth-guard.module';
import { UsersModule } from './users/users.module';
```

Add to the `imports` array (after `BookingModule`):
```typescript
    // Auth guard — global JWT verification via Firebase Admin
    AuthGuardModule,
    // Users CRUD — Firestore users collection
    UsersModule,
```

- [ ] **Step 7.2: Verify the backend compiles**

```bash
pnpm --filter @migo-uit/backend build
```

Expected: no TypeScript errors. If there are errors, fix them before continuing.

- [ ] **Step 7.3: Commit**

```bash
git add apps/backend/src/app.module.ts
git commit -m "feat(auth-guard): register global FirebaseAuthGuard and UsersModule"
```

---

## Task 8: META_SYSTEM_USER_TOKEN toggle

**Files:**
- Modify: `apps/backend/.env.secrets.example`

The existing services already fall back to `integrationAccessToken` when `META_SYSTEM_USER_TOKEN` is absent (`this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken`). Commenting the line in `.env.secrets` is all that's needed to disable the system user token.

- [ ] **Step 8.1: Add toggle block to .env.secrets.example**

Open `apps/backend/.env.secrets.example`.

Find the `META_SYSTEM_USER_TOKEN` line. Replace it with:

```bash
# ── Meta System User Token ────────────────────────────────────────────────────
# DISABLE system user token (falls back to per-integration token):
#   comment the META_SYSTEM_USER_TOKEN line below
# ENABLE system user token:
#   uncomment the META_SYSTEM_USER_TOKEN line below
META_SYSTEM_USER_TOKEN=your_permanent_system_user_token_here
# ─────────────────────────────────────────────────────────────────────────────
```

Do the same in your local `apps/backend/.env.secrets` file (not committed).

- [ ] **Step 8.2: Commit**

```bash
git add apps/backend/.env.secrets.example
git commit -m "docs(secrets): add enable/disable toggle comment for META_SYSTEM_USER_TOKEN"
```

---

## Task 9: Export Firebase Auth from frontend firebase.ts

**Files:**
- Modify: `apps/frontend/src/firebase/firebase.ts`

- [ ] **Step 9.1: Add getAuth export**

Current file:
```typescript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = { ... };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```

New file (add `getAuth` import and export):
```typescript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

- [ ] **Step 9.2: Commit**

```bash
git add apps/frontend/src/firebase/firebase.ts
git commit -m "feat(frontend/auth): export Firebase Auth instance"
```

---

## Task 10: LoginPage + AuthGate components

**Files:**
- Create: `apps/frontend/src/auth/LoginPage.tsx`
- Create: `apps/frontend/src/auth/AuthGate.tsx`

The AuthGate patches `window.fetch` once on mount so that every `/api/*` request automatically carries the Firebase ID token. This avoids touching any of the 16 existing files that call `fetch()`.

- [ ] **Step 10.1: Create LoginPage**

```tsx
// apps/frontend/src/auth/LoginPage.tsx
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/firebase';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError('Credenciales inválidas. Verifica tu correo y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-green-500 mb-4">
            <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white">WhatsApp Multi Sign-Up</h1>
          <p className="text-sm text-gray-400 mt-1">Ingresa a tu cuenta</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-800 rounded-2xl p-6 space-y-4 shadow-xl ring-1 ring-white/5"
        >
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors"
              placeholder="correo@empresa.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950/60 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-400 active:bg-green-600 disabled:bg-green-900 disabled:text-green-600 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Iniciando sesión…
              </span>
            ) : (
              'Iniciar sesión'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Create AuthGate**

```tsx
// apps/frontend/src/auth/AuthGate.tsx
import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import LoginPage from './LoginPage';

interface Props {
  children: React.ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Patch window.fetch once so every /api/* call carries the Firebase ID token.
    // This avoids modifying each of the existing API files individually.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('/api') && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return originalFetch(input, { ...(init as RequestInit), headers });
      }
      return originalFetch(input, init as RequestInit);
    };

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => {
      unsub();
      window.fetch = originalFetch;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <>{children}</>;
}
```

- [ ] **Step 10.3: Commit**

```bash
git add apps/frontend/src/auth/
git commit -m "feat(frontend/auth): add LoginPage and AuthGate with fetch interceptor"
```

---

## Task 11: Wrap main.tsx with AuthGate

**Files:**
- Modify: `apps/frontend/src/main.tsx`

- [ ] **Step 11.1: Add AuthGate import and wrap render**

Current `main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import './index.css';

const isCatalogManager = window.location.pathname.startsWith('/catalog-manager');
const isInventory       = window.location.pathname.startsWith('/inventory');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isInventory ? (
      <InventoryPage />
    ) : isCatalogManager ? (
      <CatalogManagerApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
```

New `main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import AuthGate from './auth/AuthGate';
import './index.css';

const isCatalogManager = window.location.pathname.startsWith('/catalog-manager');
const isInventory       = window.location.pathname.startsWith('/inventory');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      {isInventory ? (
        <InventoryPage />
      ) : isCatalogManager ? (
        <CatalogManagerApp />
      ) : (
        <App />
      )}
    </AuthGate>
  </React.StrictMode>,
);
```

- [ ] **Step 11.2: Start the dev server and verify login screen appears**

```bash
pnpm dev
```

Navigate to `https://localhost:5173`. The login screen must appear instead of the main app. Enter the credentials from Task 12 after that task is complete.

- [ ] **Step 11.3: Commit**

```bash
git add apps/frontend/src/main.tsx
git commit -m "feat(frontend/auth): wrap app with AuthGate — all routes require login"
```

---

## Task 12: Create initial Firebase Auth user (one-time)

**Files:**
- Create: `apps/backend/src/scripts/seed-initial-user.ts` ← **delete this file after successful run**

⚠️ This task runs once. After confirming the user exists in Firebase Console → Authentication, delete the script file so it cannot be re-run accidentally.

- [ ] **Step 12.1: Create the seed script**

```typescript
// apps/backend/src/scripts/seed-initial-user.ts
// ONE-TIME USE — DELETE AFTER SUCCESSFUL RUN
import * as path from 'path';
import * as fs from 'fs';
import * as admin from 'firebase-admin';

// Load .env.secrets manually
const secretsPath = path.join(__dirname, '../../.env.secrets');
if (fs.existsSync(secretsPath)) {
  fs.readFileSync(secretsPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .forEach((l) => {
      const [k, ...v] = l.split('=');
      if (k) process.env[k.trim()] = v.join('=').trim();
    });
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

async function run() {
  try {
    const user = await admin.auth().createUser({
      email: 'nilmar@518.rent',
      password: '147536985200Nilm@r',
      displayName: 'Nilmar Lutino',
      emailVerified: true,
    });
    console.log(`✅ Firebase Auth user created — uid: ${user.uid}`);

    await admin.firestore().collection('users').doc(user.uid).set({
      uid: user.uid,
      name: 'Nilmar Lutino',
      email: 'nilmar@518.rent',
      phone: '',
      country: 'BO',
      dialCode: '+591',
      role: 'admin',
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    console.log(`✅ Firestore users/${user.uid} document created`);
    console.log('');
    console.log('⚠️  DELETE apps/backend/src/scripts/seed-initial-user.ts now.');
    process.exit(0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Error: ${msg}`);
    process.exit(1);
  }
}

void run();
```

- [ ] **Step 12.2: Run the script**

From the repo root:
```bash
cd apps/backend
npx ts-node --project tsconfig.json src/scripts/seed-initial-user.ts
```

Expected output:
```
✅ Firebase Auth user created — uid: <some-uid>
✅ Firestore users/<some-uid> document created
⚠️  DELETE apps/backend/src/scripts/seed-initial-user.ts now.
```

- [ ] **Step 12.3: Verify in Firebase Console**

Open Firebase Console → Authentication → Users.
Confirm `nilmar@518.rent` appears with display name `Nilmar Lutino`.

- [ ] **Step 12.4: Delete the seed script**

```bash
rm apps/backend/src/scripts/seed-initial-user.ts
```

- [ ] **Step 12.5: Commit**

```bash
git add apps/backend/src/scripts/seed-initial-user.ts  # staged as deleted
git commit -m "chore: remove one-time seed-initial-user script after execution"
```

- [ ] **Step 12.6: Verify login end-to-end**

With both backend and frontend running, navigate to `https://localhost:5173`.

1. Login screen must appear.
2. Enter `nilmar@518.rent` / `147536985200Nilm@r`.
3. After successful login, the main WhatsApp demo app must appear.
4. Open DevTools → Network and confirm API calls include `Authorization: Bearer <token>`.

---

## Self-Review Checklist

- [x] **Spec coverage:** FirebaseAuthGuard ✓ | @Public() webhooks ✓ | Users CRUD ✓ | CountryCode enum with dial codes ✓ | UserRole enum ✓ | LoginPage ✓ | AuthGate ✓ | main.tsx update ✓ | META_SYSTEM_USER_TOKEN toggle ✓ | Initial user creation ✓
- [x] **Placeholder scan:** No TBD/TODO in implementation steps. All code blocks are complete.
- [x] **Type consistency:** `CountryCode` and `COUNTRY_DIAL_CODES` defined in Task 3, used identically in Task 5. `CreateUserDto`/`UpdateUserDto` defined in Task 4, referenced correctly in Task 5 and 6. `auth` export added in Task 9, used in Tasks 10–11.
- [x] **Execution order warning:** Task 7 activates the guard. Frontend must be complete (Tasks 9–11) before or simultaneously with Task 7 to avoid breaking the app.
- [x] **One-time task:** Seed script (Task 12) self-documents deletion — script prints reminder and is deleted in Step 12.4.
