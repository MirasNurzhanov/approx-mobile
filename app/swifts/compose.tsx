import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { IconBack } from '@/components/ui/icons';
import { colors, fonts, radius } from '@/constants/theme';

// SwiftComposer — placeholder. Deliberately inert: there is no upload pipeline
// yet, and a capture button that records into nowhere is worse than one that
// says so.
//
// TODO(swifts): to make this real, in order —
//   1. Record/pick: expo-image-picker already ships and supports videos, so
//      mediaTypes: ['videos'] is the capture step; the camera permission primer
//      in components/PermissionPrimer.tsx covers the prompt.
//   2. Trim + cover frame selection.
//   3. Upload: multipart POST to the Swifts endpoint, with progress, plus a
//      transcode/CDN target for videoUrl and thumbnailUrl.
//   4. On success, prepend the new Swift to the feed cache in services/swifts.ts.
export default function SwiftComposerScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>New Swift</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <View style={styles.iconTile}>
          <Ionicons name="videocam-outline" size={28} color={colors.t3} />
        </View>
        <Text style={styles.title}>Composer coming soon</Text>
        <Text style={styles.body2}>
          Recording, trimming and upload aren&apos;t wired up yet. The feed itself is
          live — this is where creating one will start.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 2 },
  headerSpacer: { width: 22 },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 20,
    color: colors.t1,
  },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 18,
    color: colors.t1,
  },
  body2: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.t3,
    textAlign: 'center',
  },
});
