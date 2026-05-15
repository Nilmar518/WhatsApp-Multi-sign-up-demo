# Frontend Design System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the entire frontend visual layer to the Slate & Violet design system with light/dark mode toggle, a shared agnostic UI component library, and Lucide icons — without touching any business logic, hooks, or API calls.

**Architecture:** CSS custom properties define all design tokens in `index.css`; Tailwind is extended with semantic color aliases that point to those vars; shared UI components in `src/components/ui/` consume only the semantic aliases and are therefore mode-agnostic by construction. A `ThemeContext` toggles the `.dark` class on `<html>`, which flips all CSS vars simultaneously. Feature files are migrated one-by-one to swap hardcoded Tailwind utilities for the semantic aliases and `<ui/*>` components.

**Tech stack:** React 18, Vite, Tailwind CSS 3, `lucide-react`, Plus Jakarta Sans (Google Fonts), Firebase Auth (untouched).

---

## Execution Rules (read before every task)

1. **No commits.** The human partner handles all `git commit` steps. Subagents make file changes only — skip every commit step in the task descriptions.
2. **Pure visual.** Zero changes to hooks, API files, Firebase config, fetch calls, or business logic. If a file contains a function call to an API or hook, leave that call untouched and only modify JSX/className strings around it.
3. **Branch:** `feat/ui-design-system` — already created. All changes go here.
4. **Verify before finishing.** After each task, confirm the dev server still starts (`pnpm --filter @migo-uit/frontend dev`) and no TypeScript errors appear.

---

## Plan Amendments (added during execution planning)

- **App.tsx gap:** `App.tsx` appears in the File Map but had no task. It is now covered in **Task 16b** below.
- **booking/ gap:** `src/integrations/booking/` components were missing. Covered in **Task 22b** below.
- **inventory Toast prop verification:** Task 19 Step 19.1 now includes prop-interface check before re-export.

---

## Inflection Points

| # | Gate | Blocks |
|---|------|--------|
| 1 | Token foundation (Tasks 1–3) | Everything — no token = no semantic class |
| 2 | ThemeContext (Task 4–5) | Dark-mode toggle in SideNav |
| 3 | Shared UI components (Tasks 6–10) | Feature migration — components must exist before import |
| 4 | Layout refactor (Tasks 11–12) | Visible on every screen |
| 5 | Feature migrations (Tasks 13–22) | Independent — safe to parallelise |

---

## File Map

### Created
| Path | Role |
|------|------|
| `src/context/ThemeContext.tsx` | Theme state + toggle, localStorage persistence |
| `src/components/ui/Button.tsx` | Agnostic button, 5 variants × 3 sizes |
| `src/components/ui/Badge.tsx` | Status and channel chips |
| `src/components/ui/Card.tsx` | Elevated surface container |
| `src/components/ui/Input.tsx` | Text input + select |
| `src/components/ui/Toast.tsx` | Notification toast, replaces `inventory/components/Toast.tsx` |
| `src/components/ui/index.ts` | Barrel re-export |

### Modified
| Path | Change |
|------|--------|
| `apps/frontend/index.html` | Add Google Font link |
| `apps/frontend/tailwind.config.ts` | `darkMode: 'class'`, semantic color tokens, font family |
| `apps/frontend/src/index.css` | Full CSS custom properties (light + dark) |
| `apps/frontend/src/main.tsx` | Wrap with `<ThemeProvider>` |
| `apps/frontend/src/layout/SideNav.tsx` | Lucide icons, token classes, theme toggle |
| `apps/frontend/src/layout/MainLayout.tsx` | `bg-surface` token |
| `apps/frontend/src/auth/LoginPage.tsx` | Token classes, `<Button>`, `<Input>` |
| `apps/frontend/src/auth/AuthGate.tsx` | Spinner token classes |
| `apps/frontend/src/components/ChannelTabs/index.tsx` | Lucide icons, token classes |
| `apps/frontend/src/components/BusinessToggle/index.tsx` | Token classes |
| `apps/frontend/src/components/ConnectButton/index.tsx` | `<Button>` |
| `apps/frontend/src/components/ConnectionGateway/index.tsx` | Token classes, `<Button>`, `<Card>` |
| `apps/frontend/src/components/StatusDisplay/index.tsx` | `<Badge>`, token classes |
| `apps/frontend/src/components/ChatConsole/index.tsx` | Token classes, `<Button>`, `<Input>` |
| `apps/frontend/src/components/CatalogView/index.tsx` | Token classes, `<Button>`, `<Badge>` |
| `apps/frontend/src/components/ConversationList/index.tsx` | Token classes |
| `apps/frontend/src/components/ForceMigrationForm/index.tsx` | Token classes, `<Button>`, `<Input>` |
| `apps/frontend/src/components/ResetButton/index.tsx` | `<Button variant="danger">` |
| `apps/frontend/src/components/CartPanel/index.tsx` + `CartViewer.tsx` | Token classes |
| `apps/frontend/src/inventory/InventoryPage.tsx` + all sub-components | Token classes, `<Toast>` |
| `apps/frontend/src/channex/ChannexHub.tsx` + all sub-components | Token classes |
| `apps/frontend/src/airbnb/AirbnbPage.tsx` + all sub-components | Token classes |
| `apps/frontend/src/integrations/airbnb/` all components | Token classes |
| `apps/frontend/src/catalog-manager/` all components | Token classes, `<Button>` |

---

## Task 1 — Install lucide-react + Google Font

**Files:**
- Modify: `apps/frontend/package.json` (via pnpm)
- Modify: `apps/frontend/index.html`

- [ ] **Step 1.1 — Install lucide-react**

```bash
cd apps/frontend
pnpm add lucide-react
```

Expected: `lucide-react` appears in `package.json` dependencies.

- [ ] **Step 1.2 — Add Plus Jakarta Sans to index.html**

