import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { GameConnection } from './connection';
import type { Snapshot } from '../types';

vi.mock('../api',async importOriginal=>({...await importOriginal<typeof import('../api')>(),api:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks();});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

it('decodes compact territory and reuses the grid until its revision changes',async()=>{
  vi.useFakeTimers();
  const state:Snapshot={room:'TEST',n:4,unit:1,phase:'playing',host:'a',members:[],messages:[],time:1,tick:1,delay:0,grid:[],gridRuns:[[0,4],[1,8],[0,4]],gridRevision:1,pickups:[],players:[]};
  vi.mocked(api).mockImplementation(async()=>({...state}));
  const connection=new GameConnection('a',()=>{});
  connection.start();await settle();
  const first=connection.frames.at(-1)!;
  expect(first.grid).toEqual([0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0]);
  connection.refresh();await settle();
  expect(connection.frames.at(-1)!.grid).toBe(first.grid);
  state.gridRevision=2;state.gridRuns=[[2,16]];
  connection.refresh();await settle();
  expect(connection.frames.at(-1)!.grid).toEqual(Array(16).fill(2));
  connection.stop();
});
