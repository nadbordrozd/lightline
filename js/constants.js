// Shared constants. The arena is a fixed logical grid of W x H cells; one cell = one pixel of trail.
export const W = 1300;
export const H = 800;
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const BASE_SPEED = 3; // speed level at the start of a round; speed-ups add 1, slow-downs take 1
export const CELLS_PER_LEVEL = 1.5; // cells moved per tick per speed level (so 4.5 cells/tick at the start)
export const MAX_SPEED = 14;
export const GOD_TICKS = 255; // ~8.5 s
export const SWAP_GRACE_TICKS = 15; // invulnerability after a Switcheroo
export const COUNTDOWN_TICKS = 3 * TICK_HZ;
export const BONUS_SCALE = 2; // each cell of bonus art covers BONUS_SCALE x BONUS_SCALE grid cells
export const MAX_PLAYERS = 8;
export const MATCH_WINS = 10; // the first player to win this many rounds wins the match

export const COLORS = [
  { name: 'Red', hue: 355 },
  { name: 'Yellow', hue: 50 },
  { name: 'Green', hue: 115 },
  { name: 'Teal', hue: 170 },
  { name: 'Blue', hue: 212 },
  { name: 'Purple', hue: 272 },
  { name: 'Pink', hue: 318 },
  { name: 'White', hue: 220, sat: 30, light: 90 },
];

// Order in which online players are handed colours, so the first few are easy to tell apart.
export const ONLINE_COLOR_ORDER = [0, 4, 1, 2, 6, 3, 5, 7];

export function playerPalette(colorIndex) {
  const c = COLORS[colorIndex] ?? COLORS[0];
  const s = c.sat ?? 100;
  const l = c.light ?? 60;
  return {
    hue: c.hue,
    css: `hsl(${c.hue} ${s}% ${l}%)`,
    core: `hsl(${c.hue},${s}%,${l}%)`,
    hot: `hsl(${c.hue},${s}%,${Math.min(l + 26, 97)}%)`,
    glow: `hsla(${c.hue},${Math.max(s, 60)}%,58%,0.75)`,
    sat: s,
    light: l,
  };
}

// Local hot-seat slots. kind: 'off' | 'human' | 'easy' | 'hard'.
export const DEFAULT_SLOTS = [
  { color: 0, kind: 'human', keys: ['KeyA', 'KeyS'] },
  { color: 1, kind: 'human', keys: ['ArrowLeft', 'ArrowRight'] },
  { color: 2, kind: 'off', keys: ['KeyH', 'KeyJ'] },
  { color: 3, kind: 'easy', keys: ['KeyV', 'KeyB'] },
  { color: 4, kind: 'off', keys: ['KeyK', 'KeyL'] },
  { color: 5, kind: 'off', keys: ['Numpad2', 'Numpad3'] },
  { color: 6, kind: 'off', keys: ['KeyZ', 'KeyX'] },
  { color: 7, kind: 'off', keys: ['KeyO', 'KeyP'] },
];

// Keys for the 1st..4th player sharing one computer in an online match.
export const ONLINE_KEYS = [
  ['ArrowLeft', 'ArrowRight'],
  ['KeyA', 'KeyS'],
  ['KeyK', 'KeyL'],
  ['KeyZ', 'KeyX'],
];

const KEY_NAMES = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`', Enter: 'Enter', ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
  MetaLeft: 'L ⌘', MetaRight: 'R ⌘', Tab: 'Tab', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', NumpadEnter: 'Num ⏎',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Num ' + m[1];
  return code;
}
