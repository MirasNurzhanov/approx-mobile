// Formatting helpers for the map's markers and sheets.
// Moved out of app/(tabs)/map.tsx unchanged.

import type { ColorPalette } from '@/constants/theme';
import {
    type PinnedPlace,
} from '@/services/pinnedPlaces';

// Muted avatar hues from the redesign (hue1–hue6), dark text on top.
const AVATAR_COLORS = ['#7FB8A4', '#A48FD1', '#C9A06B', '#8FA9D1', '#C98A8A', '#9BBF7F'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function avatarBgColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function fmtDistance(m?: number): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(1)} km away`;
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function fmtTimeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
}

/**
 * A stranger's distance, as a band plus an approximate figure.
 *
 * Strangers never get an exact number. "90 m away" is a measurement of a person
 * who has not agreed to be measured — and read twice a minute it is enough to
 * walk someone down. The band is the useful part anyway: what a stranger needs
 * to know is whether this is worth crossing the road for.
 */
export function distanceBand(m?: number): string | null {
  if (m == null) return null;
  const band = m < 150 ? 'Close' : m < 400 ? 'Nearby' : 'In range';
  const approx = m < 1000
    ? `about ${Math.max(10, Math.round(m / 10) * 10)} m`
    : `about ${(m / 1000).toFixed(1)} km`;
  return `${band} · ${approx}`;
}

// ─── Pinned places ────────────────────────────────────────────────────────────
/*
 * The places the viewer saved for themselves — see services/pinnedPlaces.
 *
 * Two sources, one marker: where a Swift was made, and a meetup they said they
 * are going to. They are drawn together because on a map they are the same
 * thing — somewhere you decided you want to be able to find again — and are
 * told apart by tint and glyph rather than by shape, so the map does not grow
 * a third pin silhouette.
 */

/** Teal for a place off a Swift, purple for a meetup — each keeping the colour
 *  its source already has on this map, so a pin never introduces a hue that
 *  means nothing anywhere else. */
export function pinTint(place: PinnedPlace, colors: ColorPalette): string {
  return place.kind === 'meetup' ? colors.purple : colors.teal;
}

/** What the card calls the pin. Both halves are worth saying: where it came
 *  from, and — for a meetup — that pinning it was a decision to go. */
export function pinKindLabel(place: PinnedPlace): string {
  return place.kind === 'meetup' ? 'MEETUP · GOING' : 'FROM A SWIFT';
}
