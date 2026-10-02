// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { startRenderer } from './renderer';
import type { GameConnection } from './connection';
import type { Snapshot } from '../types';
import { defaultPowerups } from '../powerups';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('draws uploaded faces and larger pickup images without map labels',()=>{
  const context={
    setTransform:vi.fn(),fillRect:vi.fn(),translate:vi.fn(),scale:vi.fn(),strokeRect:vi.fn(),
    beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),save:vi.fn(),clip:vi.fn(),restore:vi.fn(),
    drawImage:vi.fn(),fillText:vi.fn(),roundRect:vi.fn(),stroke:vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('Image',class { src='';complete=true;naturalWidth=128; });
  let frame!:FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame',vi.fn((callback:FrameRequestCallback)=>{frame=callback;return 42;}));
  const cancel=vi.fn();vi.stubGlobal('cancelAnimationFrame',cancel);
  const canvas=document.createElement('canvas');
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({width:800,height:600} as DOMRect);
  const snapshot:Snapshot={room:'TEST',n:48,phase:'playing',host:'alice',members:[],messages:[],time:1,tick:1,delay:80,grid:Array(48*48).fill(0),
    powerups:{...defaultPowerups,speed:{...defaultPowerups.speed,name:'Zoomy Dave',image:'/api/images/dave.png'}},
    pickups:[{x:12,y:10,kind:'speed'}],players:[{id:'alice',name:'Alice',avatar:'/api/images/alice.png',slot:1,x:10,y:10,dir:'right',trail:[],effects:{radar:10},cooldown:0,score:1,points:25,kills:0,lastSeq:0,ack:0,rtt:0}]};
  const connection={frames:[snapshot],clockOffset:0,playerId:'alice'} as unknown as GameConnection;
  const stop=startRenderer(canvas,connection,()=>'');
  frame(1100);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  expect(context.drawImage.mock.calls[0][0].src).toBe('/api/images/dave.png');
  expect(context.drawImage.mock.calls[1][0].src).toBe('/api/images/alice.png');
  expect(context.fillText.mock.calls.some(([label])=>label==='Zoomy Dave')).toBe(false);
  stop();expect(cancel).toHaveBeenCalledWith(42);
});
