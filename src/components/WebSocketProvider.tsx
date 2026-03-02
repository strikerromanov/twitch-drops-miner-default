import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

interface WsCtx { ws: WebSocket | null; connected: boolean; messages: any[]; send: (d: any) => void; }
const Ctx = createContext<WsCtx>({ ws: null, connected: false, messages: [], send: () => {} });
export const useWebSocket = () => useContext(Ctx);

export const WebSocketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [ws,        setWs]        = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages,  setMessages]  = useState<any[]>([]);
  const attemptsRef = useRef(0);                      // FIX: ref not state — no stale closure
  const [trigger,   setTrigger]   = useState(0);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sock  = new WebSocket(`${proto}//${window.location.host}/ws`);

    sock.onopen    = () => { attemptsRef.current = 0; setConnected(true); setWs(sock); };
    sock.onmessage = e => { try { setMessages(p => [...p.slice(-199), JSON.parse(e.data)]); } catch {} };
    sock.onclose   = () => {
      setConnected(false); setWs(null);
      attemptsRef.current++;
      if (attemptsRef.current <= 8) {
        const d = Math.min(2000 * 2 ** (attemptsRef.current - 1), 60_000);
        setTimeout(() => setTrigger(t => t + 1), d);
      }
    };
    sock.onerror = () => {};

    return () => { sock.onclose = null; sock.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const send = (d: any) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(d));
  return <Ctx.Provider value={{ ws, connected, messages, send }}>{children}</Ctx.Provider>;
};
