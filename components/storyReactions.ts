/**
 * The reaction a story can carry.
 *
 * Lives beside StoryViewer rather than inside it: the map reads this too, to
 * show a story's like count on the marker badge. A component file that also
 * exports data loses its Fast Refresh boundary, so editing the viewer would
 * full-reload instead of preserving where you were in the story.
 */
import { IconLike, type IconComponent } from '@/components/ui/icons';
import type { ReactionType } from '@/services/stories';

export const REACTIONS: { type: ReactionType; Icon: IconComponent }[] = [
  { type: 'like', Icon: IconLike },
];
