// Bonus definitions. Art strings are brightness maps (0 = empty, 9 = brightest), one grid cell per
// character. They are a little bigger than the original game's (about 9 to 13 cells across rather
// than 7) so the shapes can say what they do, but still small enough to steer between.
const transpose = (rows) => [...rows[0]].map((_, i) => rows.map((r) => r[i]).join(''));
const BRICKS = ['999929999', '999929999', '222222222', '992999299', '992999299'];

const ART = {
  // fast-forward: a bright chevron leading a dimmer one
  speed: ['660099000', '066009900', '006600990', '000660099', '006600990', '066009900', '660099000'],
  // hourglass with the sand running through
  slow: ['9999999', '0900090', '0966690', '0096900', '0009000', '0090900', '0906090', '0966690', '9999999'],
  // portal: two rings round a spark
  teleport: ['000999000', '099000990', '090444090', '904000409', '904090409', '904000409', '090444090', '099000990', '000999000'],
  // round black bomb (a bright rim round a dark body) with a shine, a neck, a fuse and a spark
  bomb: [
    '00000000909', '00000000090', '00000007909', '00000070000', '00099700000',
    '00888800000', '08992280000', '89922228000', '89222228000', '82222228000', '82222228000', '08222280000', '00888800000',
  ],
  // a short stretch of brick wall, lying either way
  wallh: BRICKS,
  wallv: transpose(BRICKS),
  // the holy grail: a chalice with a cross on the cup
  god: ['999999999', '966696669', '966999669', '096696690', '009666900', '000999000', '000090000', '000090000', '000090000', '009999900', '099999990'],
  // two arrows passing each other
  switch: ['000000900', '000000090', '999999999', '000000090', '009000900', '090000000', '999999999', '090000000', '009000000'],
};

export const BONUS_TYPES = {
  speed: { hue: 105, name: 'Speed up', pop: 'SPEED +', desc: 'You move faster.' },
  slow: { hue: 192, name: 'Slow down', pop: 'SLOW', desc: 'You move slower (never below the minimum).' },
  teleport: { hue: 300, name: 'Teleport', pop: 'TELEPORT', desc: 'Jump to a random open spot on the board.' },
  bomb: { hue: 28, name: 'Bomb', pop: 'BOOM', desc: 'Blasts away every trail around you.' },
  wall: { hue: 2, name: 'Wall', pop: 'WALL', desc: 'Drops a wall in your colour across your path, behind you.' },
  god: { hue: 275, name: 'God mode', pop: 'GOD MODE', desc: 'About 8 seconds of passing through trails and bouncing off the edges.' },
  switch: { hue: 218, name: 'Switcheroo', pop: 'SWITCH!', desc: 'Every living player swaps places with the next one.' },
};

export function artFor(type, variant = '') {
  return ART[type + variant] ?? ART[type];
}
