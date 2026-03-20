import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout/Layout';
import ProjectionGrid from './components/ProjectionGrid/ProjectionGrid';
import BalanceHeader from './components/BalanceHeader/BalanceHeader';
import SettingsPage from './pages/SettingsPage';
import TransactionsPage from './pages/TransactionsPage';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

function AppContent() {
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
            queryClient.invalidateQueries({ queryKey: ['payPeriods'] });
            queryClient.invalidateQueries({ queryKey: ['billGrid'] });
            queryClient.invalidateQueries({ queryKey: ['incomeGrid'] });
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
      <Routes>
        <Route path="/" element={
          <>
            <BalanceHeader />
            <ProjectionGrid />
          </>
        } />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
