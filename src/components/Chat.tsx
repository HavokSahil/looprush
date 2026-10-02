import { useEffect, useRef, useState } from 'react';
import type { Message } from '../types';

export function Chat({ messages, send }: { messages: Message[]; send: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = messages.at(-1)?.id;
  useEffect(() => { if (pinned.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [lastId]);
  return <section className="card chatcard"><div className="eyebrow">ROOM CHAT / TALK LOOP TO ME</div>
    <div id="messages" ref={log} role="log" aria-live="polite" onScroll={e => { const el=e.currentTarget; pinned.current=el.scrollHeight-el.scrollTop-el.clientHeight<50; }}>
      {!messages.length && <p className="fine">Break the ice. Keep the chemistry going.</p>}
      {messages.map(m => <div className="chatmessage" key={m.id}><b>{m.name}</b><span>{m.text}</span></div>)}
    </div>
    <form id="chatform" onSubmit={async e => { e.preventDefault(); if (busy || !text.trim()) return; setBusy(true); const sent = await send(text); if (sent) { setText(''); pinned.current=true; } setBusy(false); }}>
      <input id="message" value={text} onChange={e => setText(e.target.value)} placeholder="Talk loop to me…" maxLength={240} autoComplete="off" aria-label="Chat message" required disabled={busy} /><button aria-label="Send message" disabled={busy || !text.trim()}>↑</button>
    </form>
  </section>;
}
