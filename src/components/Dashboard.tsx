import React, { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Monitor, Zap, Trophy, Activity, Tv, TrendingUp, AlertCircle } from 'lucide-react';
import { useWebSocket } from './WebSocketProvider';

interface Stats { totalAccounts:number; activeAccounts:number; totalDrops:number; claimedDrops:number; recentClaims:number; activeStreams:number; }
const EMPTY: Stats = { totalAccounts:0, activeAccounts:0, totalDrops:0, claimedDrops:0, recentClaims:0, activeStreams:0 };
const COLORS = ['#9146FF','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899'];

function Empty({ msg }: { msg: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2">
      <AlertCircle size={28} className="text-[#3f3f46]" />
      <p className="text-[#71717a] text-sm text-center px-4">{msg}</p>
    </div>
  );
}

export default function Dashboard() {
  const { messages } = useWebSocket();
  const [stats,   setStats]   = useState<Stats>(EMPTY);
  const [history, setHistory] = useState<any[]>([]);
  const [streams, setStreams] = useState<any[]>([]);
  const [games,   setGames]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string|null>(null);

  const load = useCallback(async () => {
    try {
      const [sr,hr,str,gr] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/points-history?days=7'),
        fetch('/api/active-streams'),
        fetch('/api/game-distribution'),
      ]);
      if (sr.ok)   setStats(await sr.json());
      if (hr.ok)   setHistory(await hr.json());
      if (str.ok)  setStreams(await str.json());
      if (gr.ok)   setGames(await gr.json());
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  useEffect(() => {
    const last = [...messages].reverse().find((m: any) => m.type === 'stats');
    if (last?.data) setStats(s => ({ ...s, ...last.data }));
  }, [messages]);

  const pct = stats.totalDrops > 0 ? Math.round((stats.claimedDrops / stats.totalDrops) * 100) : 0;

  const cards = [
    { label: 'Total Accounts',  value: stats.totalAccounts,  icon: <Monitor size={20} />,  color: '#9146FF', sub: `${stats.activeAccounts} farming` },
    { label: 'Active Streams',  value: stats.activeStreams,  icon: <Tv size={20} />,       color: '#3b82f6', sub: 'live now' },
    { label: 'Total Drops',     value: stats.totalDrops,     icon: <Trophy size={20} />,   color: '#f59e0b', sub: `${stats.claimedDrops} claimed` },
    { label: 'Points (24h)',    value: stats.recentClaims,   icon: <Zap size={20} />,      color: '#10b981', sub: 'claim events' },
  ];

  if (loading) return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 bg-[#27272a] rounded w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><div key={i} className="h-28 bg-[#18181b] rounded-lg"/>)}</div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-[#a1a1aa] text-sm mt-1">Real-time farming overview</p>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-[#f59e0b] text-sm bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-[#18181b] rounded-lg p-5 border border-[#27272a]">
            <div className="flex justify-between mb-3">
              <span className="text-xs text-[#71717a] uppercase tracking-wider">{c.label}</span>
              <span style={{ color: c.color }}>{c.icon}</span>
            </div>
            <p className="text-3xl font-bold">{c.value.toLocaleString()}</p>
            <p className="text-xs text-[#71717a] mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#18181b] rounded-lg p-5 border border-[#27272a]">
          <div className="flex items-center gap-2 mb-4"><TrendingUp size={18} className="text-[#9146FF]" /><h3 className="font-semibold">Points Claimed (7 days)</h3></div>
          {history.length < 2 ? <Empty msg="Points history will appear here once farming begins" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="label" tick={{ fill:'#71717a', fontSize:11 }} />
                <YAxis tick={{ fill:'#71717a', fontSize:11 }} />
                <Tooltip contentStyle={{ backgroundColor:'#18181b', border:'1px solid #27272a', borderRadius:8 }} labelStyle={{ color:'#fafafa' }} />
                <Line type="monotone" dataKey="total" stroke="#9146FF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-[#18181b] rounded-lg p-5 border border-[#27272a]">
          <div className="flex items-center gap-2 mb-4"><Trophy size={18} className="text-[#f59e0b]" /><h3 className="font-semibold">Drops by Game</h3></div>
          {games.length === 0 ? <Empty msg="Game data will appear once drops are tracked" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={games}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="game" tick={{ fill:'#71717a', fontSize:10 }} />
                <YAxis tick={{ fill:'#71717a', fontSize:11 }} />
                <Tooltip contentStyle={{ backgroundColor:'#18181b', border:'1px solid #27272a', borderRadius:8 }} />
                <Bar dataKey="drops" radius={[4,4,0,0]}>{games.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-[#18181b] rounded-lg p-5 border border-[#27272a]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Activity size={18} className="text-[#10b981]" /><h3 className="font-semibold">Drop Completion</h3></div>
          <span className="text-lg font-bold text-[#10b981]">{pct}%</span>
        </div>
        <div className="h-3 bg-[#27272a] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width:`${pct}%`, background:'linear-gradient(90deg,#9146FF,#10b981)' }} />
        </div>
        <div className="flex justify-between text-xs text-[#71717a] mt-2">
          <span>{stats.claimedDrops} claimed</span>
          <span>{stats.totalDrops} total</span>
        </div>
      </div>

      <div className="bg-[#18181b] rounded-lg border border-[#27272a] overflow-hidden">
        <div className="p-4 border-b border-[#27272a] flex items-center gap-2">
          <Tv size={16} className="text-[#3b82f6]" />
          <h3 className="font-semibold">Active Streams</h3>
          {stats.activeStreams > 0 && <span className="ml-auto bg-[#3b82f6]/20 text-[#3b82f6] text-xs px-2 py-0.5 rounded-full">{stats.activeStreams} live</span>}
        </div>
        {streams.length === 0 ? (
          <div className="p-10 text-center">
            <Tv size={32} className="mx-auto text-[#3f3f46] mb-3" />
            <p className="text-[#a1a1aa] font-medium">No active streams</p>
            <p className="text-[#71717a] text-sm mt-1">Streams appear here when accounts start watching.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#27272a]">
              {['Account','Channel','Game','Since'].map(h=><th key={h} className="px-4 py-3 text-left text-xs text-[#71717a] uppercase">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-[#27272a]">
              {streams.map((r,i)=>(
                <tr key={i} className="hover:bg-[#27272a]/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.username}</td>
                  <td className="px-4 py-3 text-[#a1a1aa]">{r.streamer}</td>
                  <td className="px-4 py-3 text-[#a1a1aa]">{r.game||'—'}</td>
                  <td className="px-4 py-3 text-[#71717a] text-xs">{r.started_at ? new Date(r.started_at).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
