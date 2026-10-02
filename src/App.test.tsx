// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { Profile, Snapshot } from './types';

let profile: Profile | null;
let state: Snapshot | null;
let fetchMock: ReturnType<typeof vi.fn>;
const player = { id:'alice', name:'Alice' };
const reply = (body:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status}));
function room(): Snapshot {
  return { room:'FRIENDS',n:48,phase:'waiting',host:'alice',members:[{...player,ready:false,result:null}],messages:[],time:performance.now()/1000,tick:1,delay:80,grid:Array(48*48).fill(0),pickups:[],players:[] };
}
beforeEach(()=>{
  profile=null; state=null;
  vi.stubGlobal('BroadcastChannel',undefined);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  fetchMock=vi.fn((url:string, options:RequestInit={})=>{
    const body=options.body?JSON.parse(String(options.body)):{};
    switch(url){
      case '/api/session': return profile?reply(profile):reply({error:'Sign in'},401);
      case '/api/lobby': return reply({rooms:[],leaderboard:[],history:[]});
      case '/api/login': case '/api/register': profile=player;return reply(profile);
      case '/api/logout': profile=null;state=null;return reply({ok:true});
      case '/api/state': if(!profile)return reply({},401); if(state){state={...state,time:performance.now()/1000,tick:state.tick+1};} return reply(state??{ended:true});
      case '/api/join': state=room();return reply({ok:true});
      case '/api/ready': state!.members[0].ready=!state!.members[0].ready;return reply({ok:true});
      case '/api/chat': state!.messages=[...state!.messages,{id:state!.messages.length+1,name:'Alice',text:body.text}];return reply({ok:true});
      case '/api/start': state!.phase='playing';state!.players=[{...player,slot:1,x:10,y:10,dir:'right',trail:[],effects:{},cooldown:0,score:1.09,points:25,kills:0,lastSeq:0,ack:0,rtt:0}];return reply({ok:true});
      case '/api/leave': state=null;return reply({ok:true});
      case '/api/input': return reply({ok:true});
      default: throw Error(url);
    }
  });
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('supports sign-in, room chat, ready/start, live ranking, spectating and logout',async()=>{
  const user=userEvent.setup();render(<App/>);
  await screen.findByRole('heading',{name:'Welcome back.'});
  await user.type(screen.getByLabelText('Player name'),'Alice');
  await user.type(screen.getByLabelText('Password'),'password123');
  await user.click(screen.getByRole('button',{name:'Sign in →'}));
  await screen.findByRole('button',{name:'Enter room →'});
  await user.click(screen.getByRole('button',{name:'Enter room →'}));
  await screen.findByRole('button',{name:'Ready up'});
  await user.type(screen.getByRole('textbox',{name:'Chat message'}),'Hello loops!');
  await user.click(screen.getByRole('button',{name:'Send message'}));
  await screen.findByText('Hello loops!');
  await user.click(screen.getByRole('button',{name:'Ready up'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start match →'}) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button',{name:'Start match →'}));
  await screen.findByLabelText('Live territory arena');
  expect(screen.getByText('25 pts · 1.1%')).toBeTruthy();
  fireEvent.keyDown(window,{key:'ArrowUp'});
  await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url==='/api/input')).toBe(true));
  state!.players=[];state!.members[0].result={score:1.09,kills:0,reason:'wall'};
  await screen.findByText('Eliminated · wall · Spectating');
  expect(screen.getByRole('combobox',{name:'Spectate player'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Log out'}));
  await screen.findByRole('heading',{name:'Welcome back.'});
  expect(screen.queryByLabelText('Live territory arena')).toBeNull();
});

it('restores a room on reload and handles expiry without a stuck signed-in screen',async()=>{
  profile=player;state=room();render(<App/>);
  await screen.findByRole('button',{name:'Ready up'});
  profile=null;
  await screen.findByRole('heading',{name:'Welcome back.'});
  expect(screen.getByRole('alert').textContent).toContain('session ended');
  expect(screen.queryByRole('button',{name:'Log out'})).toBeNull();
});

it('offers a distinct registration form and clears its password when changing modes',async()=>{
  const user=userEvent.setup();render(<App/>);
  await screen.findByRole('heading',{name:'Welcome back.'});
  await user.type(screen.getByLabelText('Password'),'somepassword');
  await user.click(screen.getByRole('button',{name:'Create profile'}));
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
  await user.type(screen.getByLabelText('Player name'),'Alice');
  await user.type(screen.getByLabelText('Password'),'password123');
  await user.click(screen.getByRole('button',{name:'Create profile →'}));
  await screen.findByRole('button',{name:'Log out'});
  expect(fetchMock.mock.calls.some(([url])=>url==='/api/register')).toBe(true);
});
