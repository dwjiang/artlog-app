import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import { captureFileUri } from "@/lib/files/photos";
import { removeFileIfExists } from "@/lib/files/remove-file";
import { reportError } from "@/lib/observability";
import { LIMITS } from "@/shared/journal/limits";
import { AVATARS, type AvatarId, isAvatarId } from "@/shared/social/avatars";

const NAME_KEY = "local-profile-name";
const PHOTO_KEY = "local-profile-photo";
const AVATAR_KEY = "local-profile-avatar";
const PHOTO_FOLDER = "profile";
const listeners = new Set<() => void>();
let assigningAvatar: Promise<AvatarId> | undefined;

/** `avatar` is shown whenever there is no photo. */
export type LocalProfile = { name?: string; photoUrl?: string; avatar: AvatarId };

export async function getLocalProfileName(): Promise<string | undefined> {
  return (await getSetting(NAME_KEY))?.trim() || undefined;
}

export async function getLocalProfile(): Promise<LocalProfile> {
  const [name, photoPath, avatar] = await Promise.all([getLocalProfileName(), getSetting(PHOTO_KEY), localAvatar()]);
  return { name, photoUrl: photoPath ? captureFileUri(photoPath) : undefined, avatar };
}

// Each installation keeps one random painting until its owner picks another.
async function localAvatar(): Promise<AvatarId> {
  const stored = await getSetting(AVATAR_KEY);
  if (isAvatarId(stored)) return stored;
  assigningAvatar ??= (async () => {
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
    await setSetting(AVATAR_KEY, avatar);
    return avatar;
  })().finally(() => {
    assigningAvatar = undefined;
  });
  return assigningAvatar;
}

// These are installation preferences, so changing the active journal owner cannot clear them.
export async function setLocalProfileName(value: string): Promise<void> {
  const name = value.trim();
  if (!name || name.length > LIMITS.name) throw new Error("Enter a name between 1 and 60 characters.");
  await setSetting(NAME_KEY, name);
  for (const listener of listeners) listener();
}

export async function setLocalProfilePhoto(uri: string): Promise<void> {
  const previous = await getSetting(PHOTO_KEY);
  new Directory(Paths.document, PHOTO_FOLDER).create({ intermediates: true, idempotent: true });
  // A new filename each time: expo-image caches local files by URI and would keep showing the old photo.
  const path = `${PHOTO_FOLDER}/${randomUUID()}.jpg`;
  const target = captureFileUri(path);
  // Keep the draft available for retry until the new path has been committed.
  try {
    await new File(uri).copy(new File(target));
    await setSetting(PHOTO_KEY, path);
  } catch (cause) {
    removeProfileFile(target);
    throw cause;
  }
  for (const listener of listeners) listener();
  removeProfileFile(uri);
  if (previous) removeProfileFile(captureFileUri(previous));
}

/** Choosing a painting replaces the photo. */
export async function setLocalProfileAvatar(avatar: AvatarId): Promise<void> {
  const photo = await getSetting(PHOTO_KEY);
  await setSetting(AVATAR_KEY, avatar);
  if (photo) await removeSetting(PHOTO_KEY);
  for (const listener of listeners) listener();
  if (photo) removeProfileFile(captureFileUri(photo));
}

function removeProfileFile(uri: string): void {
  try {
    removeFileIfExists(uri);
  } catch (cause) {
    reportError(cause, "account.local_profile.cleanup");
  }
}

export function useLocalProfile() {
  const [state, setState] = useState<Partial<LocalProfile> & { loading: boolean }>({ loading: true });
  useEffect(() => {
    let mounted = true;
    const load = () => {
      void getLocalProfile().then(
        (profile) => {
          if (mounted) setState({ ...profile, loading: false });
        },
        (cause: unknown) => {
          reportError(cause, "account.local_profile.load");
          if (mounted) setState((current) => ({ ...current, loading: false }));
        },
      );
    };
    listeners.add(load);
    load();
    return () => {
      mounted = false;
      listeners.delete(load);
    };
  }, []);
  return state;
}
