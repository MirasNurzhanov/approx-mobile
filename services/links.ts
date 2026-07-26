import { api } from './api';

// Profile links.
//
// The client is a renderer here, not a validator. Every URL in `ProfileLink`
// has already been canonicalized server-side (https, no credentials, no port,
// no tracking params), and `platform`, `handle` and `label` are all derived
// there too. The app never parses a URL to decide what to show, and never
// fetches one for metadata.

export interface ProfileLink {
  id: number;
  url: string;
  /** 'instagram' | 'spotify' | ... | 'website' — picks a bundled icon. */
  platform: string;
  handle: string;
  /** Ready to render: "@name", or the bare host for unknown sites. */
  label: string;
  position: number;
}

export const MAX_LINKS = 5;

/** Platforms where a bare `@handle` is enough — mirrors HANDLE_TEMPLATES. */
export const HANDLE_PLATFORMS = [
  'instagram',
  'x',
  'telegram',
  'tiktok',
  'github',
  'youtube',
] as const;

export async function fetchLinks(): Promise<ProfileLink[]> {
  const { data } = await api.get<ProfileLink[]>('/api/users/links/');
  return Array.isArray(data) ? data : [];
}

/**
 * Add a link. `platform` is only a hint that lets the server expand a bare
 * `@handle`; it never overrides what the server detects from a full URL.
 * Rejection messages come from the server — the client does not second-guess
 * what is valid.
 */
export async function addLink(url: string, platform?: string): Promise<ProfileLink> {
  const { data } = await api.post<ProfileLink>('/api/users/links/', { url, platform });
  return data;
}

export async function deleteLink(id: number): Promise<void> {
  await api.delete(`/api/users/links/${id}/`);
}

export async function reorderLinks(ids: number[]): Promise<ProfileLink[]> {
  const { data } = await api.patch<ProfileLink[]>('/api/users/links/', { order: ids });
  return Array.isArray(data) ? data : [];
}

/** Extracts the host for the "you're about to open X" confirmation. Display
 * only — the URL is already validated, this just avoids showing the full
 * string in an alert. */
export function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!match) return url;
  return match[1].replace(/^www\./i, '');
}

/** Human-readable error from a failed add. */
export function linkErrorMessage(error: any): string {
  const data = error?.response?.data;
  return (
    data?.url?.[0] ??
    data?.detail ??
    'That link couldn’t be added. Check it and try again.'
  );
}
