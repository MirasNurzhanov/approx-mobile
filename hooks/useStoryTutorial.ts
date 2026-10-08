// First-run tutorial, step 1: how to post a story.
//
// Keyed by account, not just checked once on mount — it waits on the user id
// because the flag itself is namespaced by it (see services/tutorial.ts), and
// re-runs only when that id changes, which happens once per session.

import { useEffect, useState } from 'react';

import { hasSeenStoryTutorial, markStoryTutorialSeen } from '@/services/tutorial';

export function useStoryTutorial(currentUserId: number | null) {
  const [showStoryTutorial, setShowStoryTutorial] = useState(false);

  useEffect(() => {
    if (currentUserId === null) return;
    hasSeenStoryTutorial(currentUserId).then((seen) => { if (!seen) setShowStoryTutorial(true); });
  }, [currentUserId]);

  function dismissStoryTutorial() {
    setShowStoryTutorial(false);
    if (currentUserId !== null) markStoryTutorialSeen(currentUserId).catch(() => {});
  }

  return { showStoryTutorial, dismissStoryTutorial };
}