Open `apps/frontend/index.html`. Add inside `<head>` before `</head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 1.3 — Verify dev server starts**

```bash
pnpm --filter @migo-uit/frontend dev
```

Expected: server starts on port 5173, no errors.

- [ ] **Step 1.4 — Commit**

```bash
git add apps/frontend/index.html apps/frontend/package.json pnpm-lock.yaml
git commit -m "feat(ui): install lucide-react, add Plus Jakarta Sans font"
```

---

## Task 2 — Design token foundation: index.css

**Files:**
- Modify: `apps/frontend/src/index.css`

- [ ] **Step 2.1 — Replace index.css with full token set**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ─── DESIGN TOKENS: Slate & Violet ─────────────────────────────────── */
:root {
  /* Surfaces */
  --bg-page:            #f8fafc;
  --bg-elevated:        #ffffff;
  --bg-subtle:          #f1f5f9;
  --bg-sidebar:         #0f172a;
  --bg-sidebar-hover:   #1e293b;
  --bg-sidebar-active:  #1e293b;

  /* Text */
  --text-primary:       #0f172a;
  --text-secondary:     #64748b;
  --text-muted:         #94a3b8;
  --text-on-dark:       #f1f5f9;
  --text-sidebar:       #cbd5e1;
  --text-sidebar-muted: #64748b;

  /* Brand — violet */
  --brand:              #7c3aed;
  --brand-hover:        #6d28d9;
  --brand-active:       #5b21b6;
  --brand-subtle:       #f5f3ff;
  --brand-light:        #ddd6fe;
  --brand-dim:          #4c1d95;

  /* Borders */
  --border:             #e2e8f0;
  --border-strong:      #94a3b8;

  /* Semantic */
  --ok:                 #22c55e;
  --ok-bg:              #f0fdf4;
  --ok-text:            #166534;
  --danger:             #ef4444;
  --danger-bg:          #fef2f2;
  --danger-text:        #991b1b;
  --caution:            #f59e0b;
  --caution-bg:         #fffbeb;
  --caution-text:       #92400e;
  --notice:             #0ea5e9;
  --notice-bg:          #f0f9ff;
  --notice-text:        #075985;

  /* Channels */
  --ch-wa:              #25d366;
  --ch-ms:              #0866ff;
  --ch-ig:              #e1306c;
  --ch-cx:              #7c3aed;

  /* Shadows */
  --shadow-sm:    0 1px 2px rgba(15,23,42,.06);
  --shadow-md:    0 4px 12px rgba(15,23,42,.10);
  --shadow-lg:    0 8px 24px rgba(15,23,42,.14);
  --shadow-brand: 0 4px 14px rgba(124,58,237,.25);

  /* Radius */
  --r-sm:   6px;
  --r-md:   8px;
  --r-lg:   12px;
  --r-xl:   16px;
  --r-full: 9999px;
}

.dark {
  --bg-page:            #0f172a;
  --bg-elevated:        #1e293b;
  --bg-subtle:          #334155;
  --bg-sidebar:         #020617;
  --bg-sidebar-hover:   #0f172a;
  --bg-sidebar-active:  #1e293b;

  --text-primary:       #f1f5f9;
  --text-secondary:     #94a3b8;
  --text-muted:         #64748b;

  --brand-subtle:       #1e1b4b;
  --brand-light:        #4c1d95;
  --brand-dim:          #c4b5fd;

  --border:             #1e293b;
  --border-strong:      #475569;

  --ok-bg:              #052e16;
  --ok-text:            #4ade80;
  --danger-bg:          #1f0707;
  --danger-text:        #f87171;
  --caution-bg:         #1c1200;
  --caution-text:       #fbbf24;
  --notice-bg:          #0c1a26;
  --notice-text:        #38bdf8;

  --shadow-sm:    0 1px 2px rgba(0,0,0,.35);
  --shadow-md:    0 4px 12px rgba(0,0,0,.45);
  --shadow-lg:    0 8px 24px rgba(0,0,0,.55);
  --shadow-brand: 0 4px 14px rgba(124,58,237,.20);
}
```

- [ ] **Step 2.2 — Commit**

```bash
git add apps/frontend/src/index.css
git commit -m "feat(ui): add Slate & Violet CSS design tokens (light + dark)"
```

---

## Task 3 — Tailwind config: darkMode + semantic aliases + font

**Files:**
- Modify: `apps/frontend/tailwind.config.ts`

