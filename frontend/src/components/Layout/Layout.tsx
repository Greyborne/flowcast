import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Flow<span className="text-blue-400">Cast</span>
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Cash Flow Projection Engine</p>
          </div>

          {/* ── Nav ── */}
          <nav className="flex gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/transactions"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              Transactions
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              Settings
            </NavLink>
          </nav>
        </div>

        <div className="text-sm text-gray-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 min-h-0 overflow-hidden p-6">
        {children}
      </main>
    </div>
  );
}
