import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { CosmeticsResponse, PowerupStyle, Profile, Snapshot } from '../types';
import { defaultPowerups } from '../powerups';
import { ImagePicker } from './ImagePicker';

function FaceEditor({ profile, onProfile, onExpired }: { profile: Profile; onProfile: (profile: Profile) => void; onExpired: () => void }) {
  const [image, setImage] = useState<string | null>(profile.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setImage(profile.avatar ?? null); }, [profile.avatar]);
  const changed = image !== (profile.avatar ?? null);
  return <section className="face-editor"><div className="eyebrow">HEAD GAME / YOUR AVATAR</div><h2>Put a face to the name.</h2><p className="fine">Everyone in the room will see this on your head and beside your name. Your player color stays around the edge.</p>
    <ImagePicker label="Choose your face" value={image} disabled={busy} onChange={value=>{setImage(value);setSaved(false);}} />
    <button disabled={busy || !changed} onClick={async()=>{
      setBusy(true);setError('');setSaved(false);
      try { const next=await api<Profile>('avatar',{image}); setImage(next.avatar??null);onProfile(next);setSaved(true); }
      catch(e){if(e instanceof ApiError && e.status===401)onExpired();else setError(errorMessage(e));}
      finally{setBusy(false);}
    }}>{busy?'Saving…':'Save face'}</button>
    {saved && <p className="success" role="status">Face saved to your profile.</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
function PowerupEditor({ style, canEdit, onSaved, onExpired }: { style: PowerupStyle; canEdit: boolean; onSaved: (response: CosmeticsResponse)=>void; onExpired: ()=>void }) {
  const [name,setName]=useState(style.name);
  const [image,setImage]=useState(style.image);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{setName(style.name);setImage(style.image);},[style.name,style.image]);
  const changed=name!==style.name || image!==style.image;
  async function save(reset=false){
    setBusy(true);setError('');setSaved(false);
    try{
      const result=await api<CosmeticsResponse>('powerup',reset?{kind:style.kind,reset:true}:{kind:style.kind,name,...(image!==style.image?{image}:{})});
      setName(result.powerups[style.kind].name);setImage(result.powerups[style.kind].image);onSaved(result);setSaved(true);
    }catch(e){if(e instanceof ApiError && e.status===401)onExpired();else setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  return <article className="powerup-editor"><div className="eyebrow">{style.symbol} {defaultPowerups[style.kind].name.toUpperCase()}</div><p className="fine">{style.description}</p>
    {canEdit?<><label>Fun name<input aria-label={`${defaultPowerups[style.kind].name} fun name`} value={name} maxLength={32} disabled={busy} onChange={e=>{setName(e.target.value);setSaved(false);}} /></label><ImagePicker label={`${defaultPowerups[style.kind].name} image`} value={image} disabled={busy} onChange={value=>{setImage(value);setSaved(false);}} /><div className="buttons"><button disabled={busy || !changed || !name.trim()} onClick={()=>void save()}>Save power-up</button><button className="secondary" disabled={busy} onClick={()=>void save(true)}>Reset default</button></div></>:<><h3>{style.name}</h3>{style.image && <img className="powerup-photo" src={style.image} alt={style.name}/>}</>}
    {saved && <p className="success" role="status">Power-up saved.</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}
export function Cosmetics({profile, room, onProfile, onExpired}: {profile:Profile;room:Snapshot|null;onProfile:(profile:Profile)=>void;onExpired:()=>void}) {
  const [open,setOpen]=useState(false);
  const [catalog,setCatalog]=useState<CosmeticsResponse|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setError('');
    api<CosmeticsResponse>('powerups',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setCatalog(value);}).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));});
    return()=>controller.abort();
  },[open,room?.room]);
  const canEdit=catalog?.canEdit??false;
  const styles=room?.powerups??catalog?.powerups;
  return <details className="cosmetics-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Your face &amp; power-up studio <span>Upload photos · choose fun names</span></summary>
    {open && <div className="cosmetics-content"><FaceEditor profile={profile} onProfile={onProfile} onExpired={onExpired}/><section><div className="eyebrow">FIVE BOOSTERS · EXTRA STIMULATION</div><h2>Give the power-ups some personality.</h2><p className="fine">{canEdit?'These names and icons are global. Changes apply to every player in every room on this server.':'Everyone uses these same global names and icons. Only the server owner can change them.'} The effects stay the same.{room?.phase==='playing'?' The match continues while you edit.':''}</p>
      {styles?<div className="powerup-editors">{Object.values(styles).map(style=><PowerupEditor key={style.kind} style={style} canEdit={canEdit} onSaved={setCatalog} onExpired={onExpired}/>)}</div>:<p role="status">Loading power-ups…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section></div>}
  </details>;
}
