// Bonus definitions. Art strings are brightness maps (0 = empty, 9 = brightest), taken from the original game.
const ART = {
  speed: ['9700000', '0098000', '0000970', '0000089', '0008970', '0897000', '9700000'],
  slow: ['0000079', '0008900', '0790000', '9800000', '0798000', '0007980', '0000079'],
  teleport: ['09990009', '90009990', '00000000', '09990009', '90009990'],
  bomb: [
    '00002980', '00006930', '00059700', '00599500', '08944980', '59200295',
    '97000079', '97000079', '59300395', '08944980', '00799700',
  ],
  wallh: ['999999999999'],
  wallv: Array(12).fill('9'),
  god: ['9000009', '9000009', '6900096', '2890982', '0349430', '0009000', '0009000', '0009000', '0999990'],
  switch: ['0079700', '0864680', '7600067', '9409049', '7600067', '0864680', '0079700'],
};

export const BONUS_TYPES = {
  speed: { hue: 116, name: 'Speed up', pop: 'SPEED +', desc: 'You move faster.' },
  slow: { hue: 188, name: 'Slow down', pop: 'SLOW', desc: 'You move slower (never below the minimum).' },
  teleport: { hue: 315, name: 'Teleport', pop: 'TELEPORT', desc: 'Jump to a random open spot on the board.' },
  bomb: { hue: 28, name: 'Bomb', pop: 'BOOM', desc: 'Blasts away every trail around you.' },
  wall: { hue: 6, name: 'Wall', pop: 'WALL', desc: 'Drops a wall in your colour across your path, behind you.' },
  god: { hue: 268, name: 'God mode', pop: 'GOD MODE', desc: 'About 8 seconds of passing through trails and bouncing off the edges.' },
  switch: { hue: 226, name: 'Switcheroo', pop: 'SWITCH!', desc: 'Every living player swaps places with the next one.' },
};

export function artFor(type, variant = '') {
  return ART[type + variant] ?? ART[type];
}
