export const ERROR_MESSAGES = {
  unauthenticated: "Sign in to continue.",
  not_found: "This item is no longer available.",
  rate_limited: "Please wait a moment and try again.",
  profile_required: "Create a profile to continue.",
  username_taken: "That username is already taken.",
  conflict: "This changed on another device. Refresh and try again.",
  invalid_profile: "Check your name, username, and bio.",
  profile_not_allowed: "That name, username, or bio isn’t allowed. Try different words.",
  invalid_visit: "Check the visit date and museum.",
  invalid_save: "Check the artwork details and note.",
  invalid_venue: "Choose a valid museum.",
  invalid_wall: "Check the wall layout.",
  invalid_post: "Check the selected artworks and notes.",
  invalid_comment: "Write a comment between 1 and 1,000 characters.",
  comment_not_allowed: "That comment includes words that aren’t allowed. Try different words.",
  reflection_not_allowed: "Your reflection includes words that aren’t allowed. Edit it and try again.",
  note_not_allowed: "This note includes words that aren’t allowed. Edit it to share it.",
  invalid_relationship: "This connection is not valid.",
  invalid_report: "Check the report reason and details.",
  friend_limit: "One of these profiles has reached the friend limit.",
  invalid_media: "This image is not available.",
  invalid_pagination: "Refresh and try again.",
  invalid_sync: "The journal could not sync. Try again.",
  sync_scope_changed: "Your account changed. Try again.",
  claim_required: "Your journal is still linking. Try again shortly.",
  ownership_collision: "These journal records conflict. Your originals have been kept.",
  sign_in_required: "Sign in to continue.",
  already_linked: "Sign out before linking another account.",
  account_device_limit: "This account has reached its device limit.",
} as const;
export function socialErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const data = "data" in error ? error.data : error;
  if (!data || typeof data !== "object" || !("code" in data) || typeof data.code !== "string") {
    return;
  }
  return ERROR_MESSAGES[data.code as keyof typeof ERROR_MESSAGES];
}
