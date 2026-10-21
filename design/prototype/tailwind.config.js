// TaskMaster — Tailwind config mapped to the CSS variables in taskmaster-tokens.css.
// Import Modernist styles.css + taskmaster-tokens.css globally; dark mode via [data-theme="dark"].
const ramp = (role) => Object.fromEntries(
  [100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, `var(--color-${role}-${s})`])
);

module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0' },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: 'var(--color-bg)',
      surface: 'var(--color-surface)',
      text: 'var(--color-text)',
      divider: 'var(--color-divider)',
      danger: 'var(--tm-danger)',
      accent: { DEFAULT: 'var(--color-accent)', ...ramp('accent') },
      neutral: ramp('neutral'),
      prio: { high: 'var(--tm-prio-high)', medium: 'var(--tm-prio-medium)', low: 'var(--tm-prio-low)' },
    },
    fontFamily: {
      heading: ['Archivo', 'system-ui', 'sans-serif'],
      body: ['Archivo', 'system-ui', 'sans-serif'],
    },
    fontSize: {
      xs: ['11px', '1.4'], sm: ['13px', '1.5'], base: ['15px', '1.55'],
      h5: ['16px', '1.2'], h4: ['20px', '1.12'], h3: ['25px', '1.12'], h2: ['32px', '1.12'], h1: ['42px', '1.12'],
    },
    spacing: { 0: '0', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px' },
    boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)', none: 'none' },
    extend: {
      borderWidth: { rule: '2px' },
      screens: { sm: '376px', md: '820px', lg: '1200px' },
    },
  },
};
