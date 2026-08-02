import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { lightColors as colors } from '@/constants/theme';
import { IconGlobe, type IconComponent, type IconProps } from './icons';

// Platform glyphs for profile links, drawn locally.
//
// Bundled on purpose: the alternative is fetching a favicon from the linked
// site, which would tell that site every time somebody looked at the profile
// and would mean the server requesting a user-supplied URL. Neither is
// acceptable, so the set is fixed and anything unrecognised falls back to a
// generic globe.
//
// Same 24px grid and 1.5px stroke as the rest of the icon set.

const stroke = {
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

export function IconInstagram({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.75} y={3.75} width={16.5} height={16.5} rx={5} />
        <Circle cx={12} cy={12} r={4} />
        <Path d="M16.9 7.1h.01" />
      </G>
    </Svg>
  );
}

export function IconSpotify({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M7.6 9.6c2.9-.8 6-.5 8.6.9" />
        <Path d="M8.2 12.5c2.4-.6 4.9-.35 7.1.75" />
        <Path d="M8.8 15.2c1.9-.45 3.9-.25 5.6.6" />
      </G>
    </Svg>
  );
}

export function IconTelegram({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M20.5 4.5L3.8 11.1l4.6 1.5 1.7 5.2 2.6-3.1 4.2 3.1z" />
        <Path d="M8.4 12.6l9.2-6.4-7.5 7.6" />
      </G>
    </Svg>
  );
}

export function IconTikTok({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M14.2 3.5v10.9a3.6 3.6 0 11-3.6-3.6" />
        <Path d="M14.2 6.2a4.7 4.7 0 004.5 3.3" />
      </G>
    </Svg>
  );
}

export function IconYouTube({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={2.75} y={6.25} width={18.5} height={11.5} rx={3.5} />
        <Path d="M10.5 9.8l4.6 2.2-4.6 2.2z" />
      </G>
    </Svg>
  );
}

export function IconX({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
      </G>
    </Svg>
  );
}

export function IconGitHub({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9.2 19.4c-3.4 1-3.4-1.8-4.8-2.2M14.5 21v-2.9a2.5 2.5 0 00-.7-1.9c2.4-.27 4.8-1.2 4.8-5.2a4 4 0 00-1.1-2.8 3.7 3.7 0 00-.1-2.8s-.9-.27-2.9 1.1a10 10 0 00-5.2 0C8.3 5.1 7.4 5.4 7.4 5.4a3.7 3.7 0 00-.1 2.8A4 4 0 006.2 11c0 4 2.4 4.9 4.8 5.2a2.5 2.5 0 00-.7 1.9V21" />
      </G>
    </Svg>
  );
}

/** Keys match the backend's `platform` values in users/links.py. */
export const PLATFORM_ICONS: Record<string, IconComponent> = {
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

export const PLATFORM_NAMES: Record<string, string> = {
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
