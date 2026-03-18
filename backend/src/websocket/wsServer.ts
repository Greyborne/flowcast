/**
 * FlowCast WebSocket Server
 *
 * Broadcasts real-time balance updates to all connected clients.
 * When the cascade engine recomputes projections, it calls broadcast()
 * and the frontend re-renders without a page refresh.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err);
    });

    // Send a welcome ping
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'FlowCast WebSocket ready' }));
  });

  console.log('[WS] WebSocket server initialized');
}

/**
 * Broadcast a message to all connected WebSocket clients.
 * Called by the cascade service after recomputing balances.
 */
export function broadcast(data: object): void {
  if (!wss) return;

  const message = JSON.stringify(data);
  let sent = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    }
  });

  if (sent > 0) {
    console.log(`[WS] Broadcast to ${sent} client(s):`, data);
  }
}
