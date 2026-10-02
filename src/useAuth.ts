import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from './api';
import type { Profile } from './types';

export function useAuth() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const current = ++revision.current;
    try {
      const next = await api<Profile>('session');
      if (current !== revision.current) return;
      setProfile(next); setStatus('ready'); setError('');
    } catch (e) {
      if (current !== revision.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setProfile(null); setStatus('ready'); setError('');
      } else { setStatus('error'); setError(errorMessage(e)); }
    }
  }, []);

  useEffect(() => {
    // Legacy bearer tokens are no longer accepted or retained in browser storage.
    try { localStorage.removeItem('looprush-profile'); } catch { /* Storage can be disabled. */ }
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('looprush-auth');
      channel.current.onmessage = () => { void refresh(); };
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { revision.current++; channel.current?.close(); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const expire = useCallback(() => {
    if (busyRef.current) return;
    revision.current++; setProfile(null); setStatus('ready');
    setError('Your session ended. Please sign in again.');
  }, []);

  const authenticate = useCallback(async (mode: 'login' | 'register', name: string, password: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = ++revision.current;
    try {
      const next = await api<Profile>(mode, { name, password });
      if (current !== revision.current) return;
      setProfile(next); setStatus('ready'); channel.current?.postMessage('changed');
    } catch (e) { if (current === revision.current) setError(errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  const logout = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = ++revision.current;
    try {
      await api('logout', {});
      if (current !== revision.current) return;
      setProfile(null); setStatus('ready'); channel.current?.postMessage('changed');
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch (e) { if (current === revision.current) setError(errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  const updateProfile = useCallback((next: Profile) => {
    setProfile(current => current?.id === next.id ? next : current);
    channel.current?.postMessage('changed');
  }, []);

  return { profile, status, error, busy, refresh, authenticate, logout, expire, updateProfile };
}
