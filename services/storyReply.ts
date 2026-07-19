// Story replies travel through the normal message API as text. The story
// context (image, excerpt) is embedded in an encoded payload so the chat can
// render the replied-to story as media, Instagram-style. Both ends of a chat
// run this app, so the protocol only needs to round-trip through the backend
// as an opaque string.

export interface StoryReplyPayload {
  image?: string;
  excerpt?: string;
  comment: string;
}

const PREFIX = '§story-reply§';

export function encodeStoryReply(payload: StoryReplyPayload): string {
  return PREFIX + JSON.stringify(payload);
}

export function decodeStoryReply(text?: string): StoryReplyPayload | null {
  if (!text || !text.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(PREFIX.length));
    if (parsed && typeof parsed.comment === 'string') {
      return {
        comment: parsed.comment,
        image: typeof parsed.image === 'string' ? parsed.image : undefined,
        excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : undefined,
      };
    }
  } catch {}
  return null;
}

/** Human-readable form for chat-list previews and other plain-text surfaces. */
export function storyReplyPreview(text?: string): string | undefined {
  const decoded = decodeStoryReply(text);
  if (!decoded) return text ?? undefined;
  return `Replied to a story: ${decoded.comment}`;
}
