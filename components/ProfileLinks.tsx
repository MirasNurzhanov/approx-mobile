import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { hostOf, type ProfileLink } from '@/services/links';
import { iconForPlatform, platformName } from '@/components/ui/platformIcons';
import { colors, fonts, radius, type as typography } from '@/constants/theme';

// Rendering rules, all deliberate:
//
//  * `label` is printed as plain <Text>. Never HTML, never a WebView, never a
//    rich preview — the string came from another user.
//  * The destination host is shown in a confirmation before anything opens,
//    so a link labelled "@someone" cannot quietly open somewhere else.
//  * Nothing is fetched. The icon is bundled and chosen by `platform`, which
//    the server derived offline from the host.

function confirmAndOpen(link: ProfileLink) {
  const host = hostOf(link.url);
  Alert.alert(
    `Open ${host}?`,
    `This will leave Aura and open ${link.url} in your browser.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open',
        onPress: () => {
          Linking.openURL(link.url).catch(() =>
            Alert.alert('Couldn’t open link', `Nothing on this device can open ${host}.`),
          );
        },
      },
    ],
  );
}

export function ProfileLinkRow({ link }: { link: ProfileLink }) {
  const Icon = iconForPlatform(link.platform);
  const host = hostOf(link.url);
  return (
    <Pressable
      onPress={() => confirmAndOpen(link)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="link"
      // The platform name carries the meaning the icon carries visually, and
      // the host is announced because it is what the user is committing to.
      accessibilityLabel={`${platformName(link.platform)}, ${link.label}`}
      accessibilityHint={`Opens ${host} outside Aura`}
    >
      <Icon size={18} color={colors.teal} />
      <Text style={styles.label} numberOfLines={1}>{link.label}</Text>
      <Text style={styles.host} numberOfLines={1} importantForAccessibility="no">
        {host}
      </Text>
    </Pressable>
  );
}

export function ProfileLinks({ links }: { links: ProfileLink[] }) {
  if (!links.length) return null;
  return (
    <View style={styles.wrap}>
      {links.map((link) => (
        <ProfileLinkRow key={link.id} link={link} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  label: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.t1,
  },
  host: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
    maxWidth: '40%',
  },
  pressed: { opacity: 0.7 },
});
