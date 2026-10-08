// The map screen's StyleSheet, shared by the screen and every component in
// components/map. Moved out of app/(tabs)/map.tsx unchanged.

import {
    StyleSheet,
} from 'react-native';
import {
    CAPTION_GAP,
    CAPTION_H,
} from '@/services/markerLayout';
import { fonts, radius, type, withAlpha } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';

import { DOT_CORE, DOT_HALO, DOT_HALO_ICON, LOCATE_SIZE } from '@/components/map/mapConstants';

export type MapStyles = ReturnType<typeof makeStyles>;

// ─── Styles ───────────────────────────────────────────────────────────────────
export const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.body, color: colors.t3, fontSize: 14 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 20,
    color: colors.t1,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 8,
  },
  emptyBtnText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15, color: colors.bg },
  emptyLink: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  emptyLinkText: { fontFamily: fonts.body, fontWeight: '600', fontSize: 14, color: colors.teal },

  // ── Stranger marker: a lit point, no pin and no card ──
  //
  // The box stays DOT_HALO wide whatever the core does — it is also the touch
  // target, and at latitudeDelta 0.012 (~2 m per pixel) a 30 px box is about
  // the smallest thing a thumb can reliably hit among neighbours.
  /** Column so the caption sits under the halo and inside the rasterized box. */
  dotColumn: { alignItems: 'center' },
  dotWrap: {
    width: DOT_HALO,
    height: DOT_HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The interest glyph's core. A ringed disc rather than a filled one: the
   *  icon needs a dark field to stay legible over a light map, and the ring is
   *  what keeps it reading as the same lit-point idiom as a bare dot. */
  dotIconCore: {
    width: DOT_CORE + 12,
    height: DOT_CORE + 12,
    borderRadius: (DOT_CORE + 12) / 2,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    // The glow itself is applied inline, as a `boxShadow` built from the
    // marker's interest colour — see the `dotIconCore` call site.
  },
  /** Outer bloom: wide and very faint, so a cluster of matched strangers reads
   *  as a lit area before you can pick out the individual points. */
  dotBloom: {
    position: 'absolute',
    width: DOT_HALO,
    height: DOT_HALO,
    borderRadius: DOT_HALO / 2,
    opacity: 0.14,
  },
  /** Inner glow: tight enough to belong to the core rather than to the map. */
  dotGlow: {
    position: 'absolute',
    width: DOT_CORE + 8,
    height: DOT_CORE + 8,
    borderRadius: (DOT_CORE + 8) / 2,
    opacity: 0.3,
  },
  userDot: {
    width: DOT_CORE,
    height: DOT_CORE,
    borderRadius: DOT_CORE / 2,
    // A thin dark rim, not a thick one: the point has to stay a point when it
    // lands on a pale road label.
    borderWidth: 1.5,
    borderColor: colors.bg,
    // The glow itself is applied inline, as a `boxShadow` built from the
    // marker's colour — see the `userDot` call site. Android still rasterizes
    // the marker and drops it, which is why the bloom above does the same job
    // structurally.
  },

  /** Presence badge, pinned to the dot's lower-right so it reads as attached
   * to that person rather than as a second pin beside them. Offset from the
   * halo box's edge, since that is what the badge is positioned against. */
  dotPresence: {
    position: 'absolute',
    right: (DOT_HALO - DOT_CORE) / 2 - 2,
    bottom: (DOT_HALO - DOT_CORE) / 2 - 2,
  },
  /** Same badge against the larger icon core, so it stays on its edge rather
   *  than floating inside it. */
  dotPresenceIcon: {
    right: (DOT_HALO_ICON - (DOT_CORE + 12)) / 2 - 2,
    bottom: (DOT_HALO_ICON - (DOT_CORE + 12)) / 2 - 2,
  },

  /** Same idiom on the avatar markers, where the ring is the parent box. */
  markerPresence: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },

  // ── Avatar markers: photo/initial core, bg gap, relationship-colored ring ──
  avatarMarkerWrap: { alignItems: 'center' },
  avatarMarkerRing: {
    borderWidth: 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** What a marker draws while it is parked — see `PARKED_MARKERS`.
   *
   *  Not merely transparent: `opacity` hides the pixels but the rasterized
   *  bitmap keeps its size, and a 52 px bitmap still swallows every tap that
   *  lands on it, including the long-press that drops a story. One pixel has
   *  nothing left to swallow. */
  parkedMarker: { width: 1, height: 1 },

  // ── Cluster badge: a pile too tight to fan, shown as a headcount ──
  clusterWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Reads as "several people" before the number is even legible. */
  clusterBloom: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.teal,
    opacity: 0.14,
  },
  clusterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.teal,
  },

  // ── Music-zone label ──
  // Deliberately smaller and quieter than the cluster badge it borrows its
  // shape from: a cluster is something to tap, this is something to read.
  musicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    // Overridden per zone with that person's own colour — this is the fallback
    // for a chip drawn before one is resolved.
    borderColor: colors.tealLine,
    opacity: 0.92,
    // A username has no length limit; a chip pinned to the edge of a circle
    // does. Past this the name truncates rather than growing a label wider
    // than the ring it belongs to.
    maxWidth: 120,
  },
  musicBadgeText: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: colors.teal,
  },
  clusterCount: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.t1,
  },

  /** Name plate under the ring. Dark chip rather than bare text: over a light
   *  road or a water label, plain white type is unreadable. */
  markerCaption: {
    height: CAPTION_H,
    marginTop: CAPTION_GAP,
    maxWidth: 108,
    paddingHorizontal: 7,
    justifyContent: 'center',
    borderRadius: radius.s,
    backgroundColor: colors.bg + 'D2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  markerCaptionText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t1,
  },
  markerCaptionTag: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
  },
  avatarMarkerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMarkerInitial: {
    fontFamily: fonts.display,
    fontWeight: '600',
    // Tracks the 34 px fallback circle the larger marker leaves behind it.
    fontSize: 15,
    color: colors.bg,
  },

  // ── Self marker: purple halo, bg gap, purple ring — the halo is what makes
  // it read as "me" rather than as another avatar in another colour ──
  selfHalo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(139,92,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.purple,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  selfInitialWrap: {
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfInitial: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 12,
    color: colors.bg,
  },

  //: Checked out. Grey rather than purple, and no lit halo — the marker still
  //: has to be findable by its owner, so this dims it rather than hiding it.
  selfHaloHidden: { backgroundColor: 'rgba(140,140,150,0.14)' },
  selfCoreHidden: { borderColor: colors.t3 },

  // ── "Getting your location" chip ──
  // Invisible, and narrow enough that the map keeps almost all of its width
  // for panning. It claims nothing until a drag turns out to be a rightward
  // horizontal one — see `composeEdge`.
  composeEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 22,
  },
  pendingChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.m,
    backgroundColor: withAlpha(colors.bg, 0.92),
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  pendingChipText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
  },

  // Wider than `pendingChip` and pinned to the margins rather than centred:
  // this one is a control, and a tap target the width of its own text is a
  // tap target that gets missed.
  pausedNotice: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: withAlpha(colors.bg, 0.94),
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  pausedNoticeText: { flex: 1, gap: 1 },
  pausedNoticeTitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.t1,
  },
  pausedNoticeSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
  },

  // ── Basemap offset notice (mainland China only) ──
  offsetNotice: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: 'rgba(10,10,11,0.86)',
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  offsetNoticeText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: '#F5F5F7',
  },

  // ── Top bar (flat, no blur) ──
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 6,
    zIndex: 100,
  },
  topLogoText: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
    letterSpacing: 17 * 0.22,
  },
  topSpacer: { flex: 1 },
  // ── Glass chrome ──
  // No `backgroundColor` on any of the three below: the fill is drawn by
  // `GlassBackdrop` behind the content, and a background here would sit on top
  // of the blur and hide it. `overflow: hidden` is what keeps the blur inside
  // the corner radius — without it the blur is a rectangle behind a rounded
  // button and the corners show as four grey nicks.
  nearbyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 100,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  nearbyBadgeText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.m,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Locate control (tonal surface, teal tint while following) ──
  locateBtn: {
    position: 'absolute',
    // `right` is set inline — it tracks the nav's last tab, not the screen edge.
    width: LOCATE_SIZE,
    height: LOCATE_SIZE,
    borderRadius: radius.m,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the nav (zIndex 100 / elevation 10). Android orders hit-testing by
    // elevation independently of zIndex, so both are needed for the tap to
    // land — this is the one elevation on the screen, not a stacked shadow.
    zIndex: 110,
    elevation: 12,
  },
  /** Following. The tint is a *translucent* layer over the glass rather than a
   *  replacement fill: an opaque one would cover the blur, so the control
   *  would be glass when idle and a flat chip when active — the state change
   *  would read as the button being a different button. */
  locateTint: {
    backgroundColor: withAlpha(colors.tealLine, 0.35),
  },
  locateBtnActive: {
    borderColor: colors.tealLine,
  },

  // ── Zone audio, inside the sheet ──
  zoneSection: { marginBottom: 16, gap: 8 },
  zoneNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  zoneNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 15,
    color: colors.t3,
  },
  zoneReportText: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.t2,
  },

  // ── Sheet ──
  //
  // Both of these sit *below* the nav (zIndex 100 / elevation 10), which is the
  // rule everywhere: nothing covers the bar. They used to be 150 and 200, which
  // put the scrim and the card over it.
  //
  // Android orders siblings by `elevation` independently of `zIndex`, so a
  // layer that must stay under the nav has to lose on both — see LocateButton,
  // which has the same note for the opposite reason.
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 60, elevation: 6 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Sizes to its content — a stranger card is four short rows and used to be
    // padded out to 400 px of empty surface. SHEET_H is only the distance it
    // travels to get off screen, which stays larger than any card it holds.
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    zIndex: 70,
    elevation: 7,
    backgroundColor: colors.surface,
  },
  /** The draggable strip across the top of a sheet.
   *
   *  A 4pt-tall bar is not a drag target — a finger covers it several times
   *  over — so the gesture is attached to this padded row instead and the bar
   *  is only what makes it visible. The 16pt that used to be `marginBottom` on
   *  the handle is `paddingBottom` here, so the spacing below the handle is
   *  the same as before and is now also part of what you can grab. */
  sheetGrab: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 16,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
  },
  // Identity row: avatar or point, name + meta, relationship pill.
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sheetHeadBody: { flex: 1, gap: 3 },
  sheetName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  sheetMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },
  /** A stranger's "avatar": the map marker at card scale. Nothing is being
   *  withheld behind a placeholder silhouette — this is all there is. */
  strangerAvatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strangerAvatarGlow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.teal,
    opacity: 0.16,
  },
  strangerAvatarCore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
  },

  /** Outlined, not filled: the relationship is a label on this person, and a
   *  filled chip in the same colour would read as a button. */
  relPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  relPillText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  statusMotion: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.teal,
  },
  interestsSection: { marginBottom: 20 },
  sectionLabel: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  chipRow: { gap: 8 },
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 12,
    fontWeight: '500',
  },
  // Action row: wide primary, narrower secondary, square dismiss.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionPrimary: { flex: 1.5 },
  actionSecondary: { flex: 1 },
  actionDismiss: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendRow: { marginBottom: 10 },
  sheetFootnote: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.t3,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 8,
  },

  // ─── Story marker: surface card + tail + reaction pill (no gold, no shadows) ───
  storyCard: {
    padding: 5,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storyAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  storyCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCardAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  storyCardAvatarText: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 14,
    color: colors.bg,
  },
  storyCardTail: {
    width: 10,
    height: 10,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
  },
  storyReactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 100,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storyReactionText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t2,
  },

  // ─── Story count badge (inside avatar, bottom-right) ───
  // Sized to the avatar it sits on, so the badge below can overhang its edge
  // without being clipped by the avatar's own rounding.
  storyAvatarStack: { width: 40, height: 40 },
  storyCountBadge: {
    position: 'absolute',
    // Top-right, not bottom-right: the bottom corner is where the card's tail
    // points, and the two were overlapping.
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
    borderWidth: 1.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  storyCountText: {
    fontFamily: fonts.body,
    // 9pt was below the 11pt floor constants/theme.ts documents as the limit
    // of legibility. Dark on teal, matching every other filled badge here —
    // white on teal is the app's lowest-contrast pairing.
    fontSize: type.micro,
    fontWeight: '700',
    color: colors.bg,
  },

  // ─── Create story modal ───
  createModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  createModalSheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: colors.surface,
  },
  createModalHeader: {
    flexDirection: 'row',
    // Top-aligned, not centred: the title block is two lines now and the close
    // button belongs beside the first of them.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    marginTop: 2,
  },
  createModalTitleWrap: { flex: 1, gap: 2 },
  createModalTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    // 22, not 17. The sheet has one job and this is the only heading in it.
    fontSize: 22,
    color: colors.t1,
  },
  createModalSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.t3,
  },
  createModalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Camera / Library, as two equal cards rather than two bare icon squares.
  mediaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  mediaCard: {
    flex: 1,
    height: 74,
    borderRadius: radius.m,
    borderWidth: 1,
    // Deliberately solid rather than dashed, which is the obvious choice for
    // an empty slot: Android drops the dash pattern as soon as the border is
    // rounded, so a dashed style here would be dashed on iOS only.
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaCardPressed: { opacity: 0.7 },
  mediaCardLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.t2,
  },

  captionWrap: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingBottom: 8,
    marginBottom: 14,
  },
  storyInput: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 88,
    textAlignVertical: 'top',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  charCount: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 11,
    textAlign: 'right',
    paddingHorizontal: 14,
  },
  // Full-contrast rather than a warm accent: this is the one moment the count
  // matters, and an 11pt coral on a coral-tinted surface is not a signal.
  charCountNear: { color: colors.t1, fontWeight: '700' },

  storyNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
  },
  storyNote: {
    flex: 1,
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 12,
    lineHeight: 16,
  },
  photoPreviewContainer: {
    marginBottom: 14,
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 190,
    borderRadius: radius.m,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    // `surface`, not `surface2`: this one sits on the photo rather than on the
    // sheet, and needs to hold its own against whatever is behind it.
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBtn: {
    // Full width now that the two photo buttons have moved up out of this row.
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBtnDisabled: { opacity: 0.45 },
  postBtnText: {
    fontFamily: fonts.body,
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Hi toast (design toast: surface2 pill, icon + label) ──
  hiToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 9,
    zIndex: 200,
  },
  hiToastText: { fontFamily: fonts.body, color: colors.t1, fontSize: 13, fontWeight: '500' },

  // ── Meetup marker: purple bubble pin with emblem or calendar icon ──
  meetupMarkerWrap: { alignItems: 'center' },
  meetupMarkerBubble: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(139,92,246,0.4)',
  },
  meetupMarkerImg: { width: 32, height: 32, borderRadius: 8 },
  meetupMarkerTail: {
    width: 12,
    height: 12,
    backgroundColor: colors.purple,
    transform: [{ rotate: '45deg' }],
    marginTop: -7,
    borderBottomRightRadius: 3,
  },

  /** The "you are going" corner on a meetup's own marker. Overlaps the bubble's
   *  top-right rather than sitting beside it, so the marker keeps its width and
   *  the fan-out arithmetic in services/markerLayout still holds. */
  goingCorner: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Pinned places ──
  pinnedMarkerWrap: { alignItems: 'center' },
  /** A held place, not a person and not an event: the surface colour with the
   *  source's tint as an outline, so a pin reads as something the viewer put
   *  there rather than as another thing the map found. */
  pinnedMarkerBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  /** The point of the teardrop: a rotated square showing two of its sides, so
   *  the outline runs unbroken around the whole marker. */
  pinnedMarkerTail: {
    width: 10,
    height: 10,
    backgroundColor: colors.surface,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomRightRadius: 2,
  },
  pinnedSheetGlyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedKindLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 3,
  },
  /** What the viewer wrote about this place. Quiet by design — it is their
   *  own handwriting on somebody else's map, not a second title. */
  pinNoteBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  /** Empty, it is an invitation rather than content: dashed, and in the accent
   *  the rest of the app uses for "you can do something here". */
  pinNoteEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.tealLine,
    backgroundColor: 'transparent',
  },
  pinNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t1,
  },
  pinNoteAddText: { color: colors.teal, fontWeight: '600' },

  /** Two buttons on one line. `Button` takes no style of its own, so each one
   *  is full-width inside a flexed cell rather than flexed itself. */
  sheetActionRow: { flexDirection: 'row', gap: 10 },
  sheetActionCell: { flex: 1 },

  // ── Meetup sheet ──
  meetupSheetEmblem: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meetupSheetEmblemFallback: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetupExpiryPill: {
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.3)',
  },
  meetupExpiryText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.purple,
  },
  meetupDetailBlock: { gap: 10, marginBottom: 20 },
  meetupDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetupDetailText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },
  meetupDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 19,
    marginTop: 4,
  },
});
