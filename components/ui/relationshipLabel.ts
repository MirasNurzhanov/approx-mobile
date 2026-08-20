/**
 * The word for a relationship tier, without the badge that usually shows it.
 *
 * Split out of RelationshipBadge so that component file exports only its
 * component and keeps its Fast Refresh boundary. The `Relationship` type still
 * lives with the badge — types are erased, so a type export costs nothing.
 */
import type { Relationship } from './RelationshipBadge';

export function relationshipLabel(rel: Relationship): string {
  // Labels are theme-independent so we use static fallbacks here.
  const labels: Record<Relationship, string> = {
    friend: 'Friend', connected: 'Connected', hi_sent: 'Hi sent',
    hi_received: 'Hi received', stranger: 'Nearby',
  };
  return labels[rel] ?? labels.stranger;
}
