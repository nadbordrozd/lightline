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
| `js/online.js` | Online lobby, host and guest sessions. |
| `js/net.js` | WebRTC transport (PeerJS). |
| `js/config.js` | Signalling and TURN server settings for online play. |

## Online multiplayer

Online matches are browser-to-browser. The host's browser runs the game, and each guest sends
only its key presses and receives the result 30 times a second (well under 1 KB/s per guest).
The host clicks *Create room*, shares the 4-letter code or invite link, and others join.

No game server is needed, but three outside services are involved, all set in `js/config.js`:

1. **Signalling (matchmaking).** Browsers need a go-between to exchange connection details before
   they can talk directly. By default this is the free public PeerJS server (`0.peerjs.com`).
   It's fine for casual use but has no uptime guarantee. To run your own, deploy
   [peerjs-server](https://github.com/peers/peerjs-server) (one `npx peerjs --port 9000` on any
   Node host) and set `peerServer` in `js/config.js`.
2. **STUN.** Lets browsers discover their public address. Google's free STUN servers are used.
3. **TURN (relay).** Needed when a player is behind a strict NAT or firewall (some offices,
   universities, mobile carriers), roughly 1 in 10 connections. The config includes PeerJS's free
   public TURN servers as a best-effort fallback. For reliability, sign up for a TURN provider
   (Metered.ca and Cloudflare both have free tiers) and add its credentials to `iceServers`.
   Note that anything in `config.js` is visible to visitors, so use credentials scoped to TURN only.

The host's tab can be in the background: the simulation is driven from a Web Worker timer so it
isn't throttled. If the host leaves, the room closes.

## Hosting

Any static host works and it must be served over https for online play. With GitHub Pages:
Settings → Pages → Deploy from a branch → `main` / root.
