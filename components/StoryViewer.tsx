import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import {
  IconBookmark,
  IconChevron,
  IconClose,
  IconFunny,
  IconInsight,
  IconLike,
  IconPin,
  IconStar,
  type IconComponent,
} from '@/components/ui/icons';
import { colors, fonts, radius } from '@/constants/theme';
import { api } from '@/services/api';
import {
  saveStory,
  unsaveStories,
  useStoryArchive,
  type ReactionType,
  type Story,
} from '@/services/stories';
import { encodeStoryReply } from '@/services/storyReply';

// Full-screen Instagram-style story viewer, shared by the map and the
// saved-stories archive.

export const STORY_DURATION_MS = 7_000;

export const REACTIONS: { type: ReactionType; Icon: IconComponent }[] = [
  { type: 'like',        Icon: IconLike },
  { type: 'funny',       Icon: IconFunny },
  { type: 'helpful',     Icon: IconInsight },
  { type: 'interesting', Icon: IconStar },
];

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function timeLeft(expiresAt: string): string {
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
  const style = useAnimatedStyle(() => {
    const pct = active ? progress.value : past ? 1 : 0;
    return { width: `${pct * 100}%` };
  });
  return (
    <View style={styles.svTrack}>
      <Animated.View style={[styles.svFill, style]} />
    </View>
  );
}

export interface StoryViewerProps {
  stories: Story[];
  onClose: () => void;
  /** Omit to show reaction counts read-only (e.g. in the archive, where the
   * within-500m rule would reject a new reaction anyway). */
  onReact?: (storyId: number, reaction: ReactionType) => void;
  /** When set (author is a friend), shows the reply bar that DMs the comment. */
  replyTo?: { id: number; username: string } | null;
  /** Enables the bookmark toggle on stories not authored by this user. */
  currentUserId?: number | null;
}

