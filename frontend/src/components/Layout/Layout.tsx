import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Flow<span className="text-blue-400">Cast</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Cash Flow Projection Engine</p>
        </div>
        <div className="text-sm text-gray-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="p-6">
        {children}
      </main>
    </div>
  );
}
