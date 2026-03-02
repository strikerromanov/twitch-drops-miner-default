import React, { useState } from 'react';
import { WebSocketProvider, useWebSocket } from './components/WebSocketProvider';
import Dashboard  from './components/Dashboard';
import Accounts   from './components/Accounts';
import Settings   from './components/Settings';
import Betting    from './components/Betting';
import { LayoutDashboard, Users, Settings as Cog, TrendingUp, Wifi, WifiOff } from 'lucide-react';

type Page = 'dashboard' | 'accounts' | 'settings' | 'betting';

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'accounts',  label: 'Accounts',  icon: <Users size={18} /> },
  { id: 'settings',  label: 'Settings',  icon: <Cog size={18} /> },
  { id: 'betting',   label: 'Betting',   icon: <TrendingUp size={18} /> },
];

function StatusBar() {
  const { connected } = useWebSocket();
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
      connected ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-[#ef4444]/10 text-[#ef4444]'
    }`}>
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {connected ? 'Live' : 'Offline'}
    </div>
  );
}

function Inner() {
  const [page, setPage] = useState<Page>('dashboard');
  return (
    <div className="flex h-screen bg-[#09090b] text-[#fafafa] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-[#18181b] border-r border-[#27272a] flex flex-col">
        <div className="p-5 border-b border-[#27272a]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#9146FF] rounded-lg flex items-center justify-center text-white text-sm font-bold">T</div>
            <span className="font-semibold text-sm">Drops Miner</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                page === n.id
                  ? 'bg-[#9146FF]/10 text-[#9146FF]'
                  : 'text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa]'
              }`}>
              {n.icon} {n.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-[#27272a]">
          <StatusBar />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {page === 'dashboard' && <Dashboard />}
        {page === 'accounts'  && <Accounts />}
        {page === 'settings'  && <Settings />}
        {page === 'betting'   && <Betting />}
      </main>
    </div>
  );
}

export default function App() {
  return <WebSocketProvider><Inner /></WebSocketProvider>;
}
