# Lightline

A neon light-cycle game for up to 8 players. Each player has two keys (turn left, turn right);
hit a wall, the edge or any trail and you're out. Last one alive scores.

It started life as a hidden easter egg in [Turing Game](https://turing-game.pl/) (a Processing.js sketch from 2013)
and has been rebuilt here in plain JavaScript with a new UI, neon graphics, bots and online play.

## Run it locally

It's a static site with no build step, but ES modules need to be served over http:

```bash
python3 -m http.server 8080
```

then open http://localhost:8080.

## Tests

```bash
node --test tests/
```

## Layout

| File | What it does |
|---|---|
| `js/sim.js` | Game rules and simulation (no DOM). Produces a compact frame per tick. |
| `js/ai.js` | Computer players. |
| `js/art.js` | Bonus definitions and their pixel art. |
| `js/render.js` | Layered canvas renderer: static grid, blurred glow layer, incremental trails, effects. |
| `js/audio.js` | Synthesised sound effects. |
| `js/main.js` | Menus, HUD, input, local matches. |