- [ ] **Step 3.1 — Rewrite tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          DEFAULT:        'var(--bg-page)',
          raised:         'var(--bg-elevated)',
          subtle:         'var(--bg-subtle)',
          sidebar:        'var(--bg-sidebar)',
          'sidebar-hover':'var(--bg-sidebar-hover)',
          'sidebar-act':  'var(--bg-sidebar-active)',
        },
        content: {
          DEFAULT: 'var(--text-primary)',
          2:       'var(--text-secondary)',
          3:       'var(--text-muted)',
          inv:     'var(--text-on-dark)',
          sidebar: 'var(--text-sidebar)',
          'sidebar-muted': 'var(--text-sidebar-muted)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          hover:   'var(--brand-hover)',
          active:  'var(--brand-active)',
          subtle:  'var(--brand-subtle)',
          light:   'var(--brand-light)',
          dim:     'var(--brand-dim)',
        },
        edge: {
          DEFAULT: 'var(--border)',
          strong:  'var(--border-strong)',
        },
        ok: {
          DEFAULT: 'var(--ok)',
          bg:      'var(--ok-bg)',
          text:    'var(--ok-text)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg:      'var(--danger-bg)',
          text:    'var(--danger-text)',
        },
        caution: {
          DEFAULT: 'var(--caution)',
          bg:      'var(--caution-bg)',
          text:    'var(--caution-text)',
        },
        notice: {
          DEFAULT: 'var(--notice)',
          bg:      'var(--notice-bg)',
          text:    'var(--notice-text)',
        },
        channel: {
          wa: 'var(--ch-wa)',
          ms: 'var(--ch-ms)',
          ig: 'var(--ch-ig)',
          cx: 'var(--ch-cx)',
        },
      },
      boxShadow: {
        sm:    'var(--shadow-sm)',
        md:    'var(--shadow-md)',
        lg:    'var(--shadow-lg)',
        brand: 'var(--shadow-brand)',
      },
      borderRadius: {
        sm:   'var(--r-sm)',
        md:   'var(--r-md)',
        lg:   'var(--r-lg)',
        xl:   'var(--r-xl)',
        full: 'var(--r-full)',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3.2 — Restart dev server and verify no Tailwind errors**

```bash
pnpm --filter @migo-uit/frontend dev
```

Expected: compiles cleanly, no "unknown utility class" warnings.

- [ ] **Step 3.3 — Commit**

```bash
git add apps/frontend/tailwind.config.ts
git commit -m "feat(ui): extend Tailwind with semantic DS tokens and darkMode class"
```

---

## Task 4 — ThemeContext

**Files:**
- Create: `apps/frontend/src/context/ThemeContext.tsx`

- [ ] **Step 4.1 — Create ThemeContext.tsx**

```typescript
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 4.2 — Commit**

```bash
git add apps/frontend/src/context/ThemeContext.tsx
git commit -m "feat(ui): add ThemeContext with localStorage + system preference detection"
```

---

## Task 5 — Wire ThemeProvider into main.tsx

**Files:**
- Modify: `apps/frontend/src/main.tsx`

- [ ] **Step 5.1 — Add ThemeProvider wrap**

Current `main.tsx` renders:
```tsx
<React.StrictMode>
  <AuthGate>
    {isInventory ? <InventoryPage /> : isCatalogManager ? <CatalogManagerApp /> : (
      <MainLayout><App /></MainLayout>
    )}
  </AuthGate>
</React.StrictMode>
```

Replace with:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import AuthGate from './auth/AuthGate';
import MainLayout from './layout/MainLayout';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';

const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (apiBase) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = apiBase + input;
    }
    return _fetch(input, init);
  };
}

const isCatalogManager = window.location.pathname.startsWith('/catalog-manager');
const isInventory       = window.location.pathname.startsWith('/inventory');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthGate>
        {isInventory ? (
          <InventoryPage />
        ) : isCatalogManager ? (
          <CatalogManagerApp />
        ) : (
          <MainLayout>
            <App />
          </MainLayout>
        )}
      </AuthGate>
    </ThemeProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5.2 — Verify app loads, toggle test**

Open browser console and run:
```js
document.documentElement.classList.toggle('dark')
```
Expected: CSS vars switch, background goes dark.

- [ ] **Step 5.3 — Commit**

```bash
git add apps/frontend/src/main.tsx
git commit -m "feat(ui): wrap app in ThemeProvider"
```

---

## Task 6 — Shared UI: Button

**Files:**
- Create: `apps/frontend/src/components/ui/Button.tsx`

- [ ] **Step 6.1 — Create Button.tsx**

```typescript
import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:   'bg-brand text-content-inv border-brand shadow-brand hover:bg-brand-hover hover:border-brand-hover active:bg-brand-active',
  secondary: 'bg-surface-subtle text-content border-edge hover:bg-edge',
  outline:   'bg-transparent text-brand border-brand-light hover:bg-brand-subtle hover:border-brand',
  ghost:     'bg-transparent text-content-2 border-transparent hover:bg-surface-subtle hover:text-content',
  danger:    'bg-danger-bg text-danger-text border-transparent hover:bg-danger hover:text-white',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-sm gap-1.5',
  md: 'px-4 py-2 text-sm rounded-md gap-2',
  lg: 'px-6 py-3 text-base rounded-lg gap-2',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => (
    <button
      ref={ref}
      className={[
        'inline-flex items-center justify-center font-semibold border',
        'transition-colors duration-150 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  ),
);

Button.displayName = 'Button';
export default Button;
```

- [ ] **Step 6.2 — Commit**

```bash
git add apps/frontend/src/components/ui/Button.tsx
git commit -m "feat(ui): add agnostic Button component (5 variants, 3 sizes)"
```

---

## Task 7 — Shared UI: Badge

**Files:**
- Create: `apps/frontend/src/components/ui/Badge.tsx`

- [ ] **Step 7.1 — Create Badge.tsx**

```typescript
import type { HTMLAttributes } from 'react';

type Variant = 'ok' | 'danger' | 'caution' | 'notice' | 'neutral' | 'brand'
             | 'wa' | 'ms' | 'ig' | 'cx';

interface BadgeProps extends HTMLAttributes<'span'> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  ok:      'bg-ok-bg text-ok-text border-ok/30',
  danger:  'bg-danger-bg text-danger-text border-danger/30',
  caution: 'bg-caution-bg text-caution-text border-caution/30',
  notice:  'bg-notice-bg text-notice-text border-notice/30',
  neutral: 'bg-surface-subtle text-content-2 border-edge',
  brand:   'bg-brand-subtle text-brand-dim border-brand-light',
  wa:      'bg-[#dcfce7] text-[#166534] border-[#bbf7d0] dark:bg-[#052e16] dark:text-[#4ade80] dark:border-[#166534]',
  ms:      'bg-[#dbeafe] text-[#1e40af] border-[#bfdbfe] dark:bg-[#1e3a5f] dark:text-[#93c5fd] dark:border-[#1e40af]',
  ig:      'bg-[#fce7f3] text-[#9d174d] border-[#fbcfe8] dark:bg-[#4a0020] dark:text-[#f9a8d4] dark:border-[#9d174d]',
  cx:      'bg-brand-subtle text-brand-dim border-brand-light',
};

export default function Badge({ variant = 'neutral', className = '', children, ...props }: BadgeProps & { variant?: Variant }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        variantClasses[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 7.2 — Commit**

```bash
git add apps/frontend/src/components/ui/Badge.tsx
git commit -m "feat(ui): add agnostic Badge component (status + channel variants)"
```

---

## Task 8 — Shared UI: Card

**Files:**
- Create: `apps/frontend/src/components/ui/Card.tsx`

- [ ] **Step 8.1 — Create Card.tsx**

```typescript
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: boolean;
}

export default function Card({ padding = true, className = '', children, ...props }: CardProps) {
  return (
    <div
      className={[
        'bg-surface-raised border border-edge rounded-lg shadow-sm',
        'transition-colors duration-200',
        padding ? 'p-5' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 8.2 — Commit**

```bash
git add apps/frontend/src/components/ui/Card.tsx
git commit -m "feat(ui): add agnostic Card component"
```

---

## Task 9 — Shared UI: Input + Select

**Files:**
- Create: `apps/frontend/src/components/ui/Input.tsx`

- [ ] **Step 9.1 — Create Input.tsx**

```typescript
import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

const base =
  'w-full px-3 py-2 text-sm rounded-md border border-edge bg-surface-raised ' +
  'text-content placeholder:text-content-3 ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ' +
  'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`${base} ${className}`} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...props }, ref) => (
    <select ref={ref} className={`${base} ${className}`} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
```

- [ ] **Step 9.2 — Commit**

```bash
git add apps/frontend/src/components/ui/Input.tsx
git commit -m "feat(ui): add agnostic Input and Select components"
```

---

## Task 10 — Shared UI: Toast + barrel export

**Files:**
- Create: `apps/frontend/src/components/ui/Toast.tsx`
- Create: `apps/frontend/src/components/ui/index.ts`

- [ ] **Step 10.1 — Create Toast.tsx**

```typescript
import { useEffect } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastVariant = 'ok' | 'danger' | 'notice' | 'caution';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  duration?: number;
}

const config: Record<ToastVariant, { icon: React.ReactNode; classes: string }> = {
  ok:      { icon: <CheckCircle size={16} />,    classes: 'bg-ok-bg text-ok-text border-ok/30' },
  danger:  { icon: <XCircle size={16} />,        classes: 'bg-danger-bg text-danger-text border-danger/30' },
  notice:  { icon: <Info size={16} />,           classes: 'bg-notice-bg text-notice-text border-notice/30' },
  caution: { icon: <AlertTriangle size={16} />,  classes: 'bg-caution-bg text-caution-text border-caution/30' },
};

export default function Toast({ message, variant = 'ok', onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [onDismiss, duration]);

  const { icon, classes } = config[variant];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-md text-sm font-medium animate-fade-in ${classes}`}>
      <span className="mt-px shrink-0">{icon}</span>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="ml-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-80">
      {children}
    </div>
  );
}
```

- [ ] **Step 10.2 — Create ui/index.ts barrel**

```typescript
export { default as Button }         from './Button';
export { default as Badge }          from './Badge';
export { default as Card }           from './Card';
export { Input, Select }             from './Input';
export { default as Toast, ToastContainer } from './Toast';
```

- [ ] **Step 10.3 — Commit**

```bash
git add apps/frontend/src/components/ui/
git commit -m "feat(ui): add Toast, ToastContainer, and ui barrel export"
```

---

## Task 11 — Layout: SideNav.tsx refactor

**Files:**
- Modify: `apps/frontend/src/layout/SideNav.tsx`

- [ ] **Step 11.1 — Rewrite SideNav.tsx**

Replace the entire file:

```typescript
import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { useTheme } from '../context/ThemeContext';
import {
  LayoutDashboard, MessageSquare, Package, Smartphone,
  Hotel, Home, Settings, Moon, Sun, User, LogOut,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

const LS_KEY = 'sidenav_collapsed';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}

function NavRow({ icon, label, active = false, collapsed }: NavItem & { collapsed: boolean }) {
  return (
    <div
      className={[
        'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer',
        'text-content-sidebar text-sm font-medium transition-colors duration-150',
        'hover:bg-surface-sidebar-hover hover:text-content-inv',
        active
          ? 'bg-surface-sidebar-act text-content-inv border-l-2 border-brand'
          : 'border-l-2 border-transparent',
      ].join(' ')}
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </div>
  );
}

export default function SideNav() {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(LS_KEY) === 'true',
  );
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(collapsed));
  }, [collapsed]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <nav
      className={[
        'flex flex-col bg-surface-sidebar border-r border-edge/10',
        'sticky top-0 h-screen overflow-y-auto transition-all duration-200',
        collapsed ? 'w-14' : 'w-56',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-4 border-b border-white/5">
        <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center shrink-0 shadow-brand">
          <Smartphone size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-content-inv font-bold text-sm tracking-tight">
            Migo<span className="text-brand-dim">UI</span>
          </span>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col gap-0.5 p-2 mt-1">
        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 py-2">
            Principal
          </p>
        )}
        <NavRow icon={<LayoutDashboard size={16} />} label="Dashboard" active collapsed={collapsed} />
        <NavRow icon={<MessageSquare size={16} />}   label="Mensajes"  collapsed={collapsed} />
        <NavRow icon={<Package size={16} />}         label="Inventario" collapsed={collapsed} />

        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 pt-4 pb-2">
            Integraciones
          </p>
        )}
        {collapsed && <div className="my-1 mx-2 border-t border-white/5" />}
        <NavRow icon={<Smartphone size={16} />} label="WhatsApp" collapsed={collapsed} />
        <NavRow icon={<Hotel size={16} />}      label="Channex"  collapsed={collapsed} />
        <NavRow icon={<Home size={16} />}       label="Airbnb"   collapsed={collapsed} />

        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 pt-4 pb-2">
            Sistema
          </p>
        )}
        {collapsed && <div className="my-1 mx-2 border-t border-white/5" />}
        <NavRow icon={<Settings size={16} />} label="Configuración" collapsed={collapsed} />
      </div>

      {/* Bottom controls */}
      <div className="p-2 border-t border-white/5 flex flex-col gap-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          className={[
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md',
            'text-content-sidebar text-sm font-medium',
            'hover:bg-surface-sidebar-hover hover:text-content-inv transition-colors duration-150',
          ].join(' ')}
        >
          {theme === 'dark'
            ? <Sun size={16} className="shrink-0" />
            : <Moon size={16} className="shrink-0" />}
          {!collapsed && (
            <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
          )}
        </button>

        {/* User */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-content-sidebar text-sm font-medium hover:bg-surface-sidebar-hover hover:text-content-inv transition-colors duration-150 cursor-pointer">
          <User size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">Mi cuenta</span>}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-danger text-sm font-medium hover:bg-danger-bg transition-colors duration-150"
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center w-full mt-1 py-1.5 rounded-md text-content-sidebar-muted hover:text-content-sidebar hover:bg-surface-sidebar-hover transition-colors duration-150"
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 11.2 — Verify sidebar renders and theme toggle works**

Open the dev server, click the moon/sun icon. Expected: `.dark` class toggles on `<html>`, page background switches.

- [ ] **Step 11.3 — Commit**

```bash
git add apps/frontend/src/layout/SideNav.tsx
git commit -m "feat(ui): refactor SideNav — lucide icons, DS tokens, theme toggle"
```

---

## Task 12 — Layout: MainLayout.tsx

**Files:**
- Modify: `apps/frontend/src/layout/MainLayout.tsx`

- [ ] **Step 12.1 — Apply surface token**

```typescript
import SideNav from './SideNav';

interface Props {
  children: React.ReactNode;
}

export default function MainLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen bg-surface transition-colors duration-200">
      <SideNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 12.2 — Commit**

```bash
git add apps/frontend/src/layout/MainLayout.tsx
git commit -m "feat(ui): apply surface token to MainLayout"
```

---

## Task 13 — Auth: LoginPage.tsx + AuthGate.tsx

**Files:**
- Modify: `apps/frontend/src/auth/LoginPage.tsx`
- Modify: `apps/frontend/src/auth/AuthGate.tsx`

- [ ] **Step 13.1 — Rewrite LoginPage.tsx**

```typescript
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { Smartphone, Loader2 } from 'lucide-react';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';

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
    <div className="min-h-screen bg-surface-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand mb-4 shadow-brand">
            <Smartphone size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-content-inv">WhatsApp Multi Sign-Up</h1>
          <p className="text-sm text-content-sidebar mt-1">Ingresa a tu cuenta</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface-sidebar-hover rounded-xl p-6 flex flex-col gap-4 shadow-lg ring-1 ring-white/5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-content-sidebar">Correo electrónico</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
              className="bg-surface-sidebar border-edge-strong text-content-inv placeholder:text-content-sidebar-muted focus:border-brand"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-content-sidebar">Contraseña</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-surface-sidebar border-edge-strong text-content-inv placeholder:text-content-sidebar-muted focus:border-brand"
            />
          </div>

          {error && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full justify-center mt-1">
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2 — Update AuthGate.tsx spinner**

In `AuthGate.tsx`, find the loading spinner JSX (the `if (loading)` return). Replace whatever classes it has with:

```tsx
if (loading) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-edge border-t-brand animate-spin" />
    </div>
  );
}
```

All other logic in AuthGate.tsx is unchanged.

- [ ] **Step 13.3 — Commit**

```bash
git add apps/frontend/src/auth/
git commit -m "feat(ui): migrate LoginPage and AuthGate to DS tokens and ui components"
```

---

## Task 14 — ChannelTabs: emoji → Lucide + tokens

**Files:**
- Modify: `apps/frontend/src/components/ChannelTabs/index.tsx`

- [ ] **Step 14.1 — Rewrite ChannelTabs/index.tsx**

```typescript
import { MessageCircle, MessageSquare, Camera, Building2 } from 'lucide-react';

export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'channex';

interface Props {
  active: Channel;
  onChange: (channel: Channel) => void;
}

interface TabDef {
  channel: Channel;
  label: string;
  icon: React.ReactNode;
  activeColor: string;
  dotColor: string;
  disabled?: boolean;
}

const TABS: TabDef[] = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    icon: <MessageCircle size={15} />,
    activeColor: 'border-channel-wa text-channel-wa',
    dotColor: 'bg-channel-wa',
  },
  {
    channel: 'messenger',
    label: 'Messenger',
    icon: <MessageSquare size={15} />,
    activeColor: 'border-channel-ms text-channel-ms',
    dotColor: 'bg-channel-ms',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    icon: <Camera size={15} />,
    activeColor: 'border-channel-ig text-channel-ig',
    dotColor: 'bg-channel-ig',
  },
  {
    channel: 'channex',
    label: 'Channex',
    icon: <Building2 size={15} />,
    activeColor: 'border-channel-cx text-channel-cx',
    dotColor: 'bg-channel-cx',
    disabled: false,
  },
];

