# Design Spec: i18n Language System (ES / EN)

**Date:** 2026-05-13
**Branch:** feat/ui-design-system
**Status:** Approved

---

## 1. Scope

Add a Spanish/English language toggle to the frontend. The selected language persists in `localStorage`. The toggle lives in `SideNav` alongside the existing dark/light mode toggle. All UI-visible strings in the affected files are extracted to locale files; code identifiers (variable names, API field names, channel names like `'whatsapp'`) are NOT translated.

Out of scope: backend strings, error messages from the API, date/number formatting, pluralization rules beyond what is listed, right-to-left support.

---

## 2. Architecture

### 2.1 New files

```
src/
├── context/
│   └── LanguageContext.tsx     ← mirrors ThemeContext exactly
├── i18n/
│   ├── es.ts                   ← Spanish (default, source of truth)
│   └── en.ts                   ← English (must satisfy Record<TranslationKey, string>)
```

### 2.2 `LanguageContext.tsx`

```typescript
type Lang = 'es' | 'en';
const LS_KEY = 'app_lang';

// Context value
interface LanguageContextValue {
  lang: Lang;
  toggleLanguage: () => void;
  t: (key: TranslationKey) => string;
}
```

- Reads initial value from `localStorage(LS_KEY)`, falls back to `'es'`
- `toggleLanguage()` flips between `'es'` and `'en'`, writes to `localStorage`
- `t(key)` returns `locales[lang][key]` where `locales = { es, en }`
- `useLanguage()` hook exported for consumer use

### 2.3 Type safety

`es.ts` defines `export const es = { ... } as const` and exports `TranslationKey = keyof typeof es`.

`en.ts` types its export as `Record<TranslationKey, string>` — TypeScript enforces that every key present in `es.ts` also exists in `en.ts`. A missing key is a compile error.

### 2.4 `main.tsx` integration

Wrap `<LanguageProvider>` inside `<ThemeProvider>`, same pattern:

```tsx
<ThemeProvider>
  <LanguageProvider>
    <AuthGate>
      <AppShell />
    </AuthGate>
  </LanguageProvider>
</ThemeProvider>
```

---

## 3. SideNav Toggle

Add a language toggle button below the theme toggle in `SideNav.tsx`:

- Icon: `Languages` from `lucide-react`
- Label when expanded: current lang uppercased — `ES` or `EN`
- Clicking calls `toggleLanguage()`
- Title attribute (tooltip when collapsed): `'Cambiar idioma'` / `'Change language'`
- All existing SideNav labels use `t()` — see Section 5

---

## 4. Translation Keys

### `es.ts` — full key set (Spanish, source of truth)

```typescript
export const es = {
  // Navigation
  'nav.principal':          'Principal',
  'nav.integrations':       'Integraciones',
  'nav.system':             'Sistema',
  'nav.dashboard':          'Dashboard',
  'nav.messages':           'Mensajes',
  'nav.inventory':          'Inventario',
  'nav.whatsapp':           'WhatsApp',
  'nav.messenger':          'Messenger',
  'nav.instagram':          'Instagram',
  'nav.channex':            'Channex',
  'nav.airbnb':             'Airbnb',
  'nav.booking':            'Booking.com',
  'nav.settings':           'Configuración',
  'nav.myAccount':          'Mi cuenta',
  'nav.logout':             'Cerrar sesión',
  'nav.lightMode':          'Modo claro',
  'nav.darkMode':           'Modo oscuro',
  'nav.expandMenu':         'Expandir menú',
  'nav.collapseMenu':       'Colapsar menú',
  'nav.changeLang':         'Cambiar idioma',

  // Common (reused across components)
  'common.save':            'Guardar cambios',
  'common.cancel':          'Cancelar',
  'common.yes':             'Sí',
  'common.no':              'No',
  'common.edit':            'Editar',
  'common.retry':           'Reintentar',
  'common.copy':            'Copiar',
  'common.copied':          'Copiado',
  'common.close':           'Cerrar',
  'common.editUser':        'Editar usuario',
  'common.deleteUser':      'Eliminar usuario',

  // Auth — LoginPage
  'auth.appSubtitle':       'Ingresa a tu cuenta',
  'auth.email':             'Correo electrónico',
  'auth.emailPlaceholder':  'tu@correo.com',
  'auth.password':          'Contraseña',
  'auth.login':             'Ingresar',
  'auth.loggingIn':         'Ingresando…',
  'auth.invalidCreds':      'Credenciales inválidas. Verifica tu correo y contraseña.',

  // Auth — ChangePasswordForm
  'auth.changePassword':    'Cambiar contraseña',
  'auth.firstSession':      'Esta es tu primera sesión. Por seguridad, debes establecer una nueva contraseña.',
  'auth.newPassword':       'Nueva contraseña',
  'auth.confirmPassword':   'Confirmar contraseña',
  'auth.saving':            'Guardando…',
  'auth.pwMinLength':       'La contraseña debe tener al menos 8 caracteres.',
  'auth.pwUppercase':       'La contraseña debe contener al menos una letra mayúscula.',
  'auth.pwNumber':          'La contraseña debe contener al menos un número.',
  'auth.pwMismatch':        'Las contraseñas no coinciden.',
  'auth.pwError':           'Ocurrió un error. Intenta de nuevo.',

  // Settings page
  'settings.title':         'Configuración del Sistema',
  'settings.tab.users':     'Usuarios',

  // Users — table
  'users.addUser':          'Agregar usuario',
  'users.count':            'usuarios',
  'users.col.name':         'Nombre',
  'users.col.email':        'Email',
  'users.col.phone':        'Teléfono',
  'users.col.country':      'País',
  'users.col.role':         'Rol',
  'users.col.actions':      'Acciones',
  'users.empty':            'No hay usuarios registrados.',
  'users.loadError':        'Error al cargar usuarios',
  'users.confirmDelete':    '¿Confirmar?',
  'users.role.owner':       'Propietario',
  'users.role.admin':       'Administrador',
  'users.role.customer':    'Cliente',

  // Users — CreateUserModal
  'users.create.title':     'Agregar usuario',
  'users.create.submit':    'Crear usuario',
  'users.create.creating':  'Creando...',
  'users.create.success':   'Usuario creado exitosamente',
  'users.create.oneTime':   'Esta contraseña se muestra una sola vez. Cópiala antes de cerrar.',
  'users.create.error':     'Error al crear el usuario',

  // Users — EditUserModal
  'users.edit.title':       'Editar usuario',
  'users.edit.submit':      'Guardar cambios',
  'users.edit.saving':      'Guardando...',
  'users.edit.error':       'Error al actualizar el usuario',

  // Users — form field labels (shared between create and edit)
  'users.field.name':       'Nombre',
  'users.field.email':      'Email',
  'users.field.phone':      'Teléfono',
  'users.field.country':    'País',
  'users.field.role':       'Rol',

  // Users — validation errors
  'users.val.nameRequired': 'El nombre es requerido',
  'users.val.emailRequired':'El email es requerido',
  'users.val.emailInvalid': 'Ingresa un email válido',
  'users.val.phoneRequired':'El teléfono es requerido',
  'users.val.phoneInvalid': 'Solo se permiten dígitos',

  // Users — placeholders
  'users.ph.name':          'Nombre completo',
  'users.ph.email':         'correo@ejemplo.com',
  'users.ph.phone':         'Solo dígitos',

  // Channex
  'channex.manager':        'Channex Channel Manager',
  'channex.propertyHub':    'Migo App · Property Hub',
  'channex.tab.properties': 'Properties',
  'channex.tab.airbnb':     'Airbnb',
  'channex.tab.booking':    'Booking.com',

  // Airbnb
  'airbnb.integration':     'Airbnb Integration',
  'airbnb.shell':           'Migo App · Airbnb',
} as const;

export type TranslationKey = keyof typeof es;
```

