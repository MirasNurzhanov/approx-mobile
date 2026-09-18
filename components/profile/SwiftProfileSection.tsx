import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChart, IconChevron, IconPlay, IconSwift } from '@/components/ui/icons';
import { SwiftPlusIcon } from '@/components/swifts/icons';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { creatorSwiftLabel } from '@/services/swiftCreator';
import type { Swift } from '@/services/swifts';
import { useCreatorSwifts } from './useCreatorSwifts';

/**
 * The owner's three doors: what their uploads did, a new one, and the private
 * shortlist.
 *
 * Saved is a link rather than a tab in the gallery below, and that is the whole
 * point of it being here. A shortlist is other people's videos; showing it
 * inside the profile's own gallery meant that watching the feed and saving
 * something put another creator's video on your profile page. The page is one
 * person's uploads, so the shortlist gets its own screen.
 */
export function SwiftCreatorActions() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return <View style={styles.actions}>
    <Pressable style={styles.action} onPress={() => router.push('/swifts/analytics')} accessibilityRole="button" accessibilityLabel="Swift analytics">
      <IconChart size={18} color={colors.teal} /><Text style={styles.actionText}>Analytics</Text>
    </Pressable>
    <Pressable style={styles.action} onPress={() => router.push('/swifts/compose')} accessibilityRole="button" accessibilityLabel="Upload a Swift">
      <SwiftPlusIcon size={18} color={colors.teal} /><Text style={styles.actionText}>Upload</Text>
    </Pressable>
    <Pressable testID="swift-saved-link" style={styles.action} onPress={() => router.push('/swifts/saved')} accessibilityRole="button" accessibilityLabel="Saved Swifts, only you can see these">
      <IconSwift size={18} color={colors.teal} /><Text style={styles.actionText}>Saved</Text>
    </Pressable>
  </View>;
}

export function SwiftProfileTile({ swift }: { swift: Swift }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const label = creatorSwiftLabel(swift);
  return <Pressable
    testID={`creator-swift-${swift.id}`}
    style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}
    onPress={() => router.push({ pathname: '/swifts/[id]', params: { id: swift.id } })}
    accessibilityRole="button"
    accessibilityLabel={`${swift.caption || 'Swift video'}, ${swift.view_count} views${label ? ', ' + label : ''}`}
  >
    {swift.thumbnail_url ? <Image source={{ uri: swift.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      : <View style={styles.placeholder}><IconSwift size={30} color={colors.t3} /></View>}
    {!!label && <View style={styles.status}><Text numberOfLines={2} style={styles.statusText}>{label}</Text></View>}
    <View style={styles.tileBottom}>
      <View style={styles.views}><IconPlay size={13} color="#fff" /><Text style={styles.viewsText}>{swift.view_count.toLocaleString()}</Text></View>
      {!!swift.caption && <Text numberOfLines={2} style={styles.caption}>{swift.caption}</Text>}
    </View>
  </Pressable>;
}

interface SwiftProfileProps {
  creatorId: number; canView: boolean; isOwner?: boolean; ghostMode?: boolean; refreshKey?: number;
}

/** Standalone gallery for callers that do not need its data elsewhere. */
export function SwiftProfileSection(props: SwiftProfileProps) {
  const mine = useCreatorSwifts(props.creatorId, props.canView, 6, props.refreshKey);
  return <SwiftProfileSectionView {...props} mine={mine} />;
}

/** The owner profile shares one query between this gallery and its avatar ring. */
export function SwiftProfileSectionView({ creatorId, canView, isOwner = false, ghostMode = false, mine }: SwiftProfileProps & {
  mine: ReturnType<typeof useCreatorSwifts>;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  // One list, one author: whoever's profile this is. The saved shortlist used
  // to sit here behind a tab, which put videos this person never made on their
  // own profile page — see `SwiftCreatorActions`, which links to it instead.
  const { items, count, loading, error, refresh } = mine;

  if (!canView || (mine.unavailable && !isOwner)) return null;
  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.titleRow}><IconSwift size={21} color={colors.teal} /><Text style={styles.title}>{isOwner ? 'My Swifts' : 'Swifts'}</Text></View>
      <Pressable
        style={styles.seeAll}
        onPress={() => router.push({ pathname: '/swifts/user/[id]', params: { id: creatorId } })}
        accessibilityRole="button"
      >
        <Text style={styles.link}>See all{count > 0 ? ' (' + count + ')' : ''}</Text><IconChevron size={14} color={colors.teal} />
      </Pressable>
    </View>
    {isOwner && <SwiftCreatorActions />}
    {isOwner && ghostMode && <Text style={styles.body}>Your Swifts are hidden from others while Ghost Mode is on.</Text>}
    {loading ? <ActivityIndicator color={colors.teal} style={styles.message} /> : error ? <View style={styles.message}>
      <Text style={styles.body}>{error}</Text><Pressable onPress={() => { void refresh(); }} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>
    </View> : items.length === 0 ? <View style={styles.message}>
      <IconSwift size={30} color={colors.t3} />
      <Text style={styles.emptyTitle}>{isOwner ? 'Your first Swift starts here' : 'No Swifts yet'}</Text>
      <Text style={styles.body}>{isOwner ? 'Your uploads appear here, including videos still being reviewed.' : 'Shared videos will appear here.'}</Text>
    </View> : <View style={styles.grid}>{items.map((swift) => <SwiftProfileTile key={swift.id} swift={swift} />)}</View>}
  </View>;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  section: { marginBottom: 28 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 20, fontWeight: '600', color: colors.t1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 3 },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  action: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.tealLine, backgroundColor: colors.tealTint },
  actionText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tile: { width: '32%', aspectRatio: 0.65, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2, marginBottom: 5 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  status: { position: 'absolute', top: 6, left: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 5 },
  statusText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '600', color: '#fff' },
  tileBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 7, gap: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  views: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewsText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: '#fff' },
  caption: { fontFamily: fonts.body, fontSize: 10, color: '#fff' },
  message: { paddingVertical: 24, alignItems: 'center', gap: 9 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: '600', color: colors.t1 },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, textAlign: 'center', color: colors.t2 },
});
