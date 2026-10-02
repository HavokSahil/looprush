import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { GameConnection } from '../game/connection';
import { colors, type Direction, type Snapshot } from '../types';
import { Avatar } from './Avatar';
import { Arena } from './Arena';
import { Chat } from './Chat';
import { Row } from './Lobby';

export function Room({ state, connection, rtt, networkError, onExpired }: {
  state: Snapshot; connection: GameConnection; rtt: number; networkError: string; onExpired: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const me = state.players.find(p=>p.id===connection.playerId);
  const member = state.members.find(p=>p.id===connection.playerId);
  const active = state.phase==='playing';
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (active && element.current?.requestFullscreen) await element.current.requestFullscreen();
      else setError('Fullscreen is unavailable in this browser.');
    } catch { setError('Fullscreen could not open. Try the fullscreen button again.'); }
  }, [active]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    const keys: Record<string,Direction> = { ArrowUp:'up', w:'up', ArrowDown:'down', s:'down', ArrowLeft:'left', a:'left', ArrowRight:'right', d:'right' };
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('input,select,textarea') || e.target.isContentEditable)) return;
      if (e.code==='Space' && e.target instanceof HTMLElement && e.target.closest('button')) return;
      if (e.key.toLowerCase()==='f' && !e.repeat && (active || document.fullscreenElement)) { void toggleFullscreen(); return; }
      const dir=keys[e.key] || keys[e.key.toLowerCase()];
      if (dir || e.code==='Space') { e.preventDefault(); if (!e.repeat) connection.input(dir ?? null,e.code==='Space'); }
    };
    document.addEventListener('fullscreenchange',changed); window.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('fullscreenchange',changed); window.removeEventListener('keydown',keydown); };
  }, [active,connection,toggleFullscreen]);
  useEffect(() => {
    if (!active || !window.matchMedia?.('(pointer: coarse)').matches) return;
    const y=window.scrollY;
    const body=document.body,root=document.documentElement;
    const previous={bodyPosition:body.style.position,bodyTop:body.style.top,bodyLeft:body.style.left,bodyRight:body.style.right,bodyWidth:body.style.width,bodyOverflow:body.style.overflow,rootOverflow:root.style.overflow};
    const stopTouchScroll=(event:TouchEvent)=>event.preventDefault();
    body.style.position='fixed';body.style.top=`-${y}px`;body.style.left='0';body.style.right='0';body.style.width='100%';body.style.overflow='hidden';root.style.overflow='hidden';
    document.addEventListener('touchmove',stopTouchScroll,{passive:false});
    return ()=>{
      document.removeEventListener('touchmove',stopTouchScroll);
      body.style.position=previous.bodyPosition;body.style.top=previous.bodyTop;body.style.left=previous.bodyLeft;body.style.right=previous.bodyRight;body.style.width=previous.bodyWidth;body.style.overflow=previous.bodyOverflow;root.style.overflow=previous.rootOverflow;
      window.scrollTo(0,y);
    };
  }, [active]);
  async function action(path: string, data: unknown = {}): Promise<boolean> {
    setError('');
    try { await api(path,data); connection.refresh(); return true; }
    catch (e) { if (e instanceof ApiError && e.status===401) onExpired(); else setError(errorMessage(e)); return false; }
  }
  async function buttonAction(path: string) {
    if (busy) return;
    setBusy(true); const ok=await action(path);
    if (ok && path==='leave' && document.fullscreenElement) await document.exitFullscreen().catch(()=>{});
    setBusy(false);
  }
  const ranked=[...state.players].sort((a,b)=>b.points-a.points || b.score-a.score || a.name.localeCompare(b.name));
  return <section id="session" ref={element}>
    <div className="sessionbar"><div><div className="eyebrow">ROOM / {state.room} · {state.n} × {state.n}</div><h2>{active ? me ? 'Keep your rhythm. Own your finish.' : 'Enjoy the view. No performance pressure.' : state.phase==='finished' ? 'Ready for round two?' : 'The pre-game tease.'}</h2></div><div className="buttons"><span id="network" role="status" className={networkError ? 'warn' : ''}>{networkError || `${Math.round(rtt)} ms · direct input`}</span>{(active || fullscreen) && <button className="secondary" onClick={()=>void toggleFullscreen()}>⛶ {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>}<button className="secondary" disabled={busy} onClick={()=>void buttonAction('leave')}>Leave room</button></div></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="sessionlayout"><div className="stage">
      {active ? <Arena state={state} connection={connection} /> : <section id="waiting" className="card"><div className="eyebrow">{state.members.length} PEOPLE · {state.n} × {state.n} ARENA</div><h1>Good company.<br /><em>Bad intentions.</em></h1><p id="waitnote">{state.phase==='finished' ? 'Everybody finished. Catch your breath, then ready up for another round.' : 'Get a room. Share its code and server address. Everyone readies up; the host sets the tempo.'}</p><div id="roster">{state.members.map(m=><Row key={m.id} left={<span className="player-name"><Avatar profile={m}/>{m.name}{m.id===state.host?' · HOST':''}</span>} right={m.ready?'READY':m.result?`${m.result.score}% · ${m.result.reason}`:'Getting ready'} />)}</div><div className="buttons"><button disabled={busy} onClick={()=>void buttonAction('ready')}>{member?.ready?'Cancel ready':'Ready up'}</button>{state.host===connection.playerId && <button className="secondary" disabled={busy || state.members.length>8 || !state.members.every(m=>m.ready)} onClick={()=>void buttonAction('start')}>Start match →</button>}</div>{state.members.length>8 && <p className="fine">At most eight people can start. Extra spectators must leave before the next round.</p>}</section>}
    </div><aside><section className="card"><div className="eyebrow">{active?'LIVE RANKING':'IN THIS ROOM'}</div>{active ? ranked.map((p,i)=><Row key={p.id} rank={i+1} left={<span className="player-name">{i+1}. <Avatar profile={p}/>{p.name}</span>} right={`${p.points.toLocaleString()} pts · ${p.score.toFixed(1)}%`} self={p.id===connection.playerId} color={colors[p.slot-1]} />) : state.members.map(m=><Row key={m.id} left={<span className="player-name"><Avatar profile={m}/>{m.name}</span>} right={m.ready?'Ready':'Waiting'} />)}<p className="fine">Live points = territory area + 100 per trail cut.</p></section><Chat messages={state.messages} send={text=>action('chat',{text})} /></aside></div>
  </section>;
}