### `en.ts` — English translations (same keys, enforced by type)

All values above translated to English. Key examples:
- `'nav.messages'` → `'Messages'`
- `'nav.settings'` → `'Settings'`
- `'nav.logout'` → `'Log out'`
- `'auth.appSubtitle'` → `'Sign in to your account'`
- `'auth.email'` → `'Email address'`
- `'auth.login'` → `'Sign in'`
- `'settings.title'` → `'System Settings'`
- `'settings.tab.users'` → `'Users'`
- `'users.addUser'` → `'Add user'`
- `'users.empty'` → `'No users registered.'`
- `'users.create.title'` → `'Add user'`
- `'users.create.oneTime'` → `'This password is shown only once. Copy it before closing.'`
- `'channex.propertyHub'` → `'Migo App · Property Hub'`

---

## 5. Files Modified

| File | Change |
|------|--------|
| `apps/frontend/src/main.tsx` | Wrap with `<LanguageProvider>` |
| `apps/frontend/src/context/LanguageContext.tsx` | **Create** |
| `apps/frontend/src/i18n/es.ts` | **Create** |
| `apps/frontend/src/i18n/en.ts` | **Create** |
| `apps/frontend/src/layout/SideNav.tsx` | Add lang toggle, replace all labels with `t()` |
| `apps/frontend/src/auth/LoginPage.tsx` | Replace strings with `t()` |
| `apps/frontend/src/auth/ChangePasswordForm.tsx` | Replace strings with `t()` |
| `apps/frontend/src/settings/SettingsPage.tsx` | Replace strings with `t()` |
| `apps/frontend/src/settings/components/UserTable.tsx` | Replace strings with `t()` |
| `apps/frontend/src/settings/components/CreateUserModal.tsx` | Replace strings with `t()` |
| `apps/frontend/src/settings/components/EditUserModal.tsx` | Replace strings with `t()` |
| `apps/frontend/src/channex/ChannexHub.tsx` | Replace strings with `t()` |
| `apps/frontend/src/integrations/airbnb/AirbnbIntegration.tsx` | Replace strings with `t()` |

---

## 6. Usage Pattern

Every consumer imports `useLanguage` and destructures `t`:

```typescript
import { useLanguage } from '../../context/LanguageContext';

export default function MyComponent() {
  const { t } = useLanguage();
  return <h1>{t('settings.title')}</h1>;
}
```

The `t` function signature: `t(key: TranslationKey): string` — TypeScript will error on unknown keys at compile time.

---

## 7. Constraints

- Do NOT translate: API field names, channel identifiers (`'whatsapp'`), lucide icon names, CSS classes, Firestore collection names, enum values
- Do NOT add a translation key for strings that are already proper nouns and identical in both languages (e.g. `'WhatsApp'`, `'Instagram'`, `'Channex'`, `'Booking.com'`) — these stay as string literals
- The `en.ts` file typed as `Record<TranslationKey, string>` ensures no key is ever missing from either locale
