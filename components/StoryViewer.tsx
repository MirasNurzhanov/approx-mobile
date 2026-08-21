import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PanResponderInstance,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REACTIONS } from '@/components/storyReactions';
import { Avatar } from '@/components/ui/Avatar';
import { Scrim } from '@/components/ui/Scrim';
import {
  IconBookmark,
  IconChevron,
  IconClose,
  IconPin,
} from '@/components/ui/icons';
import { fonts, radius, type } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import {
  starStory,
  unstarStories,
  useStoryArchive,
  type ReactionType,
  type FeedStory,
} from '@/services/stories';
import { encodeStoryReply } from '@/services/storyReply';

// Full-screen story viewer, shared by the map and the starred-stories archive.
//
// The chrome sits on two gradient scrims rather than in translucent panels.
// Panels were the original approach and they read as three grey slabs pasted
// over the photo — and worse, the story *text* had no panel at all, so white
// 18pt copy over a bright photo was simply unreadable. A gradient disappears
// where the image is already dark and does its work where it is not, which is
// the whole reason every full-bleed photo UI uses one.

export const STORY_DURATION_MS = 7_000;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeLeft(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return `${Math.floor(diff / 60_000)}m left`;
  return `${hrs}h left`;
}

function ProgressBar({ active, past, progress }: {
  active: boolean;
  past: boolean;
  progress: SharedValue<number>;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const style = useAnimatedStyle(() => {
    const pct = active ? progress.get() : past ? 1 : 0;
    return { width: `${pct * 100}%` };
  });
  return (
    <View style={styles.svTrack}>
      <Animated.View style={[styles.svFill, style]} />
    </View>
  );
}

export interface StoryViewerProps {
  // `FeedStory`, not `Story`: this viewer is opened from the chat rings and
  // the archive as well as from the map, and a story posted while location
  // sharing was paused has no coordinate to require.
  stories: FeedStory[];
  onClose: () => void;
  /** Omit to show reaction counts read-only (e.g. in the archive, where the
   * within-500m rule would reject a new reaction anyway). */
  onReact?: (storyId: number, reaction: ReactionType) => void;
  /** When set (author is a friend), shows the reply bar that DMs the comment. */
  replyTo?: { id: number; username: string } | null;
  /** Enables the star toggle — only ever shown on the viewer's own story,
   *  since starring is not a bookmark of anyone else's post. */
  currentUserId?: number | null;
}

export function StoryViewer({ stories, onClose, onReact, replyTo, currentUserId }: StoryViewerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const progress = useSharedValue(0);
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [togglingStar, setTogglingStar] = useState(false);
  const { starredIds } = useStoryArchive();

  function goTo(i: number) {
    if (i >= stories.length) { onClose(); return; }
    if (i < 0) return;
    indexRef.current = i;
    setIndex(i);
  }

  // Read only from the pan handler and the auto-advance timer, both of which
  // run after the commit this effect follows.
  const goToRef = useRef(goTo);
  useEffect(() => { goToRef.current = goTo; });

  // Auto-advance, paused while the reply input is focused.
  useEffect(() => {
    if (replyFocused) {
      cancelAnimation(progress);
      return;
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: STORY_DURATION_MS }));
    const timer = setTimeout(() => goToRef.current(indexRef.current + 1), STORY_DURATION_MS);
    return () => {
      cancelAnimation(progress);
      clearTimeout(timer);
    };
  }, [index, replyFocused, progress]);

  // Built once, in an effect rather than during render. The handlers have to
  // read `.current` to stay on the live story, and the compiler counts every
  // ref read reachable from a render-time call as a render-time read — which a
  // `useRef`/`useState` initialiser is. Inside an effect it is simply allowed.
  // Costs one extra render on mount; the gesture is live well before a finger
  // can arrive, since the viewer fades in first.
  const [panResponder, setPanResponder] = useState<PanResponderInstance | null>(null);
  useEffect(() => {
    setPanResponder(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onPanResponderRelease: (_, gs) => {
          if (gs.dx < -40) goToRef.current(indexRef.current + 1);
          else if (gs.dx > 40) goToRef.current(indexRef.current - 1);
        },
      }),
    );
  }, []);

  const story = stories[index];
  if (!story) return null;

  const hasPhoto = !!story.image;
  const hasText  = !!(story.text || story.content);

  // Only ever your own story: starring is the author's own act, not a
  // bookmark of someone else's post.
  const canStar = currentUserId != null && story.author.id === currentUserId;
  const isStarred = starredIds.has(story.id);

  async function toggleStar() {
    if (togglingStar) return;
    setTogglingStar(true);
    try {
      if (isStarred) await unstarStories([story.id]);
      else await starStory(story);
    } catch {
      Alert.alert('Could not update', 'Please try again.');
    }
    // Reached on both paths: the `catch` alerts and stops there. Not a
    // `finally` — React Compiler bails on any component containing one.
    setTogglingStar(false);
  }

  async function sendReply() {
    const trimmed = replyText.trim();
    if (!trimmed || !replyTo || sendingReply) return;
    setSendingReply(true);
    await runBusy(async () => {
      const context = story.content ?? story.text;
      const content = encodeStoryReply({
        image: story.image,
        excerpt: context ? `${context.slice(0, 80)}${context.length > 80 ? '…' : ''}` : undefined,
        comment: trimmed,
      });
      // `story_id` is what makes the reply traceable: the message itself is an
      // opaque payload, so without it the author gets a DM with no indication
      // of which story it answers. The server checks the story is theirs.
      await api.post(`/api/friends/messages/${replyTo.id}/`, { content, story_id: story.id });
      setReplyText('');
      Keyboard.dismiss();
      setReplySent(true);
      setTimeout(() => setReplySent(false), 1600);
    }, () => setSendingReply(false)).catch((e: any) => {
      console.log('[Story reply] error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Could not send', 'Please try again.');
    });
  }

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.svContainer} {...(panResponder?.panHandlers ?? {})}>
        {/* Background — photo fills the screen; a text-only story gets a soft
            vertical wash rather than flat black, which read as a dead screen. */}
        <View style={[StyleSheet.absoluteFill, styles.svBackdrop]} />
        {hasPhoto ? (
          <Image source={{ uri: story.image! }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Scrim edge="top" height={420} opacity={0.55} />
        )}

        {/* Nav tap zones. Left third goes back, the rest goes forward — the
            old 30/30 split left a dead 40% down the middle where a tap did
            nothing at all. Everything interactive renders after these and so
            takes precedence. */}
        <Pressable
          style={styles.svNavLeft}
          onPress={() => goTo(index - 1)}
          accessibilityRole="button"
          accessibilityLabel="Previous story"
        />
        <Pressable
          style={styles.svNavRight}
          onPress={() => goTo(index + 1)}
          accessibilityRole="button"
          accessibilityLabel="Next story"
        />

        {/* Scrims carry every piece of chrome below. Heights are generous
            enough that the gradient has faded to nothing before it reaches
            the middle of the photo. */}
        {hasPhoto && <Scrim edge="top" height={top + 130} opacity={0.6} />}
        {/* Tall enough for a full 280-character story: ~7 lines at this size,
            stacked above the reactions and the reply bar. Too short and the
            first line of a long story sits on raw photo. */}
        <Scrim edge="bottom" height={bottom + (replyTo ? 360 : 310)} opacity={0.72} />

        {/* Progress bars, flush to the top edge where a story's are expected
            to be. They used to sit in a rounded translucent box of their own. */}
        <View style={[styles.svProgressRow, { top: top + 8 }]} pointerEvents="none">
          {stories.map((s, i) => (
            <ProgressBar key={s.id} active={i === index} past={i < index} progress={progress} />
          ))}
        </View>

        {/* Header: avatar + username + time + save + close */}
        <View style={[styles.svHeader, { top: top + 24 }]}>
          <Avatar uri={story.author.profile_picture} name={story.author.username} size="xs" />
          <View style={styles.svAuthorInfo}>
            <Text style={styles.svAuthorName} numberOfLines={1}>{story.author.username}</Text>
            {/* One line, not two competing timestamps stacked beside each
                other — "posted" and "expires" are the same kind of fact. */}
            <Text style={styles.svMeta} numberOfLines={1}>
              {timeAgo(story.created_at)} · {timeLeft(story.expires_at)}
            </Text>
          </View>
          {canStar && (
            <Pressable
              onPress={toggleStar}
              hitSlop={12}
              style={({ pressed }) => [
                styles.svGlassBtn,
                isStarred && styles.svGlassBtnActive,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={isStarred ? 'Unstar this story' : 'Star this story'}
              accessibilityState={{ selected: isStarred, disabled: togglingStar }}
            >
              <IconBookmark size={16} color={isStarred ? colors.teal : colors.t1} filled={isStarred} />
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.svGlassBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Close stories"
          >
            <IconClose size={17} color={colors.t1} />
          </Pressable>
        </View>

        {/* Story text. Legible now because the bottom scrim runs underneath
            it — before, this block had no background of any kind. */}
        {hasText && (
          <View style={[styles.svTextBlock, { bottom: bottom + (replyTo ? 150 : 92) }]} pointerEvents="none">
            {story.place_name ? (
              <View style={styles.svPlaceRow}>
                <IconPin size={11} color={colors.t1} />
                <Text style={styles.svPlaceName} numberOfLines={1}>{story.place_name}</Text>
              </View>
            ) : null}
            <Text style={styles.svTextLarge}>{story.content ?? story.text}</Text>
          </View>
        )}

        {/* Reply to a friend's story — the comment lands in your chat */}
        {replyTo && (
          <View style={[styles.svReplyRow, { bottom: bottom + 90 }]}>
            <TextInput
              style={styles.svReplyInput}
              value={replyText}
              onChangeText={setReplyText}
              placeholder={`Reply to ${replyTo.username}…`}
              placeholderTextColor={colors.t3}
              maxLength={500}
              onFocus={() => setReplyFocused(true)}
              onBlur={() => setReplyFocused(false)}
              onSubmitEditing={sendReply}
              returnKeyType="send"
            />
            <Pressable
              style={({ pressed }) => [
                styles.svReplySend,
                replyText.trim().length > 0 && styles.svReplySendActive,
                pressed && { opacity: 0.8 },
              ]}
              onPress={sendReply}
              disabled={replyText.trim().length === 0 || sendingReply}
            >
              {sendingReply ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <IconChevron size={16} color={replyText.trim() ? colors.bg : colors.t3} />
              )}
            </Pressable>
          </View>
        )}

        {/* Sent confirmation */}
        {replySent && replyTo && (
          <View style={[styles.svSentToast, { bottom: bottom + 150 }]} pointerEvents="none">
            <Text style={styles.svSentToastText}>Sent to @{replyTo.username}</Text>
          </View>
        )}

        {/* Reaction. A compact pill that sizes to its content, rather than a
            stretched box filling the width — that read as the heaviest thing
            on screen, competing with the story itself. */}
        <View style={[styles.svReactions, { bottom: bottom + 18 }]}>
          {REACTIONS.map(({ type, Icon }) => {
            const count = story.reactions?.[type] ?? 0;
            const isActive = story.user_reaction === type;
            return (
              <Pressable
                key={type}
                style={({ pressed }) => [
                  styles.svReactionBtn,
                  isActive && styles.svReactionBtnActive,
                  pressed && onReact && styles.svReactionBtnPressed,
                ]}
                onPress={onReact ? () => onReact(story.id, type) : undefined}
                disabled={!onReact}
                accessibilityRole="button"
                accessibilityLabel={
                  count > 0 ? `${type}, ${count} ${count === 1 ? 'reaction' : 'reactions'}` : type
                }
                accessibilityState={{ selected: isActive, disabled: !onReact }}
              >
                <Icon size={19} color={isActive ? colors.teal : colors.t1} />
                {count > 0 && (
                  <Text style={[styles.svReactionCount, isActive && styles.svReactionCountActive]}>
                    {count}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  svContainer: { flex: 1, backgroundColor: '#000' },
  // Not flat #000: a text-only story on pure black reads as a screen that
  // failed to load. This is the app's own surface colour, warmed very slightly.
  svBackdrop: { backgroundColor: '#0E0E12' },

  // Left third back, the rest forward. Anything interactive renders after
  // these and so wins the touch.
  svNavLeft:  { position: 'absolute', left: 0, top: 0, bottom: 0, width: '33%' },
  svNavRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '67%' },

  // ── Progress ──
  svProgressRow: {
    position: 'absolute',
    left: 10,
    right: 10,
    flexDirection: 'row',
    gap: 3,
  },
  svTrack: {
    flex: 1,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  svFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },

  // ── Header ──
  svHeader: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  svAuthorInfo: { flex: 1, marginLeft: 2 },
  svAuthorName: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.small,
    color: '#FFFFFF',
  },
  svMeta: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 1,
  },
  /** Circular glass button. Kept subtly filled even on the scrim: these sit
   *  over arbitrary photos, and an unfilled icon disappears on a busy one. */
  svGlassBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svGlassBtnActive: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },

  // ── Story text ──
  svTextBlock: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 20 },
  svTextLarge: {
    fontFamily: fonts.body,
    fontSize: 19,
    fontWeight: '500',
    color: '#FFFFFF',
    lineHeight: 27,
  },
  svPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7 },
  svPlaceName: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.85)',
  },

  // ── Reply ──
  svReplyRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  svReplyInput: {
    flex: 1,
    height: 42,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 14,
    color: '#FFFFFF',
  },
  svReplySend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  svReplySendActive: { backgroundColor: colors.teal, borderColor: colors.teal },

  svSentToast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  svSentToastText: {
    fontFamily: fonts.body,
    fontSize: type.small,
    fontWeight: '500',
    color: colors.t1,
  },

  // ── Reactions ──
  // No container panel — the bottom scrim is the background. The row centres
  // so four pills of differing widths (counts appear and disappear) stay
  // balanced instead of drifting left.
  svReactions: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  svReactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // 44pt tall including padding: these are the primary controls on the
    // screen and were previously the only ones near the touch-target floor.
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.l,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  svReactionBtnActive: { backgroundColor: colors.tealTint, borderColor: colors.tealLine },
  svReactionBtnPressed: { opacity: 0.6 },
  svReactionCount: {
    fontFamily: fonts.body,
    color: '#FFFFFF',
    fontSize: type.small,
    fontWeight: '600',
  },
  svReactionCountActive: { color: colors.teal },
});
