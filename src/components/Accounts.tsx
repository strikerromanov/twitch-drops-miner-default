import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Play, Pause, RefreshCw, LogIn, ExternalLink, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface Account { id: number; username: string; status: string; createdAt: string; lastActive: string | null; token_expires_at: number | null; }

type AuthStep = 'idle' | 'loading' | 'code' | 'polling' | 'success' | 'error';

function tokenStatus(exp: number | null) {
  if (!exp) return null;
  const mins = Math.floor((exp - Math.floor(Date.now() / 1000)) / 60);
  if (mins < 0)   return { label: 'Expired',              color: 'text-[#ef4444]' };
  if (mins < 60)  return { label: `Expires in ${mins}m`,  color: 'text-[#f59e0b]' };
  const hrs = Math.floor(mins / 60);
  return { label: `Valid ${hrs}h`, color: 'text-[#10b981]' };
}

export default function Accounts() {
  const [accounts,   setAccounts]  = useState<Account[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [authStep,   setAuthStep]  = useState<AuthStep>('idle');
  const [authError,  setAuthError] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [userCode,   setUserCode]  = useState('');
  const [verifyUrl,  setVerifyUrl] = useState('');
  const [clientId,   setClientId]  = useState('');
  const [hasClientId, setHasClientId] = useState(false);

  const load = useCallback(async () => {
    const [accountsRes, settingsRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/settings'),
    ]);
    if (accountsRes.ok) setAccounts(await accountsRes.json());
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      // FIX: check twitchClientId (camelCase) — not TWITCH_CLIENT_ID
      const cid = s.twitchClientId || '';
      setClientId(cid);
      setHasClientId(!!cid);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startAuth = async () => {
    try {
      setAuthStep('loading');
      setAuthError('');
      const res = await fetch('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start auth');
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerifyUrl(data.verification_uri);
      setAuthStep('code');
      pollAuth(data.device_code, data.interval || 5);
    } catch (e: any) {
      setAuthError(e.message);
      setAuthStep('error');
    }
  };

  const pollAuth = async (dc: string, interval: number) => {
    setAuthStep('polling');
    let attempts = 0;
    const maxAttempts = 60;
    const poll = async () => {
      if (attempts++ > maxAttempts) { setAuthError('Timed out waiting for authorization'); setAuthStep('error'); return; }
      try {
        const res = await fetch('/api/auth/device/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, deviceCode: dc, interval }),
        });
        if (res.status === 202) { setTimeout(poll, interval * 1000); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Auth failed');
        setAuthStep('success');
        setTimeout(() => { setAuthStep('idle'); load(); }, 2000);
      } catch (e: any) {
        if (e.message?.includes('authorization_pending')) { setTimeout(poll, interval * 1000); return; }
        setAuthError(e.message);
        setAuthStep('error');
      }
    };
    setTimeout(poll, interval * 1000);
  };

  const toggleAccount = async (id: number) => {
    await fetch(`/api/accounts/${id}/toggle`, { method: 'POST' });
    load();
  };

  const deleteAccount = async (id: number) => {
    if (!confirm('Remove this account?')) return;
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    load();
  };

  if (loading) return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 bg-[#27272a] rounded w-40" />
      <div className="h-48 bg-[#18181b] rounded-lg" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Accounts</h1>
          <p className="text-[#a1a1aa] text-sm mt-1">{accounts.length} account{accounts.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button onClick={() => setAuthStep('idle')} className="p-2 rounded-lg hover:bg-[#27272a] text-[#a1a1aa]">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Add account */}
      {!hasClientId ? (
        <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[#f59e0b]">Twitch Client ID required</p>
              <p className="text-sm text-[#a1a1aa] mt-1">
                Go to <strong>Settings</strong>, enter your Twitch Client ID, and click Save All before adding accounts.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#18181b] rounded-lg p-5 border border-[#27272a]">
          <h3 className="font-semibold mb-4">Add Twitch Account</h3>

          {authStep === 'idle' && (
            <button onClick={startAuth}
              className="px-4 py-2 bg-[#9146FF] hover:bg-[#7c3aed] rounded-lg font-medium text-sm flex items-center gap-2 transition-colors">
              <LogIn size={16} /> Login with Twitch
            </button>
          )}

          {authStep === 'loading' && (
            <div className="flex items-center gap-2 text-[#a1a1aa]">
              <RefreshCw size={16} className="animate-spin" /> Requesting device code…
            </div>
          )}

          {(authStep === 'code' || authStep === 'polling') && (
            <div className="space-y-4">
              <p className="text-sm text-[#a1a1aa]">
                Visit <a href={verifyUrl} target="_blank" rel="noreferrer"
                  className="text-[#9146FF] underline inline-flex items-center gap-1">
                  {verifyUrl} <ExternalLink size={12} />
                </a> and enter this code:
              </p>
              <div className="text-4xl font-mono font-bold tracking-widest text-[#9146FF] bg-[#09090b] px-6 py-4 rounded-lg inline-block">
                {userCode}
              </div>
              {authStep === 'polling' && (
                <div className="flex items-center gap-2 text-sm text-[#a1a1aa]">
                  <RefreshCw size={14} className="animate-spin" /> Waiting for authorization…
                </div>
              )}
            </div>
          )}

          {authStep === 'success' && (
            <div className="flex items-center gap-2 text-[#10b981]">
              <CheckCircle size={18} /> Account added successfully!
            </div>
          )}

          {authStep === 'error' && (
            <div className="space-y-3">
              <p className="text-[#ef4444] text-sm">{authError}</p>
              <button onClick={() => setAuthStep('idle')}
                className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] rounded-lg text-sm transition-colors">
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Account list */}
      {accounts.length === 0 ? (
        <div className="bg-[#18181b] rounded-lg p-12 border border-[#27272a] text-center">
          <Users size={40} className="mx-auto text-[#3f3f46] mb-3" />
          <p className="text-[#a1a1aa] font-medium">No accounts yet</p>
          <p className="text-[#71717a] text-sm mt-1">Add a Twitch account above to start farming drops.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(a => {
            const tok = tokenStatus(a.token_expires_at);
            return (
              <div key={a.id} className="bg-[#18181b] rounded-lg p-4 border border-[#27272a] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${a.status === 'farming' ? 'bg-[#10b981] animate-pulse' : a.status === 'error' ? 'bg-[#ef4444]' : 'bg-[#3f3f46]'}`} />
                  <div>
                    <p className="font-medium">{a.username}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs capitalize ${a.status === 'farming' ? 'text-[#10b981]' : a.status === 'error' ? 'text-[#ef4444]' : 'text-[#71717a]'}`}>
                        {a.status}
                      </span>
                      {tok && <span className={`text-xs ${tok.color}`}>· {tok.label}</span>}
                      {a.lastActive && <span className="text-xs text-[#71717a]">· Active {new Date(a.lastActive).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleAccount(a.id)}
                    className={`p-2 rounded-lg transition-colors ${a.status === 'farming' ? 'text-[#f59e0b] hover:bg-[#f59e0b]/10' : 'text-[#10b981] hover:bg-[#10b981]/10'}`}>
                    {a.status === 'farming' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button onClick={() => deleteAccount(a.id)}
                    className="p-2 rounded-lg text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Satisfy missing import in App.tsx
const Users = ({ size }: { size: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
