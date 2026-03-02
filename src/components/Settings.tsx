import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';   // FIX: was 'framer-motion'
import { Save, RotateCcw, Bell, Palette, Key, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function Settings() {
  const [settings,  setSettings]  = useState<Record<string,string>>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [ok,        setOk]        = useState(false);
  const [err,       setErr]       = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/settings');
    if (res.ok) setSettings(await res.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const set = (k: string, v: string) => setSettings(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(''); setOk(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setOk(true); setTimeout(() => setOk(false), 3000);
    } catch (e: any) { setErr(e.message); setTimeout(() => setErr(''), 6000); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm('Reset all settings and remove all accounts?')) return;
    await fetch('/api/factory-reset', { method: 'POST' });
    load();
  };

  if (loading) return <div className="p-6 animate-pulse space-y-4"><div className="h-8 bg-[#27272a] rounded w-40"/><div className="h-64 bg-[#18181b] rounded-lg"/></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-[#a1a1aa] text-sm mt-1">Configure your application preferences</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
            <RotateCcw size={14} /> Reset All
          </button>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#9146FF] hover:bg-[#7c3aed] disabled:opacity-50 rounded-lg text-sm font-medium text-white flex items-center gap-2 transition-colors">
            <Save size={14} /> {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {ok  && <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex items-center gap-2 bg-[#10b981]/10 border border-[#10b981]/20 rounded-lg p-4 text-[#10b981]"><CheckCircle2 size={16}/> Settings saved!</motion.div>}
        {err && <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex items-center gap-2 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg p-4 text-[#ef4444]"><AlertTriangle size={16}/> {err}</motion.div>}
      </AnimatePresence>

      {/* Twitch Config */}
      <Section title="Twitch Configuration" icon={<Key size={18}/>}>
        <Field label="Twitch Client ID" desc="From dev.twitch.tv/console – no client secret needed (Device Code Flow)">
          <input type="password" value={settings.twitchClientId || ''} onChange={e => set('twitchClientId', e.target.value)}
            placeholder="Paste your client ID…"
            className="w-full px-3 py-2 bg-[#09090b] border border-[#27272a] focus:border-[#9146FF] rounded-lg text-[#fafafa] outline-none transition-colors" />
        </Field>
      </Section>

      {/* Notifications */}
      <Section title="Notifications" icon={<Bell size={18}/>}>
        {[
          ['NOTIFY_DROPS',  'Drop Alerts',   'Notify when a drop is claimed'],
          ['NOTIFY_POINTS', 'Points Alerts', 'Notify when points are earned'],
          ['NOTIFY_ERRORS', 'Error Alerts',  'Notify on errors or token issues'],
          ['NOTIFY_SOUND',  'Sound Effects', 'Play a sound on alerts'],
        ].map(([key, label, desc]) => (
          <Field key={key} label={label} desc={desc} row>
            <Toggle value={settings[key] === 'true'} onChange={v => set(key, v.toString())} />
          </Field>
        ))}
      </Section>

      {/* Appearance */}
      <Section title="Appearance" icon={<Palette size={18}/>}>
        <Field label="Theme" desc="Choose between dark, light, or system theme">
          <select value={settings.THEME_MODE || 'dark'} onChange={e => set('THEME_MODE', e.target.value)}
            className="px-3 py-2 bg-[#09090b] border border-[#27272a] rounded-lg text-[#fafafa] outline-none">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="auto">System</option>
          </select>
        </Field>
        <Field label="Accent Color">
          <div className="flex gap-2">
            {['#9146FF','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899'].map(c=>(
              <button key={c} onClick={()=>set('ACCENT_COLOR',c)}
                className={`w-9 h-9 rounded-lg transition-all ${settings.ACCENT_COLOR===c?'ring-2 ring-white ring-offset-2 ring-offset-[#18181b] scale-110':'hover:scale-105'}`}
                style={{backgroundColor:c}}/>
            ))}
          </div>
        </Field>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#18181b] rounded-lg p-5 border border-[#27272a] space-y-4">
      <div className="flex items-center gap-2 mb-5">
        <div className="p-2 bg-[#27272a] rounded-lg text-[#a1a1aa]">{icon}</div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, desc, row, children }: { label: string; desc?: string; row?: boolean; children: React.ReactNode }) {
  return (
    <div className={`${row ? 'flex items-center justify-between' : ''} bg-[#09090b] rounded-lg p-3 border border-[#27272a]`}>
      <div className={row ? '' : 'mb-2'}>
        <p className="font-medium text-sm text-[#fafafa]">{label}</p>
        {desc && <p className="text-xs text-[#71717a] mt-0.5">{desc}</p>}
      </div>
      <div className={row ? '' : 'w-full'}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-[#9146FF]' : 'bg-[#27272a]'}`}>
      <motion.div className="absolute top-1 w-4 h-4 bg-white rounded-full"
        animate={{ left: value ? 24 : 4 }} transition={{ type:'spring', stiffness:500, damping:30 }} />
    </button>
  );
}
