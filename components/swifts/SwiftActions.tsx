import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  SwiftCommentIcon,
  SwiftLikeIcon,
  SwiftMoreIcon,
  SwiftMuteIcon,
  SwiftRepostIcon,
  SwiftSaveIcon,
  SwiftSoundIcon,
  type SwiftIconComponent,
} from '@/components/swifts/icons';
import {
  SwiftLocationButton, type RevealState,
} from '@/components/swifts/SwiftLocationButton';
import { fonts, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { formatCount } from '@/services/swifts';

/**
 * The action rail.
 *
 * Every glyph here is Approx's own — see `components/swifts/icons.tsx`. No icon
 * pack: the rail sits over arbitrary user video, and these need real two-state
 * designs (a *filled* like, a *revealed* location) that a single-weight pack
 * cannot provide without tinting the same outline and hoping.
 *
 * ## Touch targets
 *
 * The glyphs are 28pt, which is under the 44pt minimum on its own. Each button
 * carries `hitSlop` that takes the tappable area past it — the visual density
 * of a video rail and the size of a finger are different problems, and hitSlop
 * is how they are both solved at once.
 *
 * ## Rerenders
 *
 * `memo` with the default shallow comparison. The feed re-renders on every
 * scroll tick and on every optimistic count change; without this, five icons
 * and their SVG trees are rebuilt for cards nobody is looking at. Every prop
 * here is a primitive or a stable callback from the feed, so the shallow
 * compare is exact rather than approximate.
 */

export interface SwiftActionsProps {
  locationAvailable: boolean;
  revealState: RevealState;
  onRevealLocation: () => void;

  isLiked: boolean;
  likeCount: number;
  commentCount: number;
  isReposted: boolean;
  repostCount: number;
  /** On this viewer's shortlist. No count beside it: saving is private, so
   *  there is no public number to show and none that could be leaked. */
  isSaved: boolean;
  /** The creator turned reposts off; the control is hidden rather than inert. */
  allowReposts: boolean;
  allowComments: boolean;

  muted: boolean;
  onLike: () => void;
  onComment: () => void;
  onRepost: () => void;
  onSave: () => void;
  onMore: () => void;
  onToggleMute: () => void;
  /** Distance from the bottom, worked out by the caller from the nav arc. */
  bottom: number;
}

interface ActionProps {
  Glyph: SwiftIconComponent;
  on?: boolean;
  onColor?: string;
  label?: string;
  busy?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
}

const GLYPH = 28;
/** Takes each 28pt glyph past the 44pt touch minimum without spacing the rail
 *  out to the point where it covers the video. */
const HIT_SLOP = { top: 10, bottom: 10, left: 12, right: 12 };

function ActionButton({
  Glyph, on = false, onColor, label, busy = false,
  accessibilityLabel, accessibilityHint, onPress,
}: ActionProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      onPress={onPress}
      disabled={busy}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityState={{ selected: on, busy }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.glyphSlot}>
        {busy
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Glyph size={GLYPH} color="#FFFFFF" on={on} onColor={onColor} />}
      </View>
      {label ? (
        <Text style={styles.label} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SwiftActionsImpl({
  locationAvailable, revealState, onRevealLocation,
  isLiked, likeCount, commentCount, isReposted, repostCount, isSaved,
  allowReposts, allowComments,
  muted, onLike, onComment, onRepost, onSave, onMore, onToggleMute, bottom,
}: SwiftActionsProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.rail, { bottom }]}>
      <ActionButton
        Glyph={muted ? SwiftMuteIcon : SwiftSoundIcon}
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        onPress={onToggleMute}
      />

      <ActionButton
        Glyph={SwiftLikeIcon}
        on={isLiked}
        onColor={colors.red}
        label={formatCount(likeCount)}
        accessibilityLabel={
          isLiked
            ? `Unlike. ${likeCount} likes`
            : `Like. ${likeCount} likes`
        }
        onPress={onLike}
      />

      {allowComments && (
        <ActionButton
          Glyph={SwiftCommentIcon}
          label={formatCount(commentCount)}
          accessibilityLabel={`Comments. ${commentCount}`}
          onPress={onComment}
        />
      )}

      {allowReposts && (
        <ActionButton
          Glyph={SwiftRepostIcon}
          on={isReposted}
          onColor={colors.green}
          label={formatCount(repostCount)}
          accessibilityLabel={
            isReposted
              ? `Undo repost. ${repostCount} reposts`
              : `Repost. ${repostCount} reposts`
          }
          onPress={onRepost}
        />
      )}

      {/* No count, and always shown. A shortlist is private, so unlike
          reposts there is no creator switch that can turn it off and no
          number whose absence would say anything. */}
      <ActionButton
        Glyph={SwiftSaveIcon}
        on={isSaved}
        onColor={colors.teal}
        accessibilityLabel={isSaved ? 'Remove from saved' : 'Save'}
        accessibilityHint={isSaved
          ? 'Takes this Swift off your saved list'
          : 'Keeps this Swift on your profile, visible only to you'}
        onPress={onSave}
      />

      {/* Only when this viewer could actually reveal it. A Swift whose
          location they could never see draws nothing, so the control's
          presence is not itself a signal about content out of reach. */}
      {locationAvailable && (
        <SwiftLocationButton
          state={revealState}
          onPress={onRevealLocation}
          activeTint={colors.teal}
        />
      )}

      <ActionButton
        Glyph={SwiftMoreIcon}
        accessibilityLabel="More options"
        onPress={onMore}
      />
    </View>
  );
}

// Kept despite react-doctor/react-compiler-no-manual-memoization: SwiftCard
// wraps every handler it passes here in a `useCallback` specifically to keep
// this `memo` honest (see the comment at SwiftCard's handler block), and
// SwiftCard itself does not compile — so this boundary is the only thing
// keeping the action rail out of each card's re-render in the feed.
export const SwiftActions = memo(SwiftActionsImpl);

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: 10,
    alignItems: 'center',
    gap: 18,
  },
  action: { alignItems: 'center', gap: 3 },
  pressed: { opacity: 0.6 },
  glyphSlot: {
    width: GLYPH,
    height: GLYPH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
