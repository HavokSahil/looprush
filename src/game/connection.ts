import { api, ApiError, errorMessage } from '../api';
import type { Direction, Snapshot, StateResponse } from '../types';

interface View { snapshot: Snapshot | null; loading: boolean; rtt: number; error: string }
interface Command { dir: Direction | number | null; ability: boolean; seq: number; rtt: number }

// Owns transport, input ordering and render samples, independently of React.
export class GameConnection {
  frames: Snapshot[] = [];
  clockOffset: number | null = null;
  private view: View = { snapshot: null, loading: true, rtt: 0, error: '' };
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private polling = false;
  private urgent = false;
  private seq = 0;
  private commands: Command[] = [];
  private sending = false;
  private latest: Snapshot | null = null;
  private lastPublish = 0;
  private round = 0;

  constructor(readonly playerId: string, private onExpired: () => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private publish(view: View) { this.view = view; this.listeners.forEach(listener => listener()); }
  start() { this.running = true; this.controller = new AbortController(); void this.poll(); }
  stop() { this.running = false; this.controller.abort(); clearTimeout(this.timer); this.commands = []; }
  refresh = () => { clearTimeout(this.timer); if (this.polling) this.urgent = true; else void this.poll(); };

  private async poll() {
    if (!this.running || this.polling) return;
    this.polling = true;
    const start = performance.now();
    try {
      const result = await api<StateResponse>('state', undefined, this.controller.signal);
      if (!this.running) return;
      const now = performance.now();
      const rtt = now-start;
      if ('ended' in result) {
        this.latest = null; this.frames = []; this.commands = []; this.clockOffset = null;
        this.publish({ snapshot: null, loading: false, rtt, error: '' });
      } else {
        const changed = result.room !== this.latest?.room || result.phase !== this.latest?.phase;
        if (changed) { this.frames = []; this.clockOffset = null; this.commands = []; this.seq = 0; this.round++; }
        if (result.gridRuns) {
          if (!changed && result.gridRevision===this.latest?.gridRevision) result.grid=this.latest!.grid;
          else {
            result.grid=new Array(result.n*result.n);let index=0;
            for(const [owner,count] of result.gridRuns) { result.grid.fill(owner,index,index+count);index+=count; }
          }
        }
        this.latest = result;
        this.seq = Math.max(this.seq, result.players.find(p => p.id === this.playerId)?.lastSeq ?? 0);
        const offset = now - result.time * 1000;
        this.clockOffset = offset;
        this.frames.push(result);
        if (this.frames.length > 30) this.frames.shift();
        // Canvas gets every sample; React HUD updates at most ten times per second.
        if (changed || now-this.lastPublish >= 100 || this.view.error) {
          this.lastPublish = now; this.publish({ snapshot: result, loading: false, rtt, error: '' });
        }
      }
    } catch (e) {
      if (!this.running) return;
      if (e instanceof ApiError && e.status === 401) { this.stop(); this.onExpired(); }
      else this.publish({ ...this.view, loading: false, error: 'Connection lost. Reconnecting…' });
    } finally {
      this.polling = false;
      if (this.running) {
        const delay = this.urgent ? 0 : this.view.error ? 1000 : this.latest ? 0 : 1500;
        this.urgent = false; this.timer = setTimeout(() => { void this.poll(); }, delay);
      }
    }
  }

  input = (dir: Direction | number | null, ability = false) => {
    if (!this.running || this.latest?.phase !== 'playing' || !this.latest.players.some(p => p.id === this.playerId)) return;
    const command={ dir, ability, seq: ++this.seq, rtt: Math.round(this.view.rtt) };
    const previous=this.commands.at(-1);
    if(typeof dir==='number' && previous && typeof previous.dir==='number') this.commands[this.commands.length-1]=command;
    else if(this.commands.length<20)this.commands.push(command);
    else return;
    void this.send();
  };
  private async send() {
    if (this.sending) return;
    this.sending = true;
    const round = this.round;
    try {
      while (this.running && this.commands.length && round === this.round) {
        await api('input', this.commands.shift(), this.controller.signal);
      }
    } catch (e) {
      if (!this.running) return;
      this.commands = [];
      if (e instanceof ApiError && e.status === 401) { this.stop(); this.onExpired(); }
      else if (!(e instanceof ApiError && e.status === 409)) this.publish({ ...this.view, error: errorMessage(e) });
    } finally { this.sending = false; if (this.running && this.commands.length) void this.send(); }
  }
}
