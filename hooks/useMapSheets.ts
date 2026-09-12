// Which panel the map currently has open, and the spring that opens it.
//
// Split out of app/(tabs)/map.tsx. Four things can cover the map — a person's
// card, a club meetup's card, a pinned place's card, and the full-screen story
// viewer — and they are mutually exclusive, so opening one closes the others.
// Keeping that rule in one file is the reason this is a hook rather than four
// pieces of screen state: it used to be spelled out again in each of the
// open/close handlers, which is one place per handler for it to drift.
//
// Two properties worth knowing before changing anything here:
//
//  - **Sheets are cached, not unmounted.** `sheetUser` and `sheetMeetup` hold
//    the last non-null selection so the sheet components stay mounted between
//    taps. The screen renders them at zero opacity while nothing is selected.
//  - **Rows are read back out of the live lists.** `selectedUser` and
//    `storyViewer` look their content up in `nearby`/`stories` on every render,
//    so an open sheet follows each poll without anything copying into it.

import { useState } from 'react';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ClubMeetup, NearbyUser } from '@/services/mapTypes';
import type { PinnedPlace } from '@/services/pinnedPlaces';
import type { Story } from '@/services/stories';

/** How far a sheet travels to get off screen — not its height, which sizes to
 *  content. Raised from 400 when the zone player moved into the card: a friend
 *  broadcasting a track makes the tallest card the sheet holds, and a travel
 *  distance shorter than the card leaves a sliver of it on screen. */
export const SHEET_H = 560;
/** Shared with the drag handles on the sheets themselves, so a flick and a
 *  programmatic dismiss settle identically. */
export const SPRING_CFG = { damping: 22, stiffness: 220, mass: 0.9 };

export function useMapSheets(
  nearby: NearbyUser[],
  stories: Story[],
  pinnedPlaces: PinnedPlace[],
) {
  const sheetY = useSharedValue(SHEET_H);

  /** Who the sheet was opened for. The row shown is read back out of the live
   *  list below, so an open sheet follows each poll on its own. */
  const [openUser, setOpenUser] = useState<NearbyUser | null>(null);
  // Losing a row can mean Ghost Mode, a block or a revoked audience. The
  // opened copy is not permission to keep displaying it after that change.
  const selectedUser = openUser ? (nearby.find((u) => u.id === openUser.id) ?? null) : null;

  const [selectedMeetup, setSelectedMeetup] = useState<ClubMeetup | null>(null);

  /** Which pin the sheet was opened on, read back out of the live list the
   *  same way `selectedUser` is, so an edited pin — a meetup whose time the
   *  club moved — shows through without anything copying into the sheet.
   *
   *  Falls back to the opened row rather than to null when the pin is gone,
   *  which is what unpinning from inside the card does: the card has to
   *  survive its own dismissal or the sheet blanks mid-slide. `closePinSheet`
   *  is what clears it, once the spring has finished. */
  const [openPin, setOpenPin] = useState<PinnedPlace | null>(null);
  const selectedPin = openPin
    ? (pinnedPlaces.find((p) => p.id === openPin.id) ?? openPin)
    : null;

  /** Which stories the viewer was opened on. Each one is read back out of the
   *  live list below, so reactions and refetches show through without the
   *  viewer's copy having to be patched to match. */
  const [openStories, setOpenStories] = useState<Story[] | null>(null);
  const currentStories = openStories
    ? openStories.flatMap(s => {
      const current = stories.find(f => f.id === s.id);
      return current ? [current] : [];
    })
    : [];
  const storyViewer = currentStories.length > 0 ? { stories: currentStories } : null;

  // The last non-null selection — lets us keep the sheet components mounted
  // between taps instead of unmounting on every dismiss. State rather than a
  // ref, because render reads it back to decide what stays mounted, and a ref
  // read during render is what stops the compiler optimising this screen.
  const [sheetUser, setSheetUser]     = useState<NearbyUser | null>(null);
  const [sheetMeetup, setSheetMeetup] = useState<ClubMeetup | null>(null);
  const [sheetPin, setSheetPin]       = useState<PinnedPlace | null>(null);

  function openSheet(user: NearbyUser) {
    setSelectedMeetup(null);
    setOpenPin(null);
    setOpenUser(user);
    sheetY.set(withSpring(0, SPRING_CFG));
  }

  function closeSheet() {
    sheetY.set(withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) scheduleOnRN(setOpenUser, null);
    }));
  }

  function openMeetupSheet(meetup: ClubMeetup) {
    setOpenStories(null);
    setOpenUser(null);
    setOpenPin(null);
    setSelectedMeetup(meetup);
    sheetY.set(withSpring(0, SPRING_CFG));
  }

  function closeMeetupSheet() {
    sheetY.set(withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) scheduleOnRN(setSelectedMeetup, null);
    }));
  }

  function openPinSheet(place: PinnedPlace) {
    setOpenStories(null);
    setOpenUser(null);
    setSelectedMeetup(null);
    setOpenPin(place);
    sheetY.set(withSpring(0, SPRING_CFG));
  }

  function closePinSheet() {
    sheetY.set(withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) scheduleOnRN(setOpenPin, null);
    }));
  }

  function openStoryViewer(authorStories: Story[]) {
    sheetY.set(SHEET_H);
    setOpenUser(null);
    setSelectedMeetup(null);
    setOpenPin(null);
    setOpenStories(authorStories);
  }

  function closeStoryViewer() {
    setOpenStories(null);
  }

  // Keep last non-null selection cached so the sheets stay mounted. Caught
  // during render, not from an effect: the sheet has to have its content on the
  // first painted frame, or opening it flashes an empty panel. Both conditions
  // go false on the retry, so this settles in one extra pass.
  if (selectedUser && selectedUser !== sheetUser) setSheetUser(selectedUser);
  if (openUser && !selectedUser) setOpenUser(null);
  if (sheetUser && !nearby.some(user => user.id === sheetUser.id)) setSheetUser(null);
  if (openStories && currentStories.length !== openStories.length) {
    setOpenStories(currentStories.length > 0 ? currentStories : null);
  }
  if (selectedMeetup && selectedMeetup !== sheetMeetup) setSheetMeetup(selectedMeetup);
  if (selectedPin && selectedPin !== sheetPin) setSheetPin(selectedPin);

  return {
    sheetY,
    selectedUser,
    selectedMeetup,
    selectedPin,
    storyViewer,
    sheetUser,
    sheetMeetup,
    sheetPin,
    openSheet,
    closeSheet,
    openMeetupSheet,
    closeMeetupSheet,
    openPinSheet,
    closePinSheet,
    openStoryViewer,
    closeStoryViewer,
  };
}
