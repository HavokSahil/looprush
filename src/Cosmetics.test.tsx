// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Cosmetics } from './components/Cosmetics';
import { defaultPowerups } from './powerups';
import type { PowerupCatalog, Snapshot } from './types';

let catalog: PowerupCatalog;
let fetchMock: ReturnType<typeof vi.fn>;
const normalized='data:image/png;base64,normalized-image';
beforeEach(()=>{
  catalog=structuredClone(defaultPowerups);
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:400,height:300,close:vi.fn()})));
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue(normalized);
  fetchMock=vi.fn(async(url:string,options:RequestInit={})=>{
    const data=options.body?JSON.parse(String(options.body)):{};
    if(url==='/api/avatar')return new Response(JSON.stringify({id:'alice',name:'Alice',avatar:data.image?'/api/images/saved.png':null}));
    if(url==='/api/powerup')catalog[data.kind]=data.reset?structuredClone(defaultPowerups[data.kind]):{...catalog[data.kind],name:data.name,image:'image' in data?data.image:null};
    return new Response(JSON.stringify({powerups:catalog,canEdit:true}));
  });
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('lets a player crop, preview, save and remove a face',async()=>{
  const user=userEvent.setup(),onProfile=vi.fn();
  const props={profile:{id:'alice',name:'Alice'},room:null,onProfile,onExpired:vi.fn()};
  const {rerender}=render(<Cosmetics {...props}/>);
  await user.click(screen.getByText('Your face & power-up studio'));
  await user.upload(await screen.findByLabelText('Choose your face'),new File(['png'],'face.png',{type:'image/png'}));
  await screen.findByAltText('Choose your face preview');
  expect(screen.getByRole('slider',{name:'Choose your face zoom'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Save face'}));
  await waitFor(()=>expect(onProfile).toHaveBeenCalledWith({id:'alice',name:'Alice',avatar:'/api/images/saved.png'}));
  expect(fetchMock.mock.calls.find(([url])=>url==='/api/avatar')?.[1].body).toContain(normalized);
  rerender(<Cosmetics {...props} profile={{...props.profile,avatar:'/api/images/saved.png'}}/>);
  const face=screen.getByRole('heading',{name:'Put a face to the name.'}).closest('section')!;
  await user.click(within(face).getByRole('button',{name:'Remove image'}));
  await user.click(screen.getByRole('button',{name:'Save face'}));
  await waitFor(()=>expect(onProfile).toHaveBeenLastCalledWith({id:'alice',name:'Alice',avatar:null}));
});

it('lets the host rename and upload a pickup image then reset it',async()=>{
  const user=userEvent.setup();render(<Cosmetics profile={{id:'alice',name:'Alice'}} room={null} onProfile={vi.fn()} onExpired={vi.fn()}/>);
  await user.click(screen.getByText('Your face & power-up studio'));
  const input=await screen.findByLabelText('Speed fun name');
  await user.clear(input);await user.type(input,'Zoomy Dave');
  await user.upload(screen.getByLabelText('Speed image'),new File(['png'],'dave.png',{type:'image/png'}));
  const card=input.closest('article')!;
  await user.click(within(card).getByRole('button',{name:'Save power-up'}));
  await within(card).findByText('Power-up saved.');
  expect(catalog.speed.name).toBe('Zoomy Dave');expect(catalog.speed.image).toBe(normalized);
  await user.click(within(card).getByRole('button',{name:'Reset default'}));
  await waitFor(()=>expect((screen.getByLabelText('Speed fun name') as HTMLInputElement).value).toBe('Speed'));
  expect(catalog.speed.image).toBeNull();
});

it('shows shared appearances to guests without power-up editing controls',async()=>{
  fetchMock.mockImplementation(async()=>new Response(JSON.stringify({powerups:catalog,canEdit:false})));
  const user=userEvent.setup();
  const room={room:'FRIENDS',host:'host',phase:'waiting',powerups:catalog} as Snapshot;
  render(<Cosmetics profile={{id:'guest',name:'Guest'}} room={room} onProfile={vi.fn()} onExpired={vi.fn()}/>);
  await user.click(screen.getByText('Your face & power-up studio'));
  await screen.findByText('Give the power-ups some personality.');
  expect(screen.queryByLabelText('Speed fun name')).toBeNull();
  expect(screen.getByLabelText('Choose your face')).toBeTruthy();
});

it('rejects oversized images before decoding or uploading',async()=>{
  const user=userEvent.setup();render(<Cosmetics profile={{id:'alice',name:'Alice'}} room={null} onProfile={vi.fn()} onExpired={vi.fn()}/>);
  await user.click(screen.getByText('Your face & power-up studio'));
  const file=new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'});
  await user.upload(await screen.findByLabelText('Choose your face'),file);
  await screen.findByText('Choose an image smaller than 5 MB.');
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(([url])=>url==='/api/avatar')).toBe(false);
});
