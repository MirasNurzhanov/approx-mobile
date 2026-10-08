export interface DirectMessage {
  id: string;
  client_id?: string | null;
  text?: string;
  image?: string;
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
    sender_id: senderId != null ? Number(senderId) : -1,
    created_at: raw.timestamp ?? raw.created_at ?? new Date().toISOString(),
  };
}
