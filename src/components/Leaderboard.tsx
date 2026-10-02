import { Avatar } from './Avatar';
import type { LeaderboardEntry } from '../types';

const titles = ['THE MAIN ATTRACTION', 'HOT ON THEIR HEELS', 'THIRD TIME’S A CHARM'];

export function Leaderboard({ entries, playerId }: { entries: LeaderboardEntry[]; playerId?: string }) {
  return <section className="card leaderboard" aria-labelledby="leaderboard-title">
    <div className="leaderboard-heading"><div><div className="eyebrow">ALL-TIME / THIS SERVER</div><h2 id="leaderboard-title">Who’s on top? ↗</h2></div><span className="leaderboard-emblem" aria-hidden="true">♛</span></div>
    <p className="fine">Big claims. Bragging rights. Ranked by best territory, then total trail cuts.</p>
    {entries.length ? <ol className="ranking-list" aria-label="All-time leaderboard">
      {entries.map((player,index)=>{
        const rank=index+1, self=player.id===playerId;
        return <li key={player.id} className={`ranking-entry rank-gradient rank-${Math.min(rank,4)}${self?' is-you':''}`}>
          <span className="rank-position" aria-label={`Rank ${rank}`}><span>{String(rank).padStart(2,'0')}</span>{rank===1 && <i aria-hidden="true">♛</i>}</span>
          <Avatar profile={player}/>
          <div className="rank-player"><div className="rank-name">{player.name}{self && <span className="you-label">YOU</span>}</div>{rank<=3 && <span className="rank-title">{titles[index]}</span>}<span className="rank-details">{player.kills.toLocaleString()} cuts <span aria-hidden="true">·</span> {player.runs.toLocaleString()} {player.runs===1?'run':'runs'}</span></div>
          <div className="rank-score"><strong>{player.score.toFixed(2)}<span>%</span></strong><small>BEST TERRITORY</small></div>
        </li>;
      })}
    </ol>:<div className="leaderboard-empty"><span aria-hidden="true">♛</span><p>Nobody has peaked yet.<br /><b>Make your first run a memorable one.</b></p></div>}
  </section>;
}
