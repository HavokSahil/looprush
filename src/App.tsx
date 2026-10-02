import { useEffect, useState, useSyncExternalStore } from 'react';
import { Cosmetics } from './components/Cosmetics';
import { Avatar } from './components/Avatar';
import { AuthForm } from './components/AuthForm';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import { GameConnection } from './game/connection';
import { useAuth } from './useAuth';
import type { Profile } from './types';

function PlayerApp({ profile, onExpired, onProfile }: { profile: Profile; onExpired: () => void; onProfile: (profile: Profile) => void }) {
  const [connection] = useState(()=>new GameConnection(profile.id,onExpired));
  const view=useSyncExternalStore(connection.subscribe,connection.getSnapshot);
  useEffect(()=>{ connection.start(); return ()=>connection.stop(); },[connection]);
  if (view.loading) return <main className="loading" role="status">Restoring your room…</main>;
  const studio = <Cosmetics key={view.snapshot?.room ?? 'personal'} profile={profile} room={view.snapshot} onProfile={onProfile} onExpired={onExpired} />;
  if (view.snapshot) return <>{studio}<Room key={view.snapshot.room} state={view.snapshot} connection={connection} rtt={view.rtt} networkError={view.error} onExpired={onExpired} /></>;
  return <>{studio}{view.error && <p className="form-error connection-error" role="status">{view.error}</p>}<Lobby profile={profile} onJoin={connection.refresh} onExpired={onExpired} /></>;
}

export default function App() {
  const auth=useAuth();
  return <>
    <header><a href="/" className="brand">◈ LOOPRUSH</a><span className="tag">BIG LOOPS. AFTER HOURS.</span><div className="account">{auth.profile && <Avatar profile={auth.profile}/>}<span id="identity">{auth.profile?.name ?? 'LOCAL MULTIPLAYER'}</span>{auth.profile && <button className="secondary" disabled={auth.busy} onClick={()=>void auth.logout()}>{auth.busy?'Signing out…':'Log out'}</button>}</div></header>
    {auth.profile && auth.error && <p role="alert" className="form-error account-error">{auth.error}</p>}
    {auth.status==='loading' ? <main className="loading" role="status">Checking your session…</main> : auth.status==='error' ? <main className="loading"><p role="alert">{auth.error}</p><button onClick={()=>void auth.refresh()}>Retry connection</button></main> : auth.profile && auth.busy ? <main className="loading" role="status">Signing out…</main> : auth.profile ? <PlayerApp key={auth.profile.id} profile={auth.profile} onExpired={auth.expire} onProfile={auth.updateProfile} /> : <Lobby profile={null} onExpired={auth.expire} authForm={<AuthForm busy={auth.busy} error={auth.error} onSubmit={auth.authenticate} />} />}
    <footer>LOOPRUSH / COME FOR THE TEASE. STAY FOR THE TERRITORY.</footer>
  </>;
}
