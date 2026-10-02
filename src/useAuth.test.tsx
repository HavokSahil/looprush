// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';

const player = { id: 'alice', name: 'Alice' };
const reply = (body: unknown, status=200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('authentication lifecycle', () => {
  it('checks the server before trusting a saved account and removes legacy tokens', async () => {
    localStorage.setItem('looprush-profile', JSON.stringify({ ...player, token: 'old-token' }));
    fetchMock.mockImplementation(()=>reply({ error:'Sign in' },401));
    const { result }=renderHook(()=>useAuth());
    expect(result.current.status).toBe('loading'); expect(result.current.profile).toBeNull();
    await waitFor(()=>expect(result.current.status).toBe('ready'));
    expect(result.current.profile).toBeNull(); expect(localStorage.getItem('looprush-profile')).toBeNull();
  });
  it('restores a valid server session', async () => {
    fetchMock.mockImplementation(()=>reply(player));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.profile).toEqual(player));
    expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
  });
  it('signs in, revokes the session on logout, and permits a different account', async () => {
    fetchMock.mockImplementation((url:string)=>url.endsWith('/session')?reply({},401):url.endsWith('/logout')?reply({ok:true}):reply(player));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.status).toBe('ready'));
    await act(()=>result.current.authenticate('login','Alice','password123'));
    expect(result.current.profile).toEqual(player);
    await act(()=>result.current.logout());
    expect(result.current.profile).toBeNull();
    expect(fetchMock.mock.calls.some(([url,opts])=>url==='/api/logout' && opts.method==='POST')).toBe(true);
    fetchMock.mockImplementation(()=>reply({id:'bob',name:'Bob'}));
    await act(()=>result.current.authenticate('login','Bob','password456'));
    expect(result.current.profile?.name).toBe('Bob');
  });
  it('keeps the account visible and reports a failed logout instead of claiming success', async () => {
    fetchMock.mockImplementation(()=>reply(player));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.profile).toEqual(player));
    fetchMock.mockRejectedValue(new TypeError('Network down'));
    await act(()=>result.current.logout());
    expect(result.current.profile).toEqual(player); expect(result.current.error).toContain('Could not reach');
    expect(result.current.busy).toBe(false);
  });
  it('ignores an old session-check response after logout', async () => {
    fetchMock.mockImplementation(()=>reply(player));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.profile).toEqual(player));
    let resolve!: (response:Response)=>void;
    fetchMock.mockImplementation((url:string)=>url.endsWith('/session')?new Promise<Response>(r=>{resolve=r;}):reply({ok:true}));
    let refresh!: Promise<void>;
    act(()=>{ refresh=result.current.refresh(); });
    await act(()=>result.current.logout());
    await act(async()=>{ resolve(new Response(JSON.stringify(player))); await refresh; });
    expect(result.current.profile).toBeNull();
  });
  it('reports invalid credentials inline and prevents duplicate sign-in requests', async () => {
    fetchMock.mockImplementation(()=>reply({},401));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.status).toBe('ready'));
    fetchMock.mockImplementation(()=>reply({error:'Incorrect name or password'},400));
    await act(async()=>{ await Promise.all([result.current.authenticate('login','Alice','wrongpass'),result.current.authenticate('login','Alice','wrongpass')]); });
    expect(fetchMock.mock.calls.filter(([url])=>url==='/api/login')).toHaveLength(1);
    expect(result.current.error).toBe('Incorrect name or password'); expect(result.current.profile).toBeNull();
  });
  it('shows a retry state for a server outage and recovers', async () => {
    fetchMock.mockRejectedValue(new TypeError('Offline'));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.status).toBe('error'));
    fetchMock.mockImplementation(()=>reply(player));
    await act(()=>result.current.refresh());
    expect(result.current.status).toBe('ready'); expect(result.current.profile).toEqual(player);
  });
  it('expires an active account explicitly', async () => {
    fetchMock.mockImplementation(()=>reply(player));
    const { result }=renderHook(()=>useAuth());
    await waitFor(()=>expect(result.current.profile).toEqual(player));
    act(()=>result.current.expire());
    expect(result.current.profile).toBeNull(); expect(result.current.error).toContain('session ended');
  });
});
