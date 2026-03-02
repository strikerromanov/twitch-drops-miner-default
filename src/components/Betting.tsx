import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, TrendingDown, Award, Coins } from 'lucide-react';

interface BettingStats { totalBets:number; wins:number; losses:number; netProfit:number; winRate:number; }
interface Bet { id:number; streamer_name:string; prediction_title:string; outcome_selected:string; outcome_percentage:number; points_wagered:number; points_won:number; outcome:string|null; profit:number; timestamp:string; }

const DEFAULT: BettingStats = { totalBets:0, wins:0, losses:0, netProfit:0, winRate:0 };

export default function Betting() {
  const [stats,   setStats]   = useState<BettingStats>(DEFAULT);
  const [history, setHistory] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [sr, hr] = await Promise.all([fetch('/api/betting-stats'), fetch('/api/betting-history?limit=50')]);
        if (sr.ok)   setStats(await sr.json());
        if (hr.ok)   setHistory(await hr.json());
        setError('');
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const cards = [
    { label:'Total Bets',  value: stats.totalBets,                                  icon:<Target size={18}/>,       color:'#9146FF' },
    { label:'Win Rate',    value: `${(stats.winRate ?? 0).toFixed(1)}%`,             icon:<Award size={18}/>,        color:'#10b981' },  // FIX: was {stats?.winRate.toFixed(1)}% || 0
    { label:'Wins',        value: stats.wins,                                        icon:<TrendingUp size={18}/>,   color:'#10b981' },
    { label:'Losses',      value: stats.losses,                                      icon:<TrendingDown size={18}/>, color:'#ef4444' },
    { label:'Net Profit',  value: `${stats.netProfit>=0?'+':''}${stats.netProfit?.toLocaleString()} pts`, icon:<Coins size={18}/>, color: stats.netProfit>=0?'#10b981':'#ef4444' },
  ];

  if (loading) return <div className="p-6 animate-pulse space-y-4"><div className="h-8 bg-[#27272a] rounded w-40"/><div className="h-48 bg-[#18181b] rounded-lg"/></div>;

  if (error) return (
    <div className="p-6">
      <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg p-6 text-center">
        <p className="text-[#ef4444] font-medium">Failed to load betting data</p>
        <p className="text-[#a1a1aa] text-sm mt-1">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Predictions & Betting</h1>
        <p className="text-[#a1a1aa] text-sm mt-1">Automated channel point betting history</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-[#18181b] rounded-lg p-4 border border-[#27272a]">
            <div className="flex items-center gap-2 mb-2" style={{color:c.color}}>{c.icon}<span className="text-xs text-[#a1a1aa]">{c.label}</span></div>
            <p className="text-2xl font-bold" style={{color:c.color}}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#18181b] rounded-lg border border-[#27272a] overflow-hidden">
        <div className="p-4 border-b border-[#27272a]"><h3 className="font-semibold">Betting History</h3></div>
        {history.length === 0 ? (
          <div className="p-12 text-center">
            <Target size={36} className="mx-auto text-[#3f3f46] mb-3"/>
            <p className="text-[#a1a1aa] font-medium">No betting history yet</p>
            <p className="text-[#71717a] text-sm mt-1">Bets will appear here once the betting service places its first prediction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#27272a]">
                {['Channel','Prediction','Picked','Odds','Wagered','Result'].map(h=><th key={h} className="px-4 py-3 text-left text-xs text-[#71717a] uppercase">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#27272a]">
                {history.map(b=>(
                  <tr key={b.id} className="hover:bg-[#27272a]/40 transition-colors">
                    <td className="px-4 py-3 font-medium">{b.streamer_name}</td>
                    <td className="px-4 py-3 text-[#a1a1aa] max-w-xs truncate">{b.prediction_title}</td>
                    <td className="px-4 py-3 text-[#a1a1aa]">{b.outcome_selected}</td>
                    <td className="px-4 py-3 text-[#a1a1aa]">{b.outcome_percentage?.toFixed(0)||'—'}%</td>
                    <td className="px-4 py-3 text-[#a1a1aa]">{b.points_wagered?.toLocaleString()||0}</td>
                    <td className={`px-4 py-3 font-semibold ${b.outcome==='won'?'text-[#10b981]':b.outcome==='lost'?'text-[#ef4444]':'text-[#a1a1aa]'}`}>
                      {b.outcome==='won' ? `+${b.profit?.toLocaleString()||0}` : b.outcome==='lost' ? `-${b.points_wagered?.toLocaleString()||0}` : 'Pending'} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
