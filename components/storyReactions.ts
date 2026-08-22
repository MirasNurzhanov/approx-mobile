/**
 * The one reaction a story can carry.
 *
 * Lives beside StoryViewer rather than inside it: a component file that also
 * exports data loses its Fast Refresh boundary, so editing the viewer would
 * full-reload instead of preserving where you were in the story.
 *
 * A heart, not the thumbs-up this used to name. `like` is still the only
 * reaction the server knows (`stories.models.StoryReaction.ReactionType`), so
 * nothing about the data changed — but a thumb reads as approval of a claim,
 * and a story is not a claim.
 *
 * Singular, because the server's enum is. This was an array of one for as long
 * as the viewer drew a row of pills from it; the viewer now draws one heart in
 * its action bar, and an array would be an abstraction over nothing.
 */
import { IconHeart } from '@/components/ui/icons';
import type { ReactionType } from '@/services/stories';

// `typeof IconHeart` rather than the shared `IconComponent`: that alias is
// `(props: IconProps) => Element` and has no `filled`, so a heart typed as one
// could not be drawn solid — which is the entire difference between a story
// you have liked and one you have not.
export const STORY_LIKE: { type: ReactionType; Icon: typeof IconHeart } = {
  type: 'like',
  Icon: IconHeart,
};
