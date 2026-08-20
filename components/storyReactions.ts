/**
 * The reaction set a story can carry, in display order.
 *
 * Lives beside StoryViewer rather than inside it: the map reads this list too,
 * to work out a story's top reaction for the marker badge. A component file
 * that also exports data loses its Fast Refresh boundary, so editing the viewer
 * would full-reload instead of preserving where you were in the story.
 */
import {
  IconFunny,
  IconInsight,
  IconLike,
  IconStar,
  type IconComponent,
} from '@/components/ui/icons';
import type { ReactionType } from '@/services/stories';

export const REACTIONS: { type: ReactionType; Icon: IconComponent }[] = [
  { type: 'like',        Icon: IconLike },
  { type: 'funny',       Icon: IconFunny },
  { type: 'helpful',     Icon: IconInsight },
  { type: 'interesting', Icon: IconStar },
];
