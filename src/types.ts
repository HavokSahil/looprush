export interface Profile { id: string; name: string; avatar?: string | null }
export interface PowerupStyle { kind: string; name: string; symbol: string; description: string; image: string | null }
export type PowerupCatalog = Record<string, PowerupStyle>;
export interface CosmeticsResponse { powerups: PowerupCatalog; canEdit: boolean }
export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Player extends Profile {
  slot: number; x: number; y: number; dir: Direction; heading?: number; speed?: number;
  trail: [number, number][]; effects: Record<string, number>;
  cooldown: number; score: number; points: number; kills: number;
  lastSeq: number; ack: number; rtt: number;
}
export interface Result { score: number; kills: number; reason: string }
export interface Member extends Profile { ready: boolean; result: Result | null }
export interface Message { id: number; name: string; text: string }
export interface Snapshot {
  room: string; n: number; unit?: number; phase: 'waiting' | 'playing' | 'finished';
  powerups?: PowerupCatalog;
  host: string; members: Member[]; messages: Message[]; time: number;
  tick: number; delay: number; grid: number[]; gridRuns?: [number,number][]; gridRevision?: number;
  pickups: { x: number; y: number; kind: string }[]; players: Player[];
}
export type StateResponse = Snapshot | { ended: true };
export interface LeaderboardEntry extends Profile { score: number; kills: number; runs: number }
export interface LobbyData {
  rooms: { name: string; players: number; delay: number; n: number; phase: Snapshot['phase'] }[];
  leaderboard: LeaderboardEntry[];
  history: (Result & { created: number })[];
}
export const colors = ['#a3ff12','#38bdf8','#fb7185','#c084fc','#fbbf24','#2dd4bf','#f97316','#818cf8'];
export const symbols: Record<string, string> = { speed:'⚡',shield:'◇',frost:'❄',teleport:'↗',radar:'◎',slow:'❄',dash:'↗' };
