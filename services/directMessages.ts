/** A Swift sent into the conversation, as the server describes it to this reader. */
export interface SharedSwift {
  id: number;
  caption?: string;
  thumbnail_url?: string | null;
  duration_ms?: number;
  author: { id: number; username: string };
}

export interface DirectMessage {
  id: string;
  client_id?: string | null;
  text?: string;
  image?: string;
  swift?: SharedSwift;
  /** A shared Swift this reader can no longer watch — deleted, made private,
   *  or its author blocked them. Drawn as such rather than as an empty bubble. */
  swiftUnavailable?: boolean;
  sender_id: number;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
  failure?: string;
}

export interface RawDirectMessage {
  id?: string | number;
  client_id?: string | null;
  content?: string;
  message?: string;
  text?: string;
  body?: string;
  msg?: string;
  image?: string;
  swift?: SharedSwift | null;
  swift_unavailable?: boolean;
  /** Live socket frames name the Swift without its card; see useDirectMessages. */
  swift_id?: number | null;
  sender_id?: number;
  sender?: number | string | { id: number; username?: string };
  timestamp?: string;
  created_at?: string;
  type?: string;
  detail?: string;
}

export function normaliseMessage(raw: RawDirectMessage): DirectMessage {
  const sender = raw.sender;
  const senderId = raw.sender_id ?? (typeof sender === 'object' ? sender.id : sender);
  const text = raw.content ?? raw.message ?? raw.text ?? raw.body ?? raw.msg;
  return {
    id: String(raw.id), client_id: raw.client_id,
    text: text != null ? String(text) : undefined, image: raw.image,
    ...(raw.swift ? { swift: raw.swift } : {}),
    ...(raw.swift_unavailable ? { swiftUnavailable: true } : {}),
    sender_id: senderId != null ? Number(senderId) : -1,
    created_at: raw.timestamp ?? raw.created_at ?? new Date().toISOString(),
  };
}
