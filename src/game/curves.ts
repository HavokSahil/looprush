export interface Point { x: number; y: number }
const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
const mix = (a: Point,b: Point,t: number): Point => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

// Keep straight runs straight and round only corners, within half a cell.
export function corners(points: Point[]) {
  const result: Point[]=[];
  for(const point of points) {
    const b=result.at(-1),a=result.at(-2);
    if(b && distance(b,point)<.00001) continue;
    if(a && b && Math.abs((b.x-a.x)*(point.y-b.y)-(b.y-a.y)*(point.x-b.x))<.00001
      && (b.x-a.x)*(point.x-b.x)+(b.y-a.y)*(point.y-b.y)>0) result.pop();
    result.push(point);
  }
  return result;
}

export function roundTrail(ctx: CanvasRenderingContext2D, points: Point[]) {
  const path=corners(points);
  if(!path.length)return;
  ctx.moveTo(path[0].x,path[0].y);
  for(let i=1;i<path.length-1;i++) {
    const a=path[i-1],b=path[i],c=path[i+1];
    const radius=Math.min(.42,distance(a,b)/2,distance(b,c)/2);
    const entry=mix(b,a,radius/distance(a,b)),exit=mix(b,c,radius/distance(b,c));
    ctx.lineTo(entry.x,entry.y);ctx.quadraticCurveTo(b.x,b.y,exit.x,exit.y);
  }
  if(path.length>1)ctx.lineTo(path.at(-1)!.x,path.at(-1)!.y);
}

export function curvedPosition(point: Point, path: Point[]): Point {
  const turns=corners(path);
  for(let i=1;i<turns.length-1;i++) {
    const a=turns[i-1],b=turns[i],c=turns[i+1];
    const incoming=distance(a,b),outgoing=distance(b,c);
    const radius=Math.min(.42,incoming/2,outgoing/2);
    const fromCorner=distance(point,b);
    if(fromCorner>radius || !radius)continue;
    const onIncoming=Math.abs((point.x-b.x)*(a.y-b.y)-(point.y-b.y)*(a.x-b.x))<.00001
      && (point.x-b.x)*(a.x-b.x)+(point.y-b.y)*(a.y-b.y)>0;
    const t=(1+(onIncoming?-fromCorner:fromCorner)/radius)/2;
    const entry=mix(b,a,radius/incoming),exit=mix(b,c,radius/outgoing);
    return mix(mix(entry,b,t),mix(b,exit,t),t);
  }
  return point;
}
