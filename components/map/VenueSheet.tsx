import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { fonts } from '@/constants/theme';
import { clubsApi, type Club } from '@/services/clubs';
import { venueProposalRoute, type Venue } from '@/services/venues';
import { runBusy } from '@/services/busy';

export function VenueSheet({ venue, onClose }: { venue: Venue | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const navigating = useRef(false);
  const pendingRoute = useRef<Href | null>(null);
  const venueId = venue?.id;
  useEffect(() => {
    setChoosing(false); setClubs([]); setLoading(false); setError(false);
    if (venueId) navigating.current = false;
    request.current += 1;
    return () => { request.current += 1; };
  }, [venueId]);

  async function chooseClub() {
    const version = ++request.current;
    setChoosing(true); setLoading(true); setError(false);
    await runBusy(async () => {
      const { data } = await clubsApi.myList();
      if (request.current === version) setClubs(data);
    }, () => {
      if (request.current === version) setLoading(false);
    }).catch(() => { if (request.current === version) setError(true); });
  }

  function select(club: Club) {
    if (!venue) return;
    navigate(venueProposalRoute(club.id, venue.id, club.name));
  }

  function navigate(route: Href) {
    if (navigating.current) return;
    navigating.current = true;
    // iOS cannot present the proposal Modal while this one is dismissing.
    if (Platform.OS === 'ios') pendingRoute.current = route;
    onClose();
    if (Platform.OS !== 'ios') router.push(route);
  }

  function afterDismiss() {
    const route = pendingRoute.current;
    pendingRoute.current = null;
    if (route) router.push(route);
  }

  return (
    <Modal visible={venue !== null} transparent animationType="slide" onRequestClose={onClose} onDismiss={afterDismiss}>
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close venue" />
        <View style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: bottom + 24 }]}>
          <View style={styles.header}>
            <Text style={[styles.eyebrow, { color: colors.purple }]}>{choosing ? 'CHOOSE YOUR CLUB' : 'PLACES TO MEET'}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close venue card">
              <Ionicons name="close" size={24} color={colors.t2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {!choosing && (venue?.image_url
              ? <Image source={{ uri: venue.image_url }} style={styles.hero} contentFit="cover" accessibilityLabel={venue.name} />
              : <View style={[styles.hero, styles.illustration]}>
                  <Ionicons name="storefront-outline" size={54} color="#FFFFFF" />
                  <Text style={styles.heroLabel}>A place to get together</Text>
                </View>)}
            <Text style={[styles.title, { color: colors.t1 }]}>{venue?.name}</Text>
            <Text style={[styles.meta, { color: colors.t2 }]}>{venue?.category} · {venue?.address}</Text>
            {choosing ? <>
              <Text style={[styles.copy, { color: colors.t2 }]}>Who would you like to meet here?</Text>
              {loading ? <ActivityIndicator accessibilityLabel="Loading your clubs" color={colors.purple} /> : error ? <>
                <Text style={[styles.copy, { color: colors.t2 }]}>Could not load your clubs.</Text>
                <Pressable onPress={chooseClub} accessibilityRole="button" style={styles.action}><Text style={styles.actionText}>Try again</Text></Pressable>
              </> : clubs.length === 0 ? <>
                <Text style={[styles.copy, { color: colors.t2 }]}>Join or create a club before proposing a meetup.</Text>
                <Pressable onPress={() => navigate('/create-club')} accessibilityRole="button" style={styles.action}>
                  <Text style={styles.actionText}>Create a club</Text>
                </Pressable>
              </> : clubs.map(club => (
                <Pressable key={club.id} onPress={() => select(club)} accessibilityRole="button"
                  accessibilityLabel={`Propose a meetup with ${club.name}`}
                  style={[styles.club, { borderColor: colors.t3 }]}>
                  <Ionicons name="people-outline" size={22} color={colors.purple} />
                  <Text style={[styles.clubName, { color: colors.t1 }]}>{club.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.t2} />
                </Pressable>
              ))}
              <Pressable onPress={() => { request.current += 1; setChoosing(false); }} accessibilityRole="button" style={styles.back}>
                <Text style={{ color: colors.t2 }}>Back to venue</Text>
              </Pressable>
            </> : <>
              {!!venue?.description && <Text style={[styles.copy, { color: colors.t2 }]}>{venue.description}</Text>}
              <Pressable onPress={chooseClub} accessibilityRole="button" style={styles.action}>
                <Ionicons name="people-outline" size={21} color="#FFFFFF" />
                <Text style={styles.actionText}>Propose a meetup</Text>
              </Pressable>
              <Pressable disabled accessibilityRole="button" accessibilityLabel="Make a swift, coming soon"
                accessibilityState={{ disabled: true }} style={[styles.action, styles.disabled]}>
                <Ionicons name="videocam-outline" size={21} color={colors.t3} />
                <Text style={[styles.actionText, { color: colors.t3 }]}>Make a swift</Text>
                <Text style={{ color: colors.t3, fontSize: 11 }}>Coming soon</Text>
              </Pressable>
              <Text style={[styles.note, { color: colors.t3 }]}>A meetup proposal is not a reservation.</Text>
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  eyebrow: { fontFamily: fonts.display, fontSize: 11, letterSpacing: 1.5 },
  hero: { height: 136, borderRadius: 18, marginBottom: 20 },
  illustration: { backgroundColor: '#6044B5', alignItems: 'center', justifyContent: 'center', gap: 12 },
  heroLabel: { fontFamily: fonts.body, color: '#FFFFFF', fontSize: 13 },
  title: { fontFamily: fonts.display, fontSize: 27, marginBottom: 6 },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20 },
  copy: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, marginVertical: 16 },
  action: { backgroundColor: '#6044B5', borderRadius: 16, padding: 17, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12 },
  actionText: { fontFamily: fonts.display, color: '#FFFFFF', fontSize: 15 },
  disabled: { backgroundColor: 'rgba(128,128,128,0.10)' },
  note: { fontFamily: fonts.body, fontSize: 11, textAlign: 'center', marginTop: 16 },
  club: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 18 },
  clubName: { flex: 1, fontFamily: fonts.display, fontSize: 16 },
  back: { alignItems: 'center', padding: 18 },
});
