export type ThemeColors = {
  bg: string;
  bgSoft: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  text: string;
  muted: string;
  muted2: string;
  accent: string;
  accentHover: string;
};

export type ThemePreset = {
  name: string;
  mode: 'dark' | 'light';
  colors: ThemeColors;
};

export const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
  'bg', 'bgSoft', 'surface', 'surface2',
  'line', 'lineStrong',
  'text', 'muted', 'muted2',
  'accent', 'accentHover',
];

export const THEME_CSS_MAP: Record<keyof ThemeColors, string> = {
  bg: '--bg',
  bgSoft: '--bg-soft',
  surface: '--surface',
  surface2: '--surface-2',
  line: '--line',
  lineStrong: '--line-strong',
  text: '--text',
  muted: '--muted',
  muted2: '--muted-2',
  accent: '--accent',
  accentHover: '--accent-hover',
};

export const DEFAULT_DARK_COLORS: ThemeColors = {
  bg: '#0a0a0a', bgSoft: '#131315', surface: '#17171a', surface2: '#1c1c1e',
  line: '#212126', lineStrong: '#2a2a30',
  text: '#f4f4f5', muted: '#9f9fa9', muted2: '#71717a',
  accent: '#22c55e', accentHover: '#4ade80',
};

export const DEFAULT_LIGHT_COLORS: ThemeColors = {
  bg: '#f7f7f9', bgSoft: '#f0f0f2', surface: '#ffffff', surface2: '#f0f0f2',
  line: '#d2d2d6', lineStrong: '#b8b8c0',
  text: '#18181b', muted: '#6b7280', muted2: '#9ca3af',
  accent: '#2563eb', accentHover: '#3b82f6',
};

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'Dark', mode: 'dark', colors: DEFAULT_DARK_COLORS },
  { name: 'Light', mode: 'light', colors: DEFAULT_LIGHT_COLORS },
  {
    name: 'Solarized Dark', mode: 'dark',
    colors: {
      bg: '#002b36', bgSoft: '#073642', surface: '#073642', surface2: '#586e73',
      line: '#06404f', lineStrong: '#074c5a',
      text: '#839496', muted: '#657b83', muted2: '#586e73',
      accent: '#268bd2', accentHover: '#2980b9',
    },
  },
  {
    name: 'Dracula', mode: 'dark',
    colors: {
      bg: '#282a36', bgSoft: '#343746', surface: '#44475a', surface2: '#44475a',
      line: '#44475a', lineStrong: '#6272a4',
      text: '#f8f8f2', muted: '#8d87a6', muted2: '#6272a4',
      accent: '#ff79c6', accentHover: '#ff92df',
    },
  },
  {
    name: 'Nord', mode: 'dark',
    colors: {
      bg: '#2e3440', bgSoft: '#3b4252', surface: '#434852', surface2: '#4c566a',
      line: '#4c566a', lineStrong: '#5e6e80',
      text: '#d8dee9', muted: '#81a1c1', muted2: '#4c566a',
      accent: '#5e81ac', accentHover: '#81a1c1',
    },
  },
  {
    name: 'Gruvbox Dark', mode: 'dark',
    colors: {
      bg: '#282828', bgSoft: '#32302f', surface: '#3c3836', surface2: '#5a524d',
      line: '#5a524d', lineStrong: '#665c54',
      text: '#ebdbb2', muted: '#d5c0a1', muted2: '#b59a78',
      accent: '#d699b6', accentHover: '#e08780',
    },
  },
  {
    name: 'Tokyo Night', mode: 'dark',
    colors: {
      bg: '#1a1b26', bgSoft: '#1f1f2e', surface: '#1f1f2e', surface2: '#292e42',
      line: '#292e42', lineStrong: '#444b6a',
      text: '#a9acb6', muted: '#7a8399', muted2: '#565a73',
      accent: '#70a5eb', accentHover: '#7ca7f3',
    },
  },
  {
    name: 'One Dark', mode: 'dark',
    colors: {
      bg: '#1e1e1e', bgSoft: '#2d2d30', surface: '#2d2d30', surface2: '#252526',
      line: '#3c3c3c', lineStrong: '#5a5a5a',
      text: '#d4d4d4', muted: '#a5a5a5', muted2: '#808080',
      accent: '#569cd6', accentHover: '#6cb6ff',
    },
  },
  {
    name: 'Material Dark', mode: 'dark',
    colors: {
      bg: '#263238', bgSoft: '#2e3d4a', surface: '#37474f', surface2: '#455a64',
      line: '#394949', lineStrong: '#546e79',
      text: '#eceff1', muted: '#b0bec5', muted2: '#90a4ae',
      accent: '#ff9800', accentHover: '#ffb74d',
    },
  },
  {
    name: 'High Contrast', mode: 'dark',
    colors: {
      bg: '#000000', bgSoft: '#121212', surface: '#1e1e1e', surface2: '#252525',
      line: '#303030', lineStrong: '#454545',
      text: '#ffffff', muted: '#b3b3b3', muted2: '#808080',
      accent: '#007acc', accentHover: '#3399ff',
    },
  },
  {
    name: 'One Half Light', mode: 'light',
    colors: {
      bg: '#fafafa', bgSoft: '#f0f0f0', surface: '#f7f7f7', surface2: '#eeeeee',
      line: '#d2d2d2', lineStrong: '#b8b8b8',
      text: '#383838', muted: '#707070', muted2: '#909090',
      accent: '#4078f1', accentHover: '#668fff',
    },
  },
  {
    name: 'Gruvbox Light', mode: 'light',
    colors: {
      bg: '#f9f5d7', bgSoft: '#f2e8c9', surface: '#ebdbb2', surface2: '#d5c0a1',
      line: '#d5c0a1', lineStrong: '#b59a78',
      text: '#3c3833', muted: '#665c57', muted2: '#928374',
      accent: '#b57618', accentHover: '#d68910',
    },
  },
  {
    name: 'Night Owl', mode: 'dark',
    colors: {
      bg: '#011627', bgSoft: '#0d1e2e', surface: '#1d2736', surface2: '#2c5f7a',
      line: '#1d3b52', lineStrong: '#2d4f70',
      text: '#d6deeb', muted: '#7e8e9f', muted2: '#5a6e83',
      accent: '#c792ea', accentHover: '#d0a9ff',
    },
  },
];

export function applyTheme(colors: Record<string, string>) {
  const root = document.documentElement;
  for (const [token, cssVar] of Object.entries(THEME_CSS_MAP)) {
    if (colors[token]) root.style.setProperty(cssVar, colors[token]);
  }
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
}
