import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: API_BASE });

// ── Inject X-Account-Id on every request ─────────────────────────────────────
api.interceptors.request.use((config) => {
  const accountId = localStorage.getItem('activeAccountId') || 'personal';
  config.headers['X-Account-Id'] = accountId;
  return config;
});

export default api;
