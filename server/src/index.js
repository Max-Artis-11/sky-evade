// Cloudflare Worker entry point.
// Every player connects to the same Durable Object ("main"), so the whole
// game is one big shared server with no codes or private lobbies.
import { GameRoom } from './room.js';

export { GameRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a websocket', { status: 426 });
      }
      const id = env.GAME.idFromName('main');
      return env.GAME.get(id).fetch(request);
    }

    return new Response('Sky Evade server is running', {
      headers: { 'content-type': 'text/plain' },
    });
  },
};
