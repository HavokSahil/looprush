import type { Profile } from '../types';

export function Avatar({ profile }: { profile: Profile }) {
  return <span className="avatar-badge" aria-hidden="true">{profile.name.slice(0,1).toUpperCase()}{profile.avatar && <img key={profile.avatar} src={profile.avatar} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>}</span>;
}
