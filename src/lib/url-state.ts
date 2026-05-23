// Encode/decode app state in location.hash.
//
// Format: `#v=<id>,<id>&o=<id>:<x>,<y>;<id>:<x>,<y>`
// - `v=`  comma-separated list of visible city IDs (always emitted post-hydration,
//          even if empty — distinguishes "explicit empty" from "no URL state")
// - `o=`  semicolon-separated `<id>:<x>,<y>` entries for non-zero offsets only
//
// Empty hash (`location.hash === ''`) is interpreted as "no state, use defaults".
// Any non-empty hash takes precedence over defaults.

export interface UrlState {
  visible: string[];
  offsets: Record<string, { x: number; y: number }>;
}

export function encode(state: UrlState): string {
  const parts: string[] = [`v=${state.visible.join(',')}`];
  const offsetEntries = Object.entries(state.offsets)
    .filter(([, o]) => o.x !== 0 || o.y !== 0)
    .map(([id, o]) => `${id}:${Math.round(o.x)},${Math.round(o.y)}`);
  if (offsetEntries.length > 0) {
    parts.push(`o=${offsetEntries.join(';')}`);
  }
  return '#' + parts.join('&');
}

export function decode(hash: string): UrlState | null {
  const trimmed = hash.replace(/^#/, '');
  if (!trimmed) return null;

  const result: UrlState = { visible: [], offsets: {} };
  const params = new URLSearchParams(trimmed);

  const v = params.get('v');
  if (v !== null) result.visible = v.split(',').filter(Boolean);

  const o = params.get('o');
  if (o) {
    for (const entry of o.split(';')) {
      const [id, coords] = entry.split(':');
      if (!id || !coords) continue;
      const [x, y] = coords.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        result.offsets[id] = { x, y };
      }
    }
  }

  return result;
}
