// Online multiplayer configuration. See "Online multiplayer" in README.md.
export const NET_CONFIG = {
  // Signalling ("matchmaking") server that introduces browsers to each other.
  // null = the free public PeerJS server (0.peerjs.com). To use your own, e.g.:
  // peerServer: { host: 'peer.example.com', port: 443, path: '/', secure: true },
  peerServer: null,

  // ICE servers used to punch through NATs. STUN is enough for most home connections.
  // Players on strict networks (some offices, mobile carriers) also need a TURN relay;
  // the PeerJS ones below are free but best-effort. Add your own for reliability, e.g.
  // { urls: 'turn:global.relay.metered.ca:443', username: '...', credential: '...' },
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ],

  // Room codes are registered on the signalling server as roomPrefix + CODE.
  roomPrefix: 'lightline-v1-',
};
