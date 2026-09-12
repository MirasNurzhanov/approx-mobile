type ProfileAccess = { is_private?: boolean; can_view_swifts?: boolean; bio?: string };

/** Minimal profiles deliberately omit personal details, including the bio field. */
export function profileDetailsHidden(profile: ProfileAccess): boolean {
  return profile.can_view_swifts === false || !('bio' in profile);
}

export function hiddenProfileMessage(profile: ProfileAccess, relationship: string): string {
  if (profile.can_view_swifts === false || relationship === 'friend' || relationship === 'connected') {
    return "This person isn't sharing their profile details or Swifts.";
  }
  if (relationship === 'hi_sent') {
    return 'Your request is waiting for them to accept. Their privacy settings control what they share.';
  }
  return 'You can send a Hi to connect. Their privacy settings control which profile details and Swifts they share.';
}
