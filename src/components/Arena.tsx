import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '../game/connection';
import { startRenderer } from '../game/renderer';
import { defaultPowerups, effectStyle } from '../powerups';
import { type Direction, type Snapshot } from '../types';

export function Arena({ state, connection }: { state: Snapshot; connection: GameConnection }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [follow, setFollow] = useState('');
  const followRef = useRef('');
  followRef.current = follow;
  useEffect(() => {
    if (canvas.current) return startRenderer(canvas.current, connection, () => followRef.current);
  }, [connection]);
  const catalog = state.powerups ?? defaultPowerups;
  const me = state.players.find(p => p.id === connection.playerId);
  const result = state.members.find(p => p.id === connection.playerId)?.result;
  const ranked = [...state.players].sort((a,b) => b.points-a.points || b.score-a.score || a.name.localeCompare(b.name));
  return <section id="arena">
    <div className="scorebar">
      <div><small>YOUR POINTS</small><strong id="points">{me?.points.toLocaleString() ?? '—'}</strong></div>
      <div><small>TERRITORY</small><strong>{me ? `${me.score.toFixed(2)}%` : result ? `${result.score.toFixed(2)}% best` : '—'}</strong></div>
      <div><small>RANK</small><strong>{me ? `${ranked.findIndex(p => p.id===me.id)+1} / ${ranked.length}` : 'WATCHING'}</strong></div>
      <div><small>TRAIL CUTS</small><strong>{me?.kills ?? result?.kills ?? 0}</strong></div>
    </div>
    <div className="canvaswrap"><canvas id="canvas" ref={canvas} aria-label="Live territory arena" onPointerMove={e=>{if(!me)return;const rect=e.currentTarget.getBoundingClientRect();const dx=e.clientX-rect.left-rect.width/2,dy=e.clientY-rect.top-rect.height/2;if(Math.hypot(dx,dy)>12)connection.input(Math.atan2(dy,dx));}} />
      {!me && <div id="spectator"><b>{result ? `Eliminated · ${result.reason} · Spectating` : 'Match in progress · Spectating'}</b><select id="follow" aria-label="Spectate player" value={state.players.some(p=>p.id===follow) ? follow : ''} onChange={e=>setFollow(e.target.value)}><option value="">Whole arena</option>{state.players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></div>}
      <div className="canvaslegend">MOVE POINTER TO STEER · WASD / ARROWS ALSO WORK · SPACE TO DASH</div>
    </div>
    <div id="effects">{Object.entries(me?.effects ?? {}).map(([kind,time])=><div className="effect" key={kind}>{effectStyle(kind,catalog)?.image ? <img className="effect-image" src={effectStyle(kind,catalog).image!} alt=""/> : effectStyle(kind,catalog)?.symbol} {effectStyle(kind,catalog)?.name ?? kind}{kind==='slow'?' · slowed':kind==='dash'?' · active':''} · {time.toFixed(1)}s</div>)}</div>
    <div className="controls">{([['left','←'],['up','↑'],['down','↓'],['right','→']] as [Direction,string][]).map(([dir,label])=><button key={dir} aria-label={dir} disabled={!me} onPointerDown={e=>{e.preventDefault();connection.input(dir);}}>{label}</button>)}<button id="dash" disabled={!me || me.trail.length>0 || me.cooldown>0} onClick={()=>connection.input(null,true)}>{me && me.cooldown>0 ? `Dash · ${me.cooldown.toFixed(1)}s` : 'Dash · Space'}</button></div>
  </section>;
}
