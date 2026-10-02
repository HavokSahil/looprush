import { roundTrail } from './curves';
import type { Point } from './curves';
import { defaultPowerups } from '../powerups';
import { colors } from '../types';
import type { GameConnection } from './connection';

// requestAnimationFrame owns the pixels; React never updates state per frame.
export function startRenderer(canvas: HTMLCanvasElement, connection: GameConnection, getFollow: () => string) {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const ctx = context;
  const images = new Map<string, HTMLImageElement>();
  function loadedImage(url: string | null | undefined) {
    if (!url) return null;
    let image = images.get(url);
    if (!image) {
      image = new Image(); image.src = url; images.set(url,image);
      if (images.size > 64) images.delete(images.keys().next().value!);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }
  let camera: {x:number;y:number} | null = null;
  let lastDraw = performance.now();
  let frameId = 0;
  let previousPhase = '';
  function draw(now: number) {
    frameId = requestAnimationFrame(draw);
    const dt = Math.min(.05,(now-lastDraw)/1000); lastDraw = now;
    const frames = connection.frames;
    if (!frames.length) return;
    const state = frames[frames.length-1];
    if (state.phase !== previousPhase) { camera = null; previousPhase = state.phase; }
    if (state.phase !== 'playing') return;
    const playerId = connection.playerId, followId = getFollow();
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1,2), w = rect.width, h = rect.height;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
      canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    }
// Draw the newest received state immediately; no fixed render latency.
const a=state,unit=a.unit??1;
const elapsed=Math.min(.05,Math.max(0,(now-(connection.clockOffset??now))/1000-a.time));
const positions=new Map(a.players.map(p=>{
  const heading=p.heading??({right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2}[p.dir]);
  const travel=(p.speed??0)*elapsed;
  return [p.id,{x:(p.x+Math.cos(heading)*travel)/unit,y:(p.y+Math.sin(heading)*travel)/unit}];
}));
const me=a.players.find(p=>p.id===playerId),focus=me||a.players.find(p=>p.id===followId),pos=focus?positions.get(focus.id):null;
const span=focus?Math.min(a.n/unit,34):a.n/unit+4,scale=Math.min(w,h)/span;
const desired={x:pos?pos.x+.5/unit:a.n/unit/2,y:pos?pos.y+.5/unit:a.n/unit/2};
if(!camera)camera=desired;
const ease=1-Math.exp(-dt*18);camera.x+=(desired.x-camera.x)*ease;camera.y+=(desired.y-camera.y)*ease;
ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#090514';ctx.fillRect(0,0,w,h);ctx.translate(w/2-camera.x*scale,h/2-camera.y*scale);ctx.scale(scale,scale);ctx.fillStyle='#170f2a';ctx.fillRect(0,0,a.n/unit,a.n/unit);ctx.strokeStyle='#b446e8';ctx.lineWidth=.12;ctx.strokeRect(0,0,a.n/unit,a.n/unit);
// Contiguous territory has no cell outlines or gaps.
for(let y=0;y<a.n;y++){for(let x=0;x<a.n;){const slot=a.grid[y*a.n+x];let end=x+1;while(end<a.n&&a.grid[y*a.n+end]===slot)end++;if(slot){ctx.globalAlpha=.48;ctx.fillStyle=colors[slot-1];ctx.fillRect(x/unit,y/unit,(end-x)/unit,1.01/unit)}x=end}}ctx.globalAlpha=1;
const visible=(x:number,y:number)=>!me||me.effects.radar||Math.hypot(x-me.x/unit,y-me.y/unit)<19;
for(const p of a.players) {
  if(!p.trail.length)continue;
  ctx.strokeStyle=colors[p.slot-1];ctx.lineWidth=.45;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  let segment: Point[]=[];
  for(const [k] of p.trail) {
    const x=(k%a.n+.5)/unit,y=(Math.floor(k/a.n)+.5)/unit;
    if(!visible(x,y)&&p.id!==playerId) {roundTrail(ctx,segment);segment=[];continue;}
    segment.push({x,y});
  }
  const pp=positions.get(p.id);
  if(segment.length&&pp)segment.push({x:pp.x+.5/unit,y:pp.y+.5/unit});
  roundTrail(ctx,segment);ctx.stroke();
  for(const[k,t]of p.trail) {
    if(t<=0)continue;
    const x=(k%a.n+.5)/unit,y=(Math.floor(k/a.n)+.5)/unit;
    if(!visible(x,y)&&p.id!==playerId)continue;
    ctx.fillStyle='#f8ffcf';ctx.beginPath();ctx.arc(x,y,.18,0,Math.PI*2);ctx.fill();
  }
}
ctx.textAlign='center'; ctx.textBaseline='middle';
const catalog = a.powerups ?? defaultPowerups;
for (const item of a.pickups) {
  if (!visible(item.x/unit,item.y/unit)) continue;
  const ix=(item.x+.5)/unit,iy=(item.y+.5)/unit;
  const style = catalog[item.kind] ?? defaultPowerups[item.kind];
  const image = loadedImage(style?.image);
  ctx.save();ctx.shadowColor=colors[0];ctx.shadowBlur=.3;ctx.fillStyle='#f5ffd9';ctx.beginPath();ctx.arc(ix,iy,.88,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  ctx.lineWidth=.09;ctx.strokeStyle='#120d20';ctx.stroke();
  if (image) {
    ctx.beginPath();ctx.arc(ix,iy,.78,0,Math.PI*2);ctx.clip();
    ctx.drawImage(image,ix-.78,iy-.78,1.56,1.56);ctx.restore();
  } else {
    ctx.fillStyle='#17200b';ctx.font='1px system-ui';ctx.fillText(style?.symbol ?? '?',ix,iy);ctx.restore();
  }
}
for (const p of a.players) {
  const pp=positions.get(p.id);
  if (!pp || !visible(pp.x,pp.y)) continue;
  ctx.shadowColor=colors[p.slot-1]; ctx.shadowBlur=12; ctx.fillStyle=colors[p.slot-1];
  ctx.beginPath(); ctx.roundRect(pp.x+.5/unit-.46,pp.y+.5/unit-.46,.92,.92,.23); ctx.fill(); ctx.shadowBlur=0;
  const face=loadedImage(p.avatar);
  if (face) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(pp.x+.5/unit-.38,pp.y+.5/unit-.38,.76,.76,.18); ctx.clip();
    ctx.drawImage(face,pp.x+.5/unit-.38,pp.y+.5/unit-.38,.76,.76); ctx.restore();
  }
  ctx.beginPath(); ctx.roundRect(pp.x+.5/unit-.46,pp.y+.5/unit-.46,.92,.92,.23);
  ctx.lineWidth=.07; ctx.strokeStyle=p.id===playerId?'#fff':colors[p.slot-1]; ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold .42px system-ui'; ctx.fillText(p.name,pp.x+.5/unit,pp.y-.32);
}
if(me&&!me.effects.radar){ctx.fillStyle='#080d0855';ctx.beginPath();ctx.rect(0,0,a.n/unit,a.n/unit);ctx.arc((me.x+.5)/unit,(me.y+.5)/unit,19,0,Math.PI*2,true);ctx.fill('evenodd')}
  }
  frameId = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frameId);
}
