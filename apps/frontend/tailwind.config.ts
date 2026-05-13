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
          DEFAULT:          'var(--bg-page)',
          raised:           'var(--bg-elevated)',
          subtle:           'var(--bg-subtle)',
          sidebar:          'var(--bg-sidebar)',
          'sidebar-hover':  'var(--bg-sidebar-hover)',
          'sidebar-act':    'var(--bg-sidebar-active)',
        },
        content: {
          DEFAULT:         'var(--text-primary)',
          2:               'var(--text-secondary)',
          3:               'var(--text-muted)',
          inv:             'var(--text-on-dark)',
          sidebar:         'var(--text-sidebar)',
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
        navprogress: {
          '0%':   { transform: 'translateX(-100%)' },
          '50%':  { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in':   'fade-in 0.15s ease-out',
        navprogress: 'navprogress 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
