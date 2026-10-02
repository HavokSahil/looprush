import { useEffect, useState, type ReactNode } from 'react';
import { Leaderboard } from './Leaderboard';
import { api, ApiError, errorMessage } from '../api';
import type { LobbyData, Profile } from '../types';

export function Row({ left, right, self = false, color, rank }: { left: ReactNode; right: ReactNode; self?: boolean; color?: string; rank?: number }) {
  return <div className={`row${self ? ' self' : ''}${rank ? ` rank-gradient rank-${Math.min(rank,4)}` : ''}`} style={color ? { borderLeft: `3px solid ${color}`, paddingLeft: 8 } : undefined}><b>{left}</b><strong>{right}</strong></div>;
}

export function Lobby({ profile, authForm, onJoin, onExpired }: {
  profile: Profile | null; authForm?: ReactNode; onJoin?: () => void; onExpired: () => void;
}) {
  const [data, setData] = useState<LobbyData>({ rooms: [], leaderboard: [], history: [] });
  const [room, setRoom] = useState('FRIENDS');
  const [size, setSize] = useState(256);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const next = await api<LobbyData>('lobby', undefined, controller.signal); if (!controller.signal.aborted) setData(next); }
      catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 5000); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [profile?.id]);
  async function join() {
    setBusy(true); setError('');
    try { await api('join', { room, size }); onJoin?.(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <main id="lobby">
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> AFTER HOURS / TERRITORY ARCADE</div><h1>Big loops.<br /><em>Dirty moves.</em></h1><p>Tease the edge. Leave a trail. Bring it home.<br />Longer isn't always better. Closing the loop is.</p><div className="chips"><span>01 / THE TEASE</span><span>02 / THE CHASE</span><span>03 / THE CLIMAX</span></div><div className="hero-stats"><span><b>30</b> Hz of chemistry</span><span><b>8</b> players, one room</span><span><b>5</b> little stimulants</span></div></div>
      <div className="rave-poster" aria-hidden="true"><div className="poster-grid" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><span className="poster-top">EST. AFTER DARK / NO BORING MOVES</span><div className="poster-title">LOOP<br /><span>ME</span><br />BABY<span className="poster-star">✳</span></div><div className="poster-sticker">SIZE MATTERS.<br /><b>TIMING MORE.</b></div><div className="equalizer">{Array.from({length:12},(_,i)=><i key={i} style={{height:`${18+(i*17)%52}px`}} />)}</div><span className="poster-bottom">CLOSE IT. CLAIM IT. DO IT AGAIN. ↗</span></div>
    </section>
    <div className="columns">
      {profile ? <section className="card" id="roomcard"><div className="eyebrow">PLAYING AS {profile.name}</div><h2>Find your playroom.</h2>
        <form onSubmit={e => { e.preventDefault(); void join(); }}>
          <label>Room code<input value={room} onChange={e => setRoom(e.target.value)} pattern="[A-Za-z0-9\-]{3,16}" maxLength={16} required disabled={busy} /></label>
          <div className="settings"><label>Arena size<select value={size} onChange={e => setSize(Number(e.target.value))} disabled={busy}><option value={192}>Quickie · 192 × 192</option><option value={256}>Sweet spot · 256 × 256</option><option value={384}>All night · 384 × 384</option></select></label></div>
          <p className="fine">Settings apply to new rooms. Everyone readies up before the host starts.</p>
          <button disabled={busy}>{busy ? 'Joining…' : 'Enter room →'}</button>
        </form>
        <div id="rooms">{data.rooms.map(r => <button key={r.name} className="secondary" onClick={() => setRoom(r.name)}>{r.name} · {r.players} people · {r.n}² · {r.phase}</button>)}</div>
      </section> : authForm}
      <Leaderboard entries={data.leaderboard} playerId={profile?.id} />
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="rules">{[['Find your rhythm','WASD / arrows or the touch pad. Keep it moving. No reversing.'],['Bring it home','Leave your color, draw a loop, then come home to fill it. A satisfying finish.'],['Use protection','Walls, your own trail, and rival heads kill the mood. Watch your boundaries.'],['Save your burst','Space activates dash from home territory. Timing is everything.']].map(([title, text]) => <div key={title}><b>{title}</b><p>{text}</p></div>)}</section>
    {profile && <section id="history">{data.history.length > 0 && <div className="eyebrow">YOUR RECENT RUNS</div>}{data.history.map((p,i) => <Row key={`${p.created}-${i}`} left={`${new Date(p.created*1000).toLocaleString()} · ${p.reason}`} right={`${p.score.toFixed(2)}% · ${p.kills} cuts`} />)}</section>}
  </main>;
}
