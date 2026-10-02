import { useState, type FormEvent } from 'react';

interface Props {
  busy: boolean; error: string;
  onSubmit: (mode: 'login' | 'register', name: string, password: string) => Promise<void>;
}
export function AuthForm({ busy, error, onSubmit }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    void onSubmit(mode, name.trim(), password);
  }
  return <section className="card" id="auth">
    <div className="eyebrow">YOUR AFTER-HOURS ALIAS</div>
    <h2>{mode === 'login' ? 'Welcome back.' : 'Make a name for yourself.'}</h2>
    <p className="fine">{mode === 'login' ? 'Back for another round? We like your stamina.' : 'Pick an alias. Make an entrance. Leave them wanting more.'}</p>
    <div className="auth-tabs" aria-label="Account action">
      <button type="button" className={mode === 'login' ? '' : 'secondary'} disabled={busy} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setPassword(''); }}>Sign in</button>
      <button type="button" className={mode === 'register' ? '' : 'secondary'} disabled={busy} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setPassword(''); }}>Create profile</button>
    </div>
    <form onSubmit={submit} aria-busy={busy}>
      <label>Player name<input name="username" value={name} onChange={e => setName(e.target.value)} minLength={3} maxLength={20} pattern="[A-Za-z0-9_ \-]{3,20}" autoComplete="username" disabled={busy} required /></label>
      <label>Password<input name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} required /></label>
      {mode === 'register' && <p className="fine">3–20 characters for your name; 8–128 characters for your password. Your profile and scores stay on this server.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create profile →'}</button>
    </form>
  </section>;
}
