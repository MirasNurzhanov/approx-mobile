import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoryViewer } from '@/components/StoryViewer';
import { Avatar } from '@/components/ui/Avatar';
import { IconBack, IconCheck, IconPin, IconTrash } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import {
  clearArchive,
  deleteOwnStories,
  hydrateArchive,
  loadMoreMine,
  loadMoreSaved,
  refreshMine,
  refreshSaved,
  unsaveStories,
  useStoryArchive,
  type FeedStory,
} from '@/services/stories';

// The story archive behind Profile → "My stories". "Mine" is every story the
// user has posted (kept past the 24h map expiry); "Saved" is bookmarks of
// other people's stories. Content comes from the store, which serves the
// on-device cache instantly and refreshes from the backend.

type Tab = 'mine' | 'saved';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Story card ───────────────────────────────────────────────────────────────
function StoryCard({ story, showAuthor, selectMode, selected, onPress, onLongPress }: {
  story: FeedStory;
  showAuthor: boolean;
  selectMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const caption = story.content ?? story.text;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {story.image ? (
        <Image source={{ uri: story.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.cardTextOnly}>
          <Text style={styles.cardTextContent} numberOfLines={6}>{caption}</Text>
        </View>
      )}

      {showAuthor && (
        <View style={styles.cardAuthor}>
          <Avatar uri={story.author.profile_picture} name={story.author.username} size="xs" />
          <Text style={styles.cardAuthorName} numberOfLines={1}>{story.author.username}</Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        {story.image && caption ? (
          <Text style={styles.cardCaption} numberOfLines={1}>{caption}</Text>
        ) : null}
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>{fmtDate(story.created_at)}</Text>
          {story.place_name ? (
            <View style={styles.cardPlaceRow}>
              <IconPin size={10} color={colors.t3} />
              <Text style={styles.cardMeta} numberOfLines={1}>{story.place_name}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {selectMode && (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <IconCheck size={13} color={colors.bg} />}
        </View>
      )}
    </Pressable>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ title, message }: { title: string; message: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
/** Back/Select in the normal state, Cancel/Select-all once you are picking. */
function ArchiveHeader({ selectMode, selectedCount, canSelect, allSelected, onBack, onEnterSelect, onExitSelect, onToggleSelectAll }: {
  selectMode: boolean;
  selectedCount: number;
  canSelect: boolean;
  allSelected: boolean;
  onBack: () => void;
  onEnterSelect: () => void;
  onExitSelect: () => void;
  onToggleSelectAll: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.header}>
      {selectMode ? (
        <Pressable onPress={onExitSelect} hitSlop={12}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [pressed && styles.pressed]}
          onPress={onBack}
          hitSlop={12}
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
      )}
      <Text style={styles.title}>
        {selectMode ? `${selectedCount} selected` : 'My stories'}
      </Text>
      {selectMode ? (
        <Pressable onPress={onToggleSelectAll} hitSlop={12} disabled={!canSelect}>
          <Text style={[styles.headerAction, !canSelect && styles.headerActionDisabled]}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </Text>
        </Pressable>
      ) : (
        <Pressable onPress={onEnterSelect} hitSlop={12} disabled={!canSelect}>
          <Text style={[styles.headerAction, !canSelect && styles.headerActionDisabled]}>
            Select
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────
/** Underline style, matching Messages. */
function ArchiveTabs({ tabs, activeTab, onSelect }: {
  tabs: { key: Tab; label: string; count: number | null }[];
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => onSelect(tab.key)}
          >
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            {tab.count !== null && tab.count > 0 && (
              <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                  {tab.count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Select-mode action bar ───────────────────────────────────────────────────
function SelectionBar({ activeTab, selectedCount, deleting, canClear, bottom, onClearAll, onDeleteSelected }: {
  activeTab: Tab;
  selectedCount: number;
  deleting: boolean;
  canClear: boolean;
  bottom: number;
  onClearAll: () => void;
  onDeleteSelected: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.actionBar, { paddingBottom: bottom + 14 }]}>
      <Pressable
        style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
        onPress={onClearAll}
        disabled={deleting || !canClear}
      >
        <Text style={styles.clearBtnText}>Clear all</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.deleteBtn,
          (selectedCount === 0 || deleting) && styles.deleteBtnDisabled,
          pressed && styles.pressed,
        ]}
        onPress={onDeleteSelected}
        disabled={selectedCount === 0 || deleting}
      >
        {deleting ? (
          <ActivityIndicator color={colors.t1} size="small" />
        ) : (
          <>
            <IconTrash size={16} color={selectedCount === 0 ? colors.t3 : colors.t1} />
            <Text style={[styles.deleteBtnText, selectedCount === 0 && styles.deleteBtnTextDisabled]}>
              {activeTab === 'mine' ? 'Delete' : 'Remove'}
              {selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SavedStoriesScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const archive = useStoryArchive();

  const [activeTab, setActiveTab] = useState<Tab>('mine');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewerStory, setViewerStory] = useState<FeedStory | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    // Cache first for instant/offline open, then the backend as source of truth.
    hydrateArchive();
    Promise.allSettled([refreshMine(), refreshSaved()]);
    api.get<{ id: number }>('/api/users/profile/')
      .then((r) => setCurrentUserId(Number(r.data.id)))
      .catch(() => {});
  }, []);

  const list = activeTab === 'mine' ? archive.mine : archive.saved;
  const total = activeTab === 'mine' ? archive.mineTotal : archive.savedTotal;
  const loaded = list ?? [];

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setSelectMode(false);
    setSelected(new Set());
  }

  function enterSelectMode() {
    setSelectMode(true);
    setSelected(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = loaded.length > 0 && selected.size === loaded.length;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(loaded.map((s) => s.id)));
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await (activeTab === 'mine' ? refreshMine() : refreshSaved());
    } catch {
      // Offline or server error — the cached list stays on screen.
    }
    // The `catch` swallows everything, so this always runs. Deliberately not a
    // `finally` — React Compiler bails on any component containing one.
    setRefreshing(false);
  }

  async function onEndReached() {
    if (loadingMore || !list || total === null || list.length >= total) return;
    setLoadingMore(true);
    try {
      await (activeTab === 'mine' ? loadMoreMine() : loadMoreSaved());
    } catch {}
    // The `catch` swallows everything, so this always runs.
    setLoadingMore(false);
  }

  async function runDelete(ids: number[]) {
    setDeleting(true);
    await runBusy(async () => {
      // Optimistic in the store: items vanish now, roll back if the API fails.
      if (activeTab === 'mine') await deleteOwnStories(ids);
      else await unsaveStories(ids);
      exitSelectMode();
    }, () => setDeleting(false)).catch(() =>
      Alert.alert(
        activeTab === 'mine' ? 'Could not delete' : 'Could not remove',
        'Something went wrong and nothing was removed. Please try again.',
      ),
    );
  }

  function confirmDeleteSelected() {
    const n = selected.size;
    if (n === 0) return;
    if (activeTab === 'mine') {
      Alert.alert(
        n === 1 ? 'Delete this story?' : `Delete ${n} stories?`,
        `${n === 1 ? 'This story' : `These ${n} stories`} will be permanently deleted for everyone — removed from the map and from anyone who saved ${n === 1 ? 'it' : 'them'}. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => runDelete([...selected]) },
        ],
      );
    } else {
      Alert.alert(
        n === 1 ? 'Remove saved story?' : `Remove ${n} saved stories?`,
        `This only removes ${n === 1 ? 'it' : 'them'} from your Saved list — the original ${n === 1 ? 'story is' : 'stories are'} not deleted. You can't undo this here, but you can save ${n === 1 ? 'it' : 'them'} again from the map while ${n === 1 ? 'it is' : 'they are'} live.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => runDelete([...selected]) },
        ],
      );
    }
  }

  function confirmClearAll() {
    const n = total ?? loaded.length;
    if (n === 0) return;
    const clear = async () => {
      setDeleting(true);
      await runBusy(async () => {
        await clearArchive(activeTab);
        exitSelectMode();
      }, () => setDeleting(false)).catch(() =>
        Alert.alert('Could not clear', 'Something went wrong and nothing was removed. Please try again.'),
      );
    };
    if (activeTab === 'mine') {
      Alert.alert(
        'Delete all your stories?',
        `All ${n} of your stories will be permanently deleted for everyone — removed from the map and from anyone who saved them. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete all', style: 'destructive', onPress: clear },
        ],
      );
    } else {
      Alert.alert(
        'Remove all saved stories?',
        `All ${n} bookmarks will be removed from your Saved list. The original stories are not deleted. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove all', style: 'destructive', onPress: clear },
        ],
      );
    }
  }

  const TABS: { key: Tab; label: string; count: number | null }[] = [
    { key: 'mine',  label: 'Mine',  count: archive.mineTotal },
    { key: 'saved', label: 'Saved', count: archive.savedTotal },
  ];

  const firstLoad = list === null;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ArchiveHeader
        selectMode={selectMode}
        selectedCount={selected.size}
        canSelect={loaded.length > 0}
        allSelected={allSelected}
        onBack={() => router.back()}
        onEnterSelect={enterSelectMode}
        onExitSelect={exitSelectMode}
        onToggleSelectAll={toggleSelectAll}
      />

      <ArchiveTabs tabs={TABS} activeTab={activeTab} onSelect={switchTab} />

      {firstLoad ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          data={loaded}
          key={activeTab}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          windowSize={5}
          initialNumToRender={8}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.grid, { paddingBottom: bottom + (selectMode ? 120 : 32) }]}
          renderItem={({ item }) => (
            <StoryCard
              story={item}
              showAuthor={activeTab === 'saved'}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onPress={() => (selectMode ? toggleSelected(item.id) : setViewerStory(item))}
              onLongPress={() => {
                if (!selectMode) enterSelectMode();
                toggleSelected(item.id);
              }}
            />
          )}
          ListEmptyComponent={
            activeTab === 'mine' ? (
              <EmptyState
                title="No stories yet"
                message={'Every story you post on the map lands here automatically — and stays after it expires.'}
              />
            ) : (
              <EmptyState
                title="Nothing saved yet"
                message={'When you view someone’s story on the map, tap the bookmark to keep it here.'}
              />
            )
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} colors={[colors.teal]} />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.teal} style={styles.footerSpinner} /> : null
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {selectMode && (
        <SelectionBar
          activeTab={activeTab}
          selectedCount={selected.size}
          deleting={deleting}
          canClear={loaded.length > 0}
          bottom={bottom}
          onClearAll={confirmClearAll}
          onDeleteSelected={confirmDeleteSelected}
        />
      )}

      {/* Story viewer — reactions shown read-only (reacting needs proximity) */}
      {viewerStory && (
        <StoryViewer
          stories={[viewerStory]}
          onClose={() => setViewerStory(null)}
          currentUserId={currentUserId}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.6 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 18,
    color: colors.t1,
  },
  headerAction: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.teal,
  },
  headerActionDisabled: { color: colors.t3 },

  // Tab bar — underline style
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: colors.teal },
  tabLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t3,
  },
  tabLabelActive: { color: colors.t1, fontWeight: '600' },
  tabBadge: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeActive: { backgroundColor: colors.teal },
  tabBadgeText: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 10,
    fontWeight: '700',
  },
  tabBadgeTextActive: { color: colors.bg },

  // Grid
  grid: { padding: 16, gap: 12 },
  gridRow: { gap: 12 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footerSpinner: { marginVertical: 16 },

  // Card
  card: {
    flex: 1,
    aspectRatio: 0.75,
    borderRadius: radius.m,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardSelected: { borderWidth: 2, borderColor: colors.teal },
  cardTextOnly: { flex: 1, padding: 12, paddingBottom: 56 },
  cardTextContent: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
    color: colors.t1,
    lineHeight: 20,
  },
  cardAuthor: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 100,
    paddingRight: 10,
    paddingLeft: 3,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  cardAuthorName: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t1,
    flexShrink: 1,
  },
  cardFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    gap: 3,
    backgroundColor: 'rgba(10,10,11,0.72)',
  },
  cardCaption: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '500',
    color: colors.t1,
  },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
  },
  cardPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },

  // Selection checkbox
  checkbox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.t1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },

  // Empty state
  emptyWrap: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 36, gap: 8 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t2,
  },
  emptyMessage: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Select-mode action bar
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clearBtn: {
    paddingHorizontal: 18,
    height: 48,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearBtnText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.red,
  },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.red,
  },
  deleteBtnDisabled: { backgroundColor: colors.surface2 },
  deleteBtnText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.t1,
  },
  deleteBtnTextDisabled: { color: colors.t3 },
});
