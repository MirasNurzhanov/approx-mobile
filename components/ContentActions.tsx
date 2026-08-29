import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { ReportSheet } from '@/components/ReportSheet';
import { blockUser } from '@/services/blocked';
import type { ReportTarget } from '@/services/reporting';

// The overflow menu behind every piece of user-generated content.
//
// One hook rather than a copy per screen, because "Report / Block / Cancel" has
// to appear on Swifts, stories, comments, messages and profiles, and five
// copies of it is five chances for one surface to quietly lose its Report
// entry — which is precisely the state App Review found the app in.
//
// Usage mirrors `usePermissionPrimer`, which is the pattern this codebase
// already uses for "a hook that owns a modal":
//
//   const { present, sheets } = useContentActions();
//   ... present({ target: 'swift', targetId: s.id, subject: `@${s.author}`, ... })
//   ... render {sheets} somewhere in the tree
//
// `onRemoved` is the important half. Blocking is enforced server-side (see
// users/visibility.py) and the next fetch would drop the content anyway — but
// "the next fetch" can be minutes away on a feed the user is sitting in, and
// content that stays on screen after a block reads as the block not working.
// So the caller is handed a callback and removes it locally at once.

export interface ContentActionTarget {
  /** What is being acted on. Decides which report endpoint is used. */
  target: ReportTarget;
  targetId: number | string;
  /** "@ada" or "this Swift" — shown in the menu title and the report sheet. */
  subject: string;
  /** Who is answerable for it. Absent for content with no identifiable
   *  author, in which case Block is not offered. */
  authorId?: number | null;
  authorUsername?: string;
  authorAvatar?: string;
  /** Drop this content from whatever list it is in, right now. Called after a
   *  successful block, and after a report when the user then blocks. */
  onRemoved?: () => void;
}

/** How each surface is described in the note a block sends to moderation. */
const SURFACE_LABEL: Record<ReportTarget, string> = {
  swift: 'Swift',
  user: 'profile',
  story: 'story',
  comment: 'comment',
  message: 'direct message',
  club_message: 'club message',
};

export function useContentActions() {
  const [reporting, setReporting] = useState<ContentActionTarget | null>(null);

  const doBlock = useCallback(async (item: ContentActionTarget) => {
    if (item.authorId == null) return;
    try {
      await blockUser(
        {
          id: item.authorId,
          username: item.authorUsername ?? 'this account',
          profile_picture: item.authorAvatar,
        },
        // The server files a moderation report on every block; this is what
        // tells it which surface the block came from. A block raised from a
        // profile carries no note - it is not an accusation - while one raised
        // from a Swift or a comment names the content, which is what makes it
        // worth a moderator's attention.
        item.target === 'user'
          ? {}
          : { note: `Blocked from a ${SURFACE_LABEL[item.target]}` },
      );
      // Local removal first, server filtering second. The server is the source
      // of truth and will keep them out of every future response; this is what
      // makes the current screen agree with that immediately.
      item.onRemoved?.();
    } catch {
      Alert.alert(
        'Could not block',
        'That did not go through. Check your connection and try again.',
      );
    }
  }, []);

  const confirmBlock = useCallback((item: ContentActionTarget) => {
    const who = item.authorUsername ? `@${item.authorUsername}` : 'this account';
    Alert.alert(
      `Block ${who}?`,
      'They will not be able to see you, message you, or find you on the map, '
      + 'and you will stop seeing them. You can undo this in Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => doBlock(item) },
      ],
    );
  }, [doBlock]);

  /** Open the overflow menu for one piece of content. */
  const present = useCallback((item: ContentActionTarget) => {
    const canBlock = item.authorId != null;

    const openReport = () => setReporting(item);

    if (Platform.OS === 'ios') {
      const options = canBlock
        ? ['Report', 'Block user', 'Cancel']
        : ['Report', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: item.subject,
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: canBlock ? 1 : undefined,
        },
        (index) => {
          if (index === 0) openReport();
          else if (canBlock && index === 1) confirmBlock(item);
        },
      );
      return;
    }

    Alert.alert(item.subject, undefined, [
      { text: 'Report', onPress: openReport },
      ...(canBlock
        ? [{
            text: 'Block user',
            style: 'destructive' as const,
            onPress: () => confirmBlock(item),
          }]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [confirmBlock]);

  const sheets = (
    <ReportSheet
      visible={reporting !== null}
      target={reporting?.target ?? 'user'}
      targetId={reporting?.targetId ?? null}
      subject={reporting?.subject ?? ''}
      onClose={() => setReporting(null)}
      onReported={() => {
        // Reporting is not blocking, and does not hide anything on its own —
        // that is the server's decision to make once a moderator has looked.
        // The sheet's confirmation offers blocking as the separate step it is.
      }}
    />
  );

  return { present, sheets };
}
