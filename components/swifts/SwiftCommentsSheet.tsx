import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftCommentIcon } from '@/components/swifts/icons';
import { Avatar } from '@/components/ui/Avatar';
import { useContentActions } from '@/components/ContentActions';
import { IconClose, IconMore, IconTrash } from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  deleteSwiftComment,
  fetchSwiftComments,
  formatCount,
  postSwiftComment,
  type SwiftComment,
} from '@/services/swifts';

/**
 * Comments on one Swift.
 *
 * ## Mounting
 *
 * The body mounts only while the sheet is open, keyed on the Swift's id, so
 * opening comments on a second Swift starts from an empty list rather than
 * from the previous one's — the same arrangement `LocationPickerSheet` uses,
 * and for the same reason: state that is *initialised* correctly never needs
 * to be reset.
 *
 * ## Counts
 *
 * The count shown here is the server's, and every mutation reports the delta
 * up so the rail agrees with it. Posting bumps by one and rolls back on
 * failure; deleting does the reverse. Nothing recounts the list length —
 * that would be wrong the moment pagination is involved, since the list holds
 * one page and the count is the whole thread.
 *
 * ## Keyboard
 *
 * `KeyboardAvoidingView` with `padding` on iOS and `height` on Android, which
 * is the split that actually works: Android resizes the window itself when
 * `adjustResize` is set, so `padding` there double-counts and leaves a gap the
 * size of the keyboard.
 */

interface Props {
  visible: boolean;
  swiftId: number | null;
  /** Turned off by the creator; the composer is hidden and the list read-only. */
  allowComments: boolean;
  onClose: () => void;
  /** +1 when a comment lands, -1 when one is removed. Keeps the rail honest. */
  onCountChange: (swiftId: number, delta: number) => void;
}

export function SwiftCommentsSheet({
  visible, swiftId, allowComments, onClose, onCountChange,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {visible && swiftId !== null ? (
        <CommentsBody
          key={swiftId}
          swiftId={swiftId}
          allowComments={allowComments}
          onClose={onClose}
          onCountChange={onCountChange}
        />
      ) : null}
    </Modal>
  );
}

type LoadState = 'loading' | 'ready' | 'error';

