import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout/Layout';
import ProjectionGrid from './components/ProjectionGrid/ProjectionGrid';
import BalanceHeader from './components/BalanceHeader/BalanceHeader';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

export default function App() {
  const queryClient = useQueryClient();

  // ── WebSocket — real-time balance updates ─────────────────────────────────
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[FlowCast] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'BALANCE_UPDATE') {
            // Invalidate pay period queries so React Query refetches updated data
            queryClient.invalidateQueries({ queryKey: ['payPeriods'] });
            console.log('[FlowCast] Balance update received, refreshing grid');
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[FlowCast] WebSocket disconnected, reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[FlowCast] WebSocket error:', err);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [queryClient]);

  return (
    <Layout>
      <BalanceHeader />
      <ProjectionGrid />
    </Layout>
  );
}
