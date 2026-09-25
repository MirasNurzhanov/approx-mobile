import { api } from './api';

// Reporting, for every kind of content in the app.
//
// One module because there is one sheet: `components/ReportSheet` posts
// whatever it is given, and the only thing that varies between a Swift, a
// story, a comment, a message and a profile is the URL. Keeping the reason list
// here rather than in the component means the app and
// `moderation/reasons.py` can be compared side by side, which is the only way
// they stay in step.
//
// Two endpoints, deliberately:
//
//   Swifts        POST /api/swifts/<id>/report/
//   everything    POST /api/moderation/report/<kind>/<id>/
//
// The Swift one is older, throttled, tested and already in front of moderators
// — it was not worth migrating for the sake of a tidier URL table. Both take
// exactly the same body, so nothing above this line has to know which is which.

export type ReportTarget =
  | 'swift'
  | 'user'
  | 'story'
  | 'comment'
  | 'message'
  | 'club_message'
  /** Somebody's Zone Music; the id is the owner's user id. */
  | 'zone_audio';

/** Kept in the same order as the sheet renders them, worst-first-ish: the
 *  categories that need a human today are near the top where a distressed
 *  person will find them without reading the whole list. Values must match
 *  `moderation/reasons.py` exactly — the server validates against that list. */
export const REPORT_REASONS: { value: string; label: string; hint?: string }[] = [
  { value: 'minor_safety', label: 'Risk to a minor', hint: 'Sexual content, grooming, or a child in danger' },
  { value: 'nudity',       label: 'Nudity or sexual content' },
  { value: 'hate',         label: 'Hate or harassment', hint: 'Slurs, targeted abuse, threats to a group' },
  { value: 'violence',     label: 'Violence or threats' },
  { value: 'self_harm',    label: 'Self-harm or suicide' },
  { value: 'privacy',      label: 'Reveals private information', hint: 'Someone’s address, phone number or workplace' },
  { value: 'spam',         label: 'Spam or a scam' },
  { value: 'other',        label: 'Something else' },
];

const PATHS: Record<ReportTarget, (id: number | string) => string> = {
  swift:        (id) => `/api/swifts/${id}/report/`,
  user:         (id) => `/api/moderation/report/user/${id}/`,
  story:        (id) => `/api/moderation/report/story/${id}/`,
  comment:      (id) => `/api/moderation/report/comment/${id}/`,
  message:      (id) => `/api/moderation/report/message/${id}/`,
  club_message: (id) => `/api/moderation/report/club-message/${id}/`,
  zone_audio:   (id) => `/api/moderation/report/zone-audio/${id}/`,
};

/** What a caller shows the user when the report could not be filed.
 *
 * Every failure here is worth surfacing. The screen this replaces reported
 * success unconditionally, including for a request that 404'd — so the user
 * believed they had reported somebody and nothing had happened. Never again:
 * this throws, and every caller shows the failure. */
export class ReportFailed extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ReportFailed';
    this.status = status;
  }
}

/**
 * File a report. Resolves only when the server has accepted it.
 *
 * The server is idempotent per (reporter, target) and its response does not
 * distinguish a first report from a repeat — that is deliberate on its side,
 * and it means this can be called freely without the app having to remember
 * what it has already reported.
 */
export async function reportContent(
  target: ReportTarget,
  id: number | string,
  reason: string,
  note = '',
): Promise<void> {
  try {
    await api.post(PATHS[target](id), { reason, note: note.trim().slice(0, 500) });
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 429) {
      throw new ReportFailed(
        'You’ve sent a lot of reports just now. Please try again in a little while.',
        status,
      );
    }
    if (status === 404) {
      throw new ReportFailed('That content is no longer available.', status);
    }
    if (status === 400) {
      throw new ReportFailed(
        e?.response?.data?.detail ?? 'That report could not be sent.',
        status,
      );
    }
    throw new ReportFailed(
      'Could not send that report. Check your connection and try again.',
      status,
    );
  }
}
