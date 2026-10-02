import { expect, it } from 'vitest';
import { corners, curvedPosition, roundTrail } from './curves';

it('rounds a turn while preserving straight motion and path endpoints',()=>{
  const path=[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:2,y:1},{x:2,y:2}];
  expect(corners(path)).toEqual([path[0],path[2],path[4]]);
  expect(curvedPosition({x:1,y:0},path)).toEqual({x:1,y:0});
  const turn=curvedPosition({x:2,y:0},path);
  expect(turn.x).toBeCloseTo(1.895);expect(turn.y).toBeCloseTo(.105);
  expect(curvedPosition(path[4],path)).toEqual(path[4]);
  const calls: number[][]=[];
  const ctx={moveTo:()=>{},lineTo:()=>{},quadraticCurveTo:(...args:number[])=>calls.push(args)};
  roundTrail(ctx as unknown as CanvasRenderingContext2D,path);
  expect(calls).toEqual([[2,0,2,.42]]);
});