export default function ChannelTabs({ active, onChange }: Props) {
  return (
    <div className="flex border-b border-edge bg-surface-raised">
      {TABS.map(({ channel, label, icon, activeColor, dotColor, disabled }) => {
        const isActive = active === channel;
        return (
          <button
            key={channel}
            disabled={disabled}
            onClick={() => onChange(channel)}
            className={[
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-150',
              isActive
                ? activeColor
                : 'border-transparent text-content-3 hover:text-content-2 hover:border-edge',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${isActive ? 'opacity-100' : 'opacity-40'}`} />
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 14.2 — Commit**

```bash
git add apps/frontend/src/components/ChannelTabs/
git commit -m "feat(ui): migrate ChannelTabs — Lucide icons, DS tokens, remove emoji"
```

---

## Task 15 — BusinessToggle + ConnectButton + ResetButton

**Files:**
- Modify: `apps/frontend/src/components/BusinessToggle/index.tsx`
- Modify: `apps/frontend/src/components/ConnectButton/index.tsx`
- Modify: `apps/frontend/src/components/ResetButton/index.tsx`

- [ ] **Step 15.1 — Rewrite BusinessToggle/index.tsx**

```typescript
interface Props {
  businessIds: readonly string[];
  selected: string;
  onChange: (id: string) => void;
}

const LABELS: Record<string, string> = {
  '787167007221172': 'Number 1',
  'demo-business-002': 'Number 2',
};

export default function BusinessToggle({ businessIds, selected, onChange }: Props) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-content-3 font-medium">Integración</span>
      <div className="flex gap-1 bg-surface-subtle rounded-lg p-1 border border-edge">
        {businessIds.map((id) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={[
              'px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150',
              selected === id
                ? 'bg-surface-raised text-content shadow-sm border border-edge'
                : 'text-content-3 hover:text-content-2',
            ].join(' ')}
          >
            {LABELS[id] ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 15.2 — Read ConnectButton and ResetButton current implementation**

Read the current files to understand what props/logic they use before rewriting:
- `apps/frontend/src/components/ConnectButton/index.tsx`
- `apps/frontend/src/components/ResetButton/index.tsx`

- [ ] **Step 15.3 — Rewrite ConnectButton/index.tsx**

Replace its existing `<button>` with `<Button>` from ui, keeping all props and onClick logic intact. Example pattern:

```typescript
import Button from '../ui/Button';
// ... keep all existing props interface and logic unchanged ...

// Replace the JSX button element with:
<Button
  variant="primary"
  onClick={handleConnect}
  disabled={isConnecting}
  className="w-full justify-center"
>
  {isConnecting ? 'Conectando…' : 'Conectar WhatsApp'}
</Button>
```

- [ ] **Step 15.4 — Rewrite ResetButton/index.tsx**

```typescript
import Button from '../ui/Button';
// Keep all existing props and handleReset logic unchanged.
// Replace <button> with:
<Button variant="danger" onClick={handleReset} size="sm">
  Desconectar
</Button>
```

- [ ] **Step 15.5 — Commit**

```bash
git add apps/frontend/src/components/BusinessToggle/ \
        apps/frontend/src/components/ConnectButton/ \
        apps/frontend/src/components/ResetButton/
git commit -m "feat(ui): migrate BusinessToggle, ConnectButton, ResetButton to DS tokens"
```

---

## Task 16 — StatusDisplay + ConnectionGateway

**Files:**
- Modify: `apps/frontend/src/components/StatusDisplay/index.tsx`
- Modify: `apps/frontend/src/components/ConnectionGateway/index.tsx`

- [ ] **Step 16.1 — Migrate StatusDisplay**

In `StatusDisplay/index.tsx`, replace status-based color classes:
- `text-green-*` / `bg-green-*` → `text-ok-text` / `bg-ok-bg` / `text-ok`
- `text-red-*` / `bg-red-*`   → `text-danger-text` / `bg-danger-bg` / `text-danger`
- `text-yellow-*`              → `text-caution-text` / `bg-caution-bg`
- `text-gray-*`                → `text-content-2` or `text-content-3`
- `bg-white`                   → `bg-surface-raised`
- `border-gray-*`              → `border-edge`

Import `Badge` from `../ui/Badge` and replace any inline status pill JSX with:
```tsx
<Badge variant="ok">Conectado</Badge>
<Badge variant="danger">Error</Badge>
<Badge variant="caution">Pendiente</Badge>
```

- [ ] **Step 16.2 — Migrate ConnectionGateway**

Apply the same color swap rules as Step 16.1. Replace any standalone `<button>` used for primary actions with `<Button>` from `../ui/Button`. Wrap content panels with `<Card>` from `../ui/Card` if they are currently `div` with `bg-white rounded shadow`.

- [ ] **Step 16.3 — Commit**

```bash
git add apps/frontend/src/components/StatusDisplay/ \
        apps/frontend/src/components/ConnectionGateway/
git commit -m "feat(ui): migrate StatusDisplay and ConnectionGateway to DS tokens"
```

---

## Task 17 — ChatConsole + ConversationList + CartPanel

**Files:**
- Modify: `apps/frontend/src/components/ChatConsole/index.tsx`
- Modify: `apps/frontend/src/components/ConversationList/index.tsx`
- Modify: `apps/frontend/src/components/CartPanel/index.tsx`
- Modify: `apps/frontend/src/components/CartPanel/CartViewer.tsx`

- [ ] **Step 17.1 — Token substitution map for all three files**

Apply these replacements throughout each file:

| Old Tailwind | New semantic |
|---|---|
| `bg-white` | `bg-surface-raised` |
| `bg-gray-50` / `bg-gray-100` | `bg-surface-subtle` |
| `bg-gray-800` / `bg-gray-900` | `bg-surface-sidebar` |
| `text-gray-900` / `text-gray-800` | `text-content` |
| `text-gray-500` / `text-gray-600` | `text-content-2` |
| `text-gray-400` | `text-content-3` |
| `border-gray-200` | `border-edge` |
| `border-gray-400` | `border-edge-strong` |
| `bg-green-500` / `bg-green-600` (send button) | `bg-brand hover:bg-brand-hover` |
| `text-green-*` | `text-ok-text` |
| `bg-green-50` | `bg-ok-bg` |
| `text-red-*` | `text-danger-text` |
| `bg-red-50` | `bg-danger-bg` |
| `ring-1 ring-gray-*` | `ring-1 ring-edge` |
| `shadow` / `shadow-sm` | `shadow-sm` (now maps to token) |

- [ ] **Step 17.2 — Replace send button in ChatConsole with `<Button>`**

```tsx
import Button from '../ui/Button';
import { Input } from '../ui/Input';

// Replace textarea/input submit area with:
<Input
  value={text}
  onChange={(e) => setText(e.target.value)}
  placeholder="Escribe un mensaje…"
  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
/>
<Button onClick={handleSend} disabled={isSending || !text.trim()} size="sm">
  Enviar
</Button>
```

- [ ] **Step 17.3 — Commit**

```bash
git add apps/frontend/src/components/ChatConsole/ \
        apps/frontend/src/components/ConversationList/ \
        apps/frontend/src/components/CartPanel/
git commit -m "feat(ui): migrate ChatConsole, ConversationList, CartPanel to DS tokens"
```

---

## Task 18 — CatalogView + ForceMigrationForm + InstagramConnect + MessengerConnect + InstagramInbox

**Files:**
- Modify: `apps/frontend/src/components/CatalogView/index.tsx`
- Modify: `apps/frontend/src/components/ForceMigrationForm/index.tsx`
- Modify: `apps/frontend/src/components/InstagramConnect/index.tsx`
- Modify: `apps/frontend/src/components/MessengerConnect/index.tsx`
- Modify: `apps/frontend/src/components/InstagramInbox/index.tsx`

- [ ] **Step 18.1 — Apply token substitution map from Task 17.1 to all five files**

Additionally:
- `bg-emerald-*` → `bg-ok-bg` / `text-ok-text` / `text-ok`
- `bg-blue-*` / `text-blue-*` → `bg-notice-bg` / `text-notice-text` / `text-notice`
- `bg-pink-*` / `text-pink-*` → use `text-channel-ig` / `bg-[var(--ch-ig)]/10`
- `border-green-*` → `border-ok/40`
- `border-blue-*`  → `border-notice/40`

- [ ] **Step 18.2 — Replace standalone buttons and form inputs with `<Button>` / `<Input>`**

Any `<button className="... bg-green-500 ...">` → `<Button variant="primary">`
Any `<input className="... border-gray-200 ...">` → `<Input />`

- [ ] **Step 18.3 — Commit**

```bash
git add apps/frontend/src/components/CatalogView/ \
        apps/frontend/src/components/ForceMigrationForm/ \
        apps/frontend/src/components/InstagramConnect/ \
        apps/frontend/src/components/MessengerConnect/ \
        apps/frontend/src/components/InstagramInbox/
git commit -m "feat(ui): migrate remaining core components to DS tokens"
```

---

## Task 19 — Inventory feature migration

**Files:**
- Modify: `apps/frontend/src/inventory/InventoryPage.tsx`
- Modify: `apps/frontend/src/inventory/components/CatalogManager.tsx`
- Modify: `apps/frontend/src/inventory/components/ProductManager.tsx`
- Modify: `apps/frontend/src/inventory/components/VariantManager.tsx`
- Modify: `apps/frontend/src/inventory/components/AutoReplyManager.tsx`
- Replace: `apps/frontend/src/inventory/components/Toast.tsx` → now delegates to `components/ui/Toast`

- [ ] **Step 19.1 — Replace inventory Toast.tsx**

First, read `apps/frontend/src/inventory/components/Toast.tsx` AND every file that imports it to understand the current prop interface (especially what `type`, `message`, `onClose`/`onDismiss` props are called).

The new `ui/Toast` uses: `{ message: string; variant?: 'ok'|'danger'|'notice'|'caution'; onDismiss: () => void; duration?: number }`.

**If the current callers use `onClose` instead of `onDismiss`**, add a compatibility shim:
```typescript
// apps/frontend/src/inventory/components/Toast.tsx
import UIToast, { ToastContainer } from '../../components/ui/Toast';
import type { ComponentProps } from 'react';

type UIProps = ComponentProps<typeof UIToast>;
interface LegacyProps extends Omit<UIProps, 'onDismiss'> {
  onClose?: () => void;
  onDismiss?: () => void;
}

export function Toast({ onClose, onDismiss, ...props }: LegacyProps) {
  return <UIToast {...props} onDismiss={onDismiss ?? onClose ?? (() => {})} />;
}
export { ToastContainer };
```

**If callers already use `onDismiss`**, use the simple re-export:
```typescript
export { default as Toast, ToastContainer } from '../../components/ui/Toast';
```

- [ ] **Step 19.2 — Apply token substitution to all inventory components**

Same substitution map as Task 17.1. Additionally:
- `bg-slate-*` → `bg-surface-sidebar` / `bg-surface-raised` depending on context
- `text-slate-*` → `text-content` / `text-content-2` / `text-content-sidebar`

- [ ] **Step 19.3 — Replace Button and Input usages**

```tsx
import Button from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
```

- [ ] **Step 19.4 — Commit**

```bash
git add apps/frontend/src/inventory/
git commit -m "feat(ui): migrate inventory feature to DS tokens and shared ui components"
```

---

## Task 20 — Channex feature migration

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`
- Modify: `apps/frontend/src/channex/components/PropertiesList.tsx`
- Modify: `apps/frontend/src/channex/components/PropertyDetail.tsx`
- Modify: `apps/frontend/src/channex/components/PropertySetupWizard.tsx`
- Modify: `apps/frontend/src/channex/components/ReservationsPanel.tsx`
- Modify: `apps/frontend/src/channex/components/RoomRateManager.tsx`
- Modify: `apps/frontend/src/channex/components/ARICalendarFull.tsx`
- Modify: `apps/frontend/src/channex/components/ARIGlossaryButton.tsx`

- [ ] **Step 20.1 — Apply token substitution map (Task 17.1) to all channex files**

Additionally:
- `bg-indigo-*` / `border-indigo-*` → use `bg-brand-subtle` / `border-brand-light` / `text-brand`
- `text-indigo-*` → `text-brand`
- `bg-sky-*` / `text-sky-*` → `bg-notice-bg` / `text-notice-text`
- `bg-amber-*` → `bg-caution-bg` / `text-caution-text`

- [ ] **Step 20.2 — Replace standalone buttons and inputs**

Import `Button`, `Input`, `Select`, `Card` from `../../components/ui` and replace all inline implementations.

- [ ] **Step 20.3 — Commit**

```bash
git add apps/frontend/src/channex/
git commit -m "feat(ui): migrate Channex feature to DS tokens and shared ui components"
```

---

## Task 21 — Airbnb feature migration

**Files:**
- Modify: `apps/frontend/src/airbnb/AirbnbPage.tsx`
- Modify: `apps/frontend/src/airbnb/components/ARICalendar.tsx`
- Modify: `apps/frontend/src/airbnb/components/ConnectionStatusBadge.tsx`
- Modify: `apps/frontend/src/airbnb/components/ExistingPropertyCard.tsx`
- Modify: `apps/frontend/src/airbnb/components/InboxView.tsx`
- Modify: `apps/frontend/src/airbnb/components/MappingReviewModal.tsx`
- Modify: `apps/frontend/src/airbnb/components/MultiCalendarView.tsx`
- Modify: `apps/frontend/src/airbnb/components/PropertyProvisioningForm.tsx`
- Modify: `apps/frontend/src/airbnb/components/ReservationInbox.tsx`
- Modify: `apps/frontend/src/airbnb/components/UnmappedRoomModal.tsx`
- Modify: `apps/frontend/src/integrations/airbnb/components/AirbnbSidebar.tsx`
- Modify: `apps/frontend/src/integrations/airbnb/components/ChannexOAuthPanel.tsx`
- Modify: `apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx`
- Modify: `apps/frontend/src/integrations/airbnb/components/InventoryView.tsx`
- Modify: `apps/frontend/src/integrations/airbnb/AirbnbIntegration.tsx`

- [ ] **Step 21.1 — Apply token substitution (Task 17.1) to all airbnb files**

Additionally:
- `bg-rose-*` / `text-rose-*` → keep as Airbnb brand accent using `bg-[var(--ch-ig)]` / arbitrary value, since rose is used for Airbnb branding specifically
- `bg-sky-*` → `bg-notice-bg` / `text-notice-text`
- `border-rose-*` → `border-[var(--ch-ig)]/30`
- `ConnectionStatusBadge`: replace inline status JSX with `<Badge variant="ok">` / `<Badge variant="danger">`

- [ ] **Step 21.2 — Replace buttons, inputs, form elements with ui components**

```tsx
import Button from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
```

- [ ] **Step 21.3 — Commit**

```bash
git add apps/frontend/src/airbnb/ apps/frontend/src/integrations/
git commit -m "feat(ui): migrate Airbnb and integrations features to DS tokens"
```

---

## Task 22b — Booking feature migration (gap fix)

**Files:**
- Modify: `apps/frontend/src/integrations/booking/BookingIntegrationView.tsx`
- Modify: `apps/frontend/src/integrations/booking/components/BookingInbox.tsx`
- Modify: `apps/frontend/src/integrations/booking/components/BookingReservations.tsx`

- [ ] **Step 22b.1 — Apply token substitution map (Task 17.1) to all booking files**

Same rules as Task 20. Additionally:
- `bg-blue-*` / `text-blue-*` → `bg-notice-bg` / `text-notice-text` / `text-notice`
- `border-blue-*` → `border-notice/40`
- Replace any `<button>` / `<input>` with `<Button>` / `<Input>` from `../../../components/ui`.

---

## Task 16b — App.tsx token migration (gap fix)

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 16b.1 — Apply token substitution map to App.tsx**

Apply the full substitution map from Task 17.1. `App.tsx` contains layout wrappers, tab containers, and conditional render logic. Only className strings change — all state, hooks, fetch calls, and event handlers stay untouched.

Notable patterns to replace:
- Any `bg-white` container divs → `bg-surface-raised`
- `bg-gray-*` page wrappers → `bg-surface` or `bg-surface-subtle`
- `text-gray-*` headings → `text-content` / `text-content-2`
- `border-gray-*` dividers → `border-edge`

Import `BusinessToggle` and `ChannelTabs` are unchanged — those components already migrated in Tasks 14–15.

---

## Task 22 — Catalog Manager feature migration

**Files:**
- Modify: `apps/frontend/src/catalog-manager/CatalogManagerApp.tsx`
- Modify: `apps/frontend/src/catalog-manager/components/CatalogList.tsx`
- Modify: `apps/frontend/src/catalog-manager/components/ProductList.tsx`

- [ ] **Step 22.1 — Apply token substitution and ui components**

Same substitution map as Task 17.1. Replace `<button>` and `<input>` with `<Button>` and `<Input>` from `../../components/ui`.

```tsx
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import Card from '../../components/ui/Card';
```

- [ ] **Step 22.2 — Commit**

```bash
git add apps/frontend/src/catalog-manager/
git commit -m "feat(ui): migrate catalog-manager feature to DS tokens"
```

---

## Task 23 — Final verification

- [ ] **Step 23.1 — Build check**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 23.2 — Dev smoke test**

```bash
pnpm --filter @migo-uit/frontend dev
```

Manually verify:
1. All routes load: `/`, `/inventory`, `/catalog-manager`
2. Light mode renders Slate & Violet palette
3. Dark mode toggle in sidebar flips theme globally
4. Auth login page renders correctly
5. Channel tabs show Lucide icons (no emoji)
6. Sidebar collapse/expand still works
7. All buttons use consistent styling
8. No console errors related to missing imports

- [ ] **Step 23.3 — Final commit**

```bash
git add -A
git commit -m "feat(ui): complete Slate & Violet design system refactor"
```

---

## Token Substitution Quick Reference

| Old Tailwind (hardcoded) | New semantic token class |
|---|---|
| `bg-white` | `bg-surface-raised` |
| `bg-gray-50` | `bg-surface` |
| `bg-gray-100` / `bg-slate-100` | `bg-surface-subtle` |
| `bg-gray-800` / `bg-slate-900` | `bg-surface-sidebar` |
| `text-gray-900` / `text-slate-900` | `text-content` |
| `text-gray-500` / `text-slate-500` | `text-content-2` |
| `text-gray-400` | `text-content-3` |
| `text-white` (on dark bg) | `text-content-inv` |
| `border-gray-200` / `border-slate-200` | `border-edge` |
| `border-gray-400` | `border-edge-strong` |
| `bg-green-500` / primary action | `bg-brand` |
| `hover:bg-green-600` | `hover:bg-brand-hover` |
| `text-green-600` / success text | `text-ok-text` |
| `bg-green-50` | `bg-ok-bg` |
| `text-red-600` | `text-danger-text` |
| `bg-red-50` | `bg-danger-bg` |
| `text-yellow-*` / `text-amber-*` | `text-caution-text` |
| `bg-yellow-50` / `bg-amber-50` | `bg-caution-bg` |
| `text-blue-*` / `text-sky-*` | `text-notice-text` |
| `bg-blue-50` / `bg-sky-50` | `bg-notice-bg` |
| `text-violet-*` / `text-indigo-*` (brand) | `text-brand` |
| `bg-violet-50` | `bg-brand-subtle` |
| `shadow` / `shadow-sm` (generic) | `shadow-sm` (now DS var) |
| `rounded-xl` (large) | `rounded-xl` (same — DS var) |
| `rounded-lg` (medium) | `rounded-lg` (same — DS var) |
