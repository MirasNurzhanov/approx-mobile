import { updatePrivacy } from './privacy';

// The "Go Invisible" action on the launch prompt (components/LocationLaunchPrompt,
// wired from app/_layout.tsx).
//
// Isolated in its own file, the same shape as services/signOut.ts, so the one
// write it makes is a single line an auditor can find without reading the rest
// of the app: this function pauses sharing and nothing else. That direction is
// always allowed without being asked — see
// services/__tests__/noAutomaticVisibility.test.ts, which enumerates every file
// permitted to write `location_sharing`. app/_layout.tsx, where the prompt
// itself lives, is deliberately not one of them; routing the write through here
// keeps that file's surface at zero regardless of what the prompt's button does.
export async function goInvisible(): Promise<void> {
  await updatePrivacy({ location_sharing: 'paused' });
}
