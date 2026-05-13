# Design Spec: Settings — Users Module

**Date:** 2026-05-13
**Branch:** feat/ui-design-system
**Status:** Approved

---

## 1. Scope

Add a `/configuracion` page to the system with a "Usuarios" tab. The tab exposes full CRUD over the `users` Firestore collection, backed by the existing `/api/users` NestJS endpoints (extended to create Firebase Auth accounts). Users created here can log in to the app. On first login they are forced to change their temporary password.

Out of scope: additional tabs beyond Usuarios, roles/permissions enforcement on API routes, email notifications.

---

## 2. Backend Changes

### 2.1 `create-user.dto.ts`
- Remove `uid` field (generated internally by Firebase Auth).
- No `password` field — backend generates it automatically.

### 2.2 `UsersService.create()`
New flow:
1. Generate a cryptographically secure random password (12 chars: upper + lower + digits + symbols).
2. Call `admin.auth().createUser({ email, password, displayName: dto.name })` → get `uid`.
3. Write Firestore doc at `users/{uid}` with all DTO fields + `dialCode` + `mustChangePassword: true` + `createdAt` / `updatedAt`.
4. Return the full user doc **plus** the plain-text `temporaryPassword` (one-time only — never stored).

### 2.3 `UsersService.remove()`
Also calls `admin.auth().deleteUser(uid)` to remove the Firebase Auth account.

### 2.4 No changes to other endpoints
`findAll`, `findOne`, `update` remain unchanged.

---

## 3. Frontend — New Route & Navigation

### 3.1 `main.tsx`
Add route: `path.startsWith('/configuracion')` → `<SettingsPage />`.

### 3.2 `SideNav.tsx`
Change the "Configuración" `NavRow` href from `/` to `/configuracion`.

---

## 4. Frontend — Settings Feature (`src/settings/`)

```
src/settings/
├── api/
│   └── usersApi.ts
├── components/
│   ├── UserTable.tsx
│   ├── CreateUserModal.tsx
│   └── EditUserModal.tsx
└── SettingsPage.tsx
```

### 4.1 `usersApi.ts`
Fetch wrappers (plain `window.fetch` via Vite proxy `/api/users`):
- `getUsers(): Promise<User[]>`
- `createUser(dto): Promise<{ user: User; temporaryPassword: string }>`
- `updateUser(uid, dto): Promise<User>`
- `deleteUser(uid): Promise<void>`

Type `User` mirrors the Firestore document shape.

### 4.2 `SettingsPage.tsx`
- Single tab bar; only "Usuarios" tab rendered now.
- Tab content area renders `<UserTable />`.
- Page header: "Configuración del Sistema".

### 4.3 `UserTable.tsx`
- Loads users on mount via `getUsers()`.
- Columns: Nombre, Email, Teléfono, País, Rol, Acciones.
- "Agregar usuario" button → opens `CreateUserModal`.
- Per-row: edit icon → opens `EditUserModal`; delete icon → confirmation inline (no separate modal).
- Empty state and loading skeleton.

### 4.4 `CreateUserModal.tsx`
Form fields:
| Field    | Input type        | Validation                        |
|----------|-------------------|-----------------------------------|
| Nombre   | text              | required                          |
| Email    | email             | required, valid email             |
| Teléfono | text              | 6–15 digits only                  |
| País     | select            | 14 options from `CountryCode`     |
| Rol      | select            | customer / admin / owner          |

On submit:
1. POST to `/api/users`.
2. On success: close the form, show **one-time password banner** with the `temporaryPassword` + copy button. Banner dismissible; once closed, password is gone.
3. Refresh user list.

### 4.5 `EditUserModal.tsx`
Editable fields: Nombre, Teléfono, País, Rol (email and uid are not editable).
PATCH to `/api/users/:uid` on submit.

---

## 5. Frontend — First-Login Password Change

### 5.1 `AuthGate.tsx` — extended check
After Firebase Auth sign-in resolves, read Firestore `users/{uid}`. If `mustChangePassword === true`, render `<ChangePasswordForm />` instead of the app shell.

### 5.2 `src/auth/ChangePasswordForm.tsx` (new)
- Fields: nueva contraseña + confirmación.
- Password rules: mínimo 8 chars, al menos 1 mayúscula, 1 número.
- On submit:
  1. Call Firebase Auth SDK `updatePassword(currentUser, newPassword)`.
  2. PATCH `/api/users/:uid` with `{ mustChangePassword: false }` — requires adding `mustChangePassword` as an optional field to `UpdateUserDto`.
  3. On success: dismiss form → app shell loads normally.

---

## 6. Data Flow Summary

```
Admin creates user
  → POST /api/users (name, email, phone, country, role)
  → Backend: Firebase Auth createUser → uid
  → Backend: Firestore users/{uid} { ...fields, mustChangePassword: true }
  → Response: { ...user, temporaryPassword: "Xk9#mQ2pLr7!" }
  → Frontend: shows one-time password banner

New user logs in with temp password
  → AuthGate: Firebase Auth sign-in OK
  → AuthGate: reads Firestore users/{uid}.mustChangePassword === true
  → Renders ChangePasswordForm

User sets new password
  → Firebase Auth updatePassword()
  → PATCH /api/users/:uid { mustChangePassword: false }
  → App shell loads
```

---

## 7. Error Handling

- Duplicate email on Firebase Auth creation → backend returns 409, frontend shows inline error on email field.
- Network errors → toast notification (reuse existing `Toast` component from `src/components/ui/Toast.tsx`).
- Delete confirmation prevents accidental removal.
- `ChangePasswordForm` validates passwords match client-side before submitting.

---

## 8. Files Changed / Created

| File | Action |
|------|--------|
| `apps/backend/src/users/dto/create-user.dto.ts` | Modify — remove `uid`, no password |
| `apps/backend/src/users/dto/update-user.dto.ts` | Modify — add optional `mustChangePassword: boolean` |
| `apps/backend/src/users/users.service.ts` | Modify — Firebase Auth creation + deletion |
| `apps/frontend/src/main.tsx` | Modify — add `/configuracion` route |
| `apps/frontend/src/layout/SideNav.tsx` | Modify — fix href for Configuración |
| `apps/frontend/src/auth/AuthGate.tsx` | Modify — add mustChangePassword check |
| `apps/frontend/src/auth/ChangePasswordForm.tsx` | Create |
| `apps/frontend/src/settings/api/usersApi.ts` | Create |
| `apps/frontend/src/settings/components/UserTable.tsx` | Create |
| `apps/frontend/src/settings/components/CreateUserModal.tsx` | Create |
| `apps/frontend/src/settings/components/EditUserModal.tsx` | Create |
| `apps/frontend/src/settings/SettingsPage.tsx` | Create |
