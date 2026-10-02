import type { PowerupCatalog } from './types';

// Offline/loading fallback. The server supplies authoritative global appearances.
export const defaultPowerups: PowerupCatalog = {
  speed: { kind: 'speed', name: 'Speed', symbol: '⚡', image: null, description: 'Move at 1.6× speed for 5 seconds.' },
  shield: { kind: 'shield', name: 'Shield', symbol: '🛡️', image: null, description: 'Lay protected trail segments for 5 seconds. Each stays protected for 3 seconds.' },
  frost: { kind: 'frost', name: 'Frost', symbol: '🧊', image: null, description: 'Slow rivals within 14 cells to 0.55× speed for 3 seconds.' },
  teleport: { kind: 'teleport', name: 'Dash recharge', symbol: '🌀', image: null, description: 'Reset your dash cooldown. Space activates a 0.18-second burst at 4× speed from home territory. Normal cooldown: 12 seconds.' },
  radar: { kind: 'radar', name: 'Radar', symbol: '👀', image: null, description: 'See the full board for 10 seconds instead of the usual 19-cell radius.' },
};
export function effectStyle(kind: string, catalog: PowerupCatalog) {
  return catalog[kind === 'slow' ? 'frost' : kind === 'dash' ? 'teleport' : kind];
}