function CommentsBody({
  swiftId, allowComments, onClose, onCountChange,
}: Omit<Props, 'visible'> & { swiftId: number }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [comments, setComments] = useState<SwiftComment[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>('loading');
  const [paging, setPaging] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { present, sheets } = useContentActions();
  const inputRef = useRef<TextInput | null>(null);

  // Deliberately does not set 'loading' itself: the state already starts there,
  // so doing it here would be a synchronous setState on the mount path for a
  // value that is already correct. `retry` sets it, because that is the one
  // caller arriving from a settled state.
  const load = useCallback(() => {
    fetchSwiftComments(swiftId, 0)
      .then((page) => {
        setComments(page.results);
        setTotal(page.count);
        setExhausted(page.results.length >= page.count);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [swiftId]);

  useEffect(load, [load]);

  function loadMore() {
    if (paging || exhausted || state !== 'ready') return;
    setPaging(true);
    fetchSwiftComments(swiftId, comments.length)
      .then((page) => {
        setComments((prev) => {
          const next = [...prev, ...page.results];
          if (next.length >= page.count) setExhausted(true);
          return next;
        });
        setTotal(page.count);
      })
      .catch(() => setExhausted(true))
      .finally(() => setPaging(false));
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    // Cleared straight away: leaving the text in place while the request flies
    // invites a second press, and a duplicate comment is not recoverable the
    // way a duplicate like is.
    setDraft('');
    try {
      const comment = await postSwiftComment(swiftId, text);
      setComments((prev) => [comment, ...prev]);
      setTotal((n) => n + 1);
      onCountChange(swiftId, 1);
    } catch {
      // Hand the words back rather than losing them.
      setDraft(text);
      Alert.alert('Couldn’t post that', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  function reportComment(comment: SwiftComment) {
    present({
      target: 'comment',
      targetId: comment.id,
      subject: `this comment by @${comment.author.username}`,
      authorId: comment.author.id,
      authorUsername: comment.author.username,
      authorAvatar: comment.author.profile_picture ?? undefined,
      // Blocking from here drops every comment that author has on this thread,
      // not just the one that was reported. The server will do the same on the
      // next fetch; this is what makes the thread agree with it now.
      onRemoved: () => setComments((prev) => prev.filter(
        (c) => c.author.id !== comment.author.id,
      )),
    });
  }

  function confirmDelete(comment: SwiftComment) {
    Alert.alert('Delete this comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // Optimistic, with the row kept so it can go back if the write fails.
          const index = comments.findIndex((c) => c.id === comment.id);
          setComments((prev) => prev.filter((c) => c.id !== comment.id));
          setTotal((n) => Math.max(0, n - 1));
          onCountChange(swiftId, -1);
          try {
            await deleteSwiftComment(comment.id);
          } catch {
            setComments((prev) => {
              const next = [...prev];
              next.splice(Math.max(0, index), 0, comment);
              return next;
            });
            setTotal((n) => n + 1);
            onCountChange(swiftId, 1);
            Alert.alert('Couldn’t delete that', 'Try again in a moment.');
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      // See the component note: `padding` double-counts on Android, which
      // resizes the window itself.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {sheets}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {total > 0 ? `${formatCount(total)} comments` : 'Comments'}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close comments"
        >
          <IconClose size={20} color={colors.t2} />
        </Pressable>
      </View>

      {state === 'loading' ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : state === 'error' ? (
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>Couldn’t load comments</Text>
          <Pressable
            onPress={() => { setState('loading'); load(); }}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : comments.length === 0 ? (
        <View style={styles.centre}>
          <SwiftCommentIcon size={30} color={colors.t3} />
          <Text style={styles.emptyTitle}>No comments yet</Text>
          {allowComments ? (
            <Text style={styles.emptyBody}>Be the first to say something.</Text>
          ) : (
            <Text style={styles.emptyBody}>Comments are turned off.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={1.5}
          // The thread is text, so a generous window costs little and keeps
          // scrolling smooth on a low-end device.
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews={false}
          ListFooterComponent={
            paging ? <ActivityIndicator style={styles.footerSpinner} color={colors.t3} /> : null
          }
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              onDelete={confirmDelete}
              onReport={reportComment}
              styles={styles}
              colors={colors}
            />
          )}
        />
      )}

      {allowComments && (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment"
            placeholderTextColor={colors.t3}
            multiline
            maxLength={500}
            accessibilityLabel="Add a comment"
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            hitSlop={10}
            style={[styles.send, (!draft.trim() || sending) && styles.sendOff]}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
          >
            {sending
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.sendLabel}>Post</Text>}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function CommentRow({
  comment, onDelete, onReport, styles, colors,
}: {
  comment: SwiftComment;
  onDelete: (c: SwiftComment) => void;
  onReport: (c: SwiftComment) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  return (
    <View style={styles.row}>
      <Avatar
        uri={comment.author.profile_picture ?? undefined}
        name={comment.author.username}
        size="sm"
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowAuthor} numberOfLines={1}>
          @{comment.author.username}
        </Text>
        <Text style={styles.rowText}>{comment.text}</Text>
      </View>
      {comment.is_mine ? (
        <Pressable
          onPress={() => onDelete(comment)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Delete your comment: ${comment.text.slice(0, 40)}`}
        >
          <IconTrash size={16} color={colors.t3} />
        </Pressable>
      ) : (
        // Somebody else's comment: the same Report / Block menu the rest of
        // the app uses. Your own gets Delete instead — reporting yourself is
        // not a thing, and the row has one slot.
        <Pressable
          onPress={() => onReport(comment)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Report the comment by ${comment.author.username}`}
        >
          <IconMore size={16} color={colors.t3} />
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  emptyBody: { fontFamily: fonts.body, fontSize: typography.small, color: colors.t3 },
  retry: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },

  list: { padding: 18, gap: 16 },
  footerSpinner: { marginVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowBody: { flex: 1, gap: 2 },
  rowAuthor: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.t2,
  },
  rowText: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 20,
    color: colors.t1,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },
  send: {
    height: 42,
    minWidth: 60,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  sendOff: { opacity: 0.4 },
  sendLabel: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },
});