export function StoryViewer({ stories, onClose, onReact, replyTo, currentUserId }: StoryViewerProps) {
  const { top, bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const progress = useSharedValue(0);
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [togglingSave, setTogglingSave] = useState(false);
  const { savedIds } = useStoryArchive();

  function goTo(i: number) {
    if (i >= stories.length) { onClose(); return; }
    if (i < 0) return;
    indexRef.current = i;
    setIndex(i);
  }

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Auto-advance, paused while the reply input is focused.
  useEffect(() => {
    if (replyFocused) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: STORY_DURATION_MS });
    const timer = setTimeout(() => goToRef.current(indexRef.current + 1), STORY_DURATION_MS);
    return () => {
      cancelAnimation(progress);
      clearTimeout(timer);
    };
  }, [index, replyFocused]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -40) goToRef.current(indexRef.current + 1);
        else if (gs.dx > 40) goToRef.current(indexRef.current - 1);
      },
    })
  ).current;

  const story = stories[index];
  if (!story) return null;

  const hasPhoto = !!story.image;
  const hasText  = !!(story.text || story.content);

  const canSave = currentUserId != null && story.author.id !== currentUserId;
  const isSaved = savedIds.has(story.id);

  async function toggleSave() {
    if (togglingSave) return;
    setTogglingSave(true);
    try {
      if (isSaved) await unsaveStories([story.id]);
      else await saveStory(story);
    } catch {
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setTogglingSave(false);
    }
  }

  async function sendReply() {
    const trimmed = replyText.trim();
    if (!trimmed || !replyTo || sendingReply) return;
    setSendingReply(true);
    try {
      const context = story.content ?? story.text;
      const content = encodeStoryReply({
        image: story.image,
        excerpt: context ? `${context.slice(0, 80)}${context.length > 80 ? '…' : ''}` : undefined,
        comment: trimmed,
      });
      await api.post(`/api/friends/messages/${replyTo.id}/`, { content });
      setReplyText('');
      Keyboard.dismiss();
      setReplySent(true);
      setTimeout(() => setReplySent(false), 1600);
    } catch (e: any) {
      console.log('[Story reply] error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Could not send', 'Please try again.');
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.svContainer} {...panResponder.panHandlers}>
        {/* Background — photo fills entire screen or solid dark for text-only */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        {hasPhoto && (
          <Image source={{ uri: story.image! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}

        {/* Nav tap zones — cover full screen, interactive elements rendered after override them */}
        <TouchableOpacity style={styles.svNavLeft}  activeOpacity={1} onPress={() => goTo(index - 1)} />
        <TouchableOpacity style={styles.svNavRight} activeOpacity={1} onPress={() => goTo(index + 1)} />

        {/* Progress bars */}
        <View style={[styles.svProgressRow, { top: top + 8 }]} pointerEvents="none">
          {stories.map((_, i) => (
            <ProgressBar key={i} active={i === index} past={i < index} progress={progress} />
          ))}
        </View>

        {/* Header: avatar + username + time + save + close */}
        <View style={[styles.svHeader, { top: top + 22 }]}>
          <Avatar uri={story.author.profile_picture} name={story.author.username} size="xs" />
          <View style={styles.svAuthorInfo}>
            <Text style={styles.svAuthorName}>{story.author.username}</Text>
            <Text style={styles.svTimeAgo}>{timeAgo(story.created_at)}</Text>
          </View>
          <Text style={styles.svTimeLeft}>{timeLeft(story.expires_at)}</Text>
          {canSave && (
            <TouchableOpacity onPress={toggleSave} hitSlop={12} style={styles.svSaveBtn}>
              <IconBookmark size={17} color={isSaved ? colors.teal : colors.t1} filled={isSaved} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.svCloseBtn}>
            <IconClose size={18} color={colors.t1} />
          </TouchableOpacity>
        </View>

        {/* Story text above reactions */}
        {hasText && (
          <View style={[styles.svTextBlock, { bottom: bottom + (replyTo ? 152 : 96) }]} pointerEvents="none">
            {story.place_name ? (
              <View style={styles.svPlaceRow}>
                <IconPin size={12} color={colors.t2} />
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
            <TouchableOpacity
              style={[styles.svReplySend, replyText.trim().length > 0 && styles.svReplySendActive]}
              onPress={sendReply}
              disabled={replyText.trim().length === 0 || sendingReply}
              activeOpacity={0.8}
            >
              {sendingReply ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <IconChevron size={16} color={replyText.trim() ? colors.bg : colors.t3} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Sent confirmation */}
        {replySent && replyTo && (
          <View style={[styles.svSentToast, { bottom: bottom + 150 }]} pointerEvents="none">
            <Text style={styles.svSentToastText}>Sent to @{replyTo.username}</Text>
          </View>
        )}

        {/* Reactions — read-only counts when reacting isn't available here */}
        <View style={[styles.svReactions, { bottom: bottom + 20 }]}>
          {REACTIONS.map(({ type, Icon }) => {
            const count = story.reactions?.[type] ?? 0;
            const isActive = story.user_reaction === type;
            return (
              <Pressable
                key={type}
                style={[styles.svReactionBtn, isActive && styles.svReactionBtnActive]}
                onPress={onReact ? () => onReact(story.id, type) : undefined}
                disabled={!onReact}
              >
                <Icon size={20} color={isActive ? colors.teal : colors.t2} />
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
const styles = StyleSheet.create({
  svContainer: { flex: 1, backgroundColor: '#000' },
  svNavLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '30%',
  },
  svNavRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '30%',
  },
  svProgressRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  svTrack: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  svFill: {
    height: '100%',
    backgroundColor: colors.t1,
    borderRadius: 1,
  },
  svHeader: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  svAuthorInfo: { flex: 1, marginLeft: 8 },
  svAuthorName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 13,
    color: colors.t1,
  },
  svTimeAgo: { fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  svTimeLeft: { fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginRight: 10 },
  svSaveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  svCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  svTextLarge: {
    fontFamily: fonts.body,
    fontSize: 18,
    fontWeight: '500',
    color: colors.t1,
    lineHeight: 26,
  },
  svPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  svPlaceName: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  svReplyRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: 'rgba(10,10,11,0.82)',
  },
  svReplyInput: {
    flex: 1,
    height: 40,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
  },
  svReplySend: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  svReplySendActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
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
    fontSize: 13,
    fontWeight: '500',
    color: colors.t1,
  },
  svReactions: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
  },
  svReactionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  svReactionBtnActive: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  svReactionCount: { fontFamily: fonts.body, color: colors.t3, fontSize: 13, fontWeight: '500' },
  svReactionCountActive: { color: colors.teal },
});
