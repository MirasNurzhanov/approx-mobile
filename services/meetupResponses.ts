import { api } from './api';

// "I'm in" / "Nope" on a club meetup. The club sees these — that is the point:
// the card shows how many are coming and who. See clubs/responses.py.

export type MeetupAnswer = 'in' | 'out';

export interface ResponsePerson {
  id: number;
  username: string;
  profile_picture?: string | null;
}

export interface MeetupResponseSummary {
  in_count: number;
  out_count: number;
  /** Of those in, how many tapped "I'm here" at the meetup — the map's "3/9". */
  here_count?: number;
  /** A few faces for the card, "in" first. */
  preview: ResponsePerson[];
  /** Null when this reader has not answered, or when the summary came down
   *  the socket, which is the same for everyone. */
  my_answer?: MeetupAnswer | null;
  /** Whether this reader has checked in at the meetup. */
  my_arrived?: boolean;
}

export const NO_RESPONSES: MeetupResponseSummary = {
  in_count: 0, out_count: 0, here_count: 0, preview: [], my_answer: null, my_arrived: false,
};

/** Answer, change the answer, or take it back with `null`. */
export async function answerMeetup(eventId: number, answer: MeetupAnswer | null): Promise<MeetupResponseSummary> {
  const { data } = await api.post<MeetupResponseSummary>(`/api/clubs/events/${eventId}/responses/`, { answer });
  return data;
}

export async function fetchMeetupResponses(eventId: number): Promise<{ in: ResponsePerson[]; out: ResponsePerson[] }> {
  const { data } = await api.get<{ in: ResponsePerson[]; out: ResponsePerson[] }>(
    `/api/clubs/events/${eventId}/responses/`,
  );
  return { in: data.in ?? [], out: data.out ?? [] };
}

/**
 * "I'm here", at the meetup itself. The server checks `coords` against the
 * meetup's place and refuses with a `code` of `too_far`, `too_early` or
 * `no_location`, whose `detail` is fit to show.
 */
export async function arriveAtMeetup(
  eventId: number,
  coords: { latitude: number; longitude: number },
): Promise<MeetupResponseSummary> {
  const { data } = await api.post<MeetupResponseSummary>(`/api/clubs/events/${eventId}/here/`, coords);
  return data;
}

/** Take back a mistaken "I'm here". */
export async function undoArrival(eventId: number): Promise<MeetupResponseSummary> {
  const { data } = await api.delete<MeetupResponseSummary>(`/api/clubs/events/${eventId}/here/`);
  return data;
}

/** A summary that arrived over the socket keeps this reader's own state. */
export function mergeBroadcast(
  current: MeetupResponseSummary | undefined,
  incoming: MeetupResponseSummary,
): MeetupResponseSummary {
  return { ...incoming, my_answer: current?.my_answer ?? null, my_arrived: current?.my_arrived ?? false };
}
