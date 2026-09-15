// The story composer opened from the map. Moved out of app/(tabs)/map.tsx
// unchanged.

import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSheetDrag } from '@/components/ui/useSheetDrag';
import {
    IconCamera,
    IconClose,
    IconEyeOff,
    IconImage,
} from '@/components/ui/icons';
import { useTheme } from '@/context/ThemeContext';
import { runBusy } from '@/services/busy';
import { usePermissionPrimer } from '@/components/PermissionPrimer';

import { makeStyles } from '@/components/map/mapStyles';

/** Travel for the story composer, which is its own `Modal` rather than one of
 *  the two sheets `SHEET_H` describes — see `CreateStoryModal`. Taller,
 *  because it holds a photo well and a keyboard-avoiding text field. */
const STORY_SHEET_H = 620;

// ─── Create Story Modal ───────────────────────────────────────────────────────
interface CreateStoryModalProps {
  visible: boolean;
  /** True while location sharing is paused — the story posts, without a pin. */
  locationless?: boolean;
  onClose: () => void;
  onPost: (text: string, photoUri: string | null) => Promise<void>;
}

export function CreateStoryModal({ visible, locationless, onClose, onPost }: CreateStoryModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  // This sheet is a `Modal` rather than one of the map's two `sheetY` sheets,
  // so it carries its own offset. Reset whenever it opens: a drag that was
  // released short of the dismiss threshold leaves the value part-way down,
  // and without this the next open would start there.
  const storyY = useSharedValue(0);
  useEffect(() => {
    if (visible) storyY.set(0);
  }, [visible, storyY]);
  const storyAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: storyY.get() }],
  }));
  const drag = useSheetDrag({
    sheetY: storyY,
    height: STORY_SHEET_H,
    onDismiss: onClose,
    // Not draggable mid-post: the request is already in flight and closing the
    // sheet under it would leave the spinner's owner unmounted.
    enabled: !posting,
  });

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function takePhoto() {
    // Primed, and offers a route into Settings when previously refused —
    // the old alert was a dead end.
    if (!(await ensurePermission('camera'))) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  // A photo on its own is a story; so is a line of text. Only nothing at all
  // is not one. The caption used to be required, which made the commonest
  // story of all — a picture, posted without commentary — impossible.
  const canPost = !!photoUri || text.trim().length > 0;

  async function handlePost() {
    if (!canPost) {
      Alert.alert('Nothing to post', 'Add a photo or write something first.');
      return;
    }
    setPosting(true);
    await runBusy(async () => {
      await onPost(text.trim(), photoUri);
      setText('');
      setPhotoUri(null);
      onClose();
    }, () => setPosting(false))
      // Nothing here about location any more. Posting used to be refused while
      // sharing was paused and this is where that refusal was explained; the
      // story now posts either way, without a pin, and the line above the
      // Post button says so before it happens rather than after.
      //
      // What *is* still explained here is a refusal by the content filter. A
      // story rejected under the Community Guidelines has to say so — "Failed
      // to post, please try again" would send somebody round the loop retrying
      // a post that will never be accepted.
      .catch((e: any) => {
        if (e?.response?.data?.code === 'objectionable_content') {
          Alert.alert('This can’t be posted', e.response.data.detail);
          return;
        }
        Alert.alert('Failed to post', 'Please try again.');
      });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} accessibilityViewIsModal>
        <Pressable style={styles.createModalBackdrop} onPress={onClose} />
        <Animated.View
          style={[styles.createModalSheet, { paddingBottom: bottom + 20 }, storyAnimStyle]}
        >
          <GestureDetector gesture={drag}>
            <View style={styles.sheetGrab}>
              <View style={styles.sheetHandle} />
            </View>
          </GestureDetector>
          <View style={styles.createModalHeader}>
            <View style={styles.createModalTitleWrap}>
              <Text style={styles.createModalTitle}>Drop a Story</Text>
              {/* Both facts a poster wants before typing, and neither was on
                  screen before: who sees it, and for how long. 24 hours is
                  `stories.models.Story.save`, not a guess. */}
              <Text style={styles.createModalSubtitle}>Friends only · gone in 24 hours</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.createModalClose, pressed && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={16} color={colors.t2} />
            </Pressable>
          </View>
          {primer}

          {/* The picture leads, the way it does in the story it becomes. The
              two sources used to be unlabelled icon squares below the caption,
              after the thing they filled in. */}
          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
              <Pressable
                style={({ pressed }) => [styles.removePhotoBtn, pressed && { opacity: 0.5 }]}
                onPress={() => setPhotoUri(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <IconClose size={14} color={colors.t1} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.mediaRow}>
              <Pressable
                style={({ pressed }) => [styles.mediaCard, pressed && styles.mediaCardPressed]}
                onPress={takePhoto}
                accessibilityRole="button"
                accessibilityLabel="Take a photo"
              >
                <IconCamera size={20} color={colors.teal} />
                <Text style={styles.mediaCardLabel}>Camera</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.mediaCard, pressed && styles.mediaCardPressed]}
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel="Choose a photo from your library"
              >
                <IconImage size={20} color={colors.teal} />
                <Text style={styles.mediaCardLabel}>Library</Text>
              </Pressable>
            </View>
          )}

          {/* Counter inside the field rather than floating under it, so the
              caption reads as one object instead of a box with a stray number
              beneath it. */}
          <View style={styles.captionWrap}>
            <TextInput
              style={styles.storyInput}
              placeholder={photoUri ? 'Add a caption (optional)' : "What's happening here?"}
              // Was a hardcoded '#444', which is nearly body-text dark on the
              // light theme's surface — the placeholder read as typed text.
              placeholderTextColor={colors.t3}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 280))}
              multiline
              maxLength={280}
              autoFocus
            />
            <Text style={[styles.charCount, text.length > 240 && styles.charCountNear]}>
              {text.length}/280
            </Text>
          </View>

          {locationless ? (
            // Stated once, quietly, and only when it applies. Not a warning:
            // nothing is going wrong, and the story is about to reach exactly
            // the people it was always going to reach.
            <View style={styles.storyNoteRow}>
              <IconEyeOff size={13} color={colors.t2} />
              <Text style={styles.storyNote}>
                Location sharing is off — friends will see this story, the map won&apos;t.
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.postBtn,
              (!canPost || posting) && styles.postBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handlePost}
            disabled={!canPost || posting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPost || posting }}
          >
            {posting ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={styles.postBtnText}>Post Story</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
