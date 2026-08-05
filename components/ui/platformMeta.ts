/**
 * Lookups from a backend `platform` value to its glyph and display name.
 *
 * Split from platformIcons.tsx so that file exports only its glyph components
 * and keeps its Fast Refresh boundary — a component file that also exports
 * tables and helpers full-reloads on every edit instead.
 */
import { IconGlobe, type IconComponent } from './icons';
import {
  IconGitHub,
  IconInstagram,
  IconSpotify,
  IconTelegram,
  IconTikTok,
  IconX,
  IconYouTube,
} from './platformIcons';

/** Keys match the backend's `platform` values in users/links.py. */
const PLATFORM_ICONS: Record<string, IconComponent> = {
  instagram: IconInstagram,
  spotify: IconSpotify,
  telegram: IconTelegram,
  tiktok: IconTikTok,
  youtube: IconYouTube,
  x: IconX,
  github: IconGitHub,
  website: IconGlobe,
};

/** Never throws on an unknown platform — the backend allows any valid https
 * URL, so new or unrecognised hosts are expected and get the globe. */
export function iconForPlatform(platform?: string): IconComponent {
  return PLATFORM_ICONS[platform ?? 'website'] ?? IconGlobe;
}

const PLATFORM_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  spotify: 'Spotify',
  telegram: 'Telegram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X',
  github: 'GitHub',
  website: 'Website',
};

export function platformName(platform?: string): string {
  return PLATFORM_NAMES[platform ?? 'website'] ?? 'Website';
}
