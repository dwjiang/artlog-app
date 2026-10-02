import { useCallback, useEffect, useRef, useState } from "react";

import type { AvatarId } from "@/shared/social/avatars";

import { profilePhotoBytes, removeProfilePhotoDraft } from "./profile-photo";

/** A photo `uri` is a cropped draft file, deleted by whoever holds it once it is replaced or abandoned. */
export type ProfilePicture = { kind: "photo"; uri: string } | { kind: "avatar"; avatar: AvatarId };

/** Arguments for `profilePhotos.save`; an unchanged picture sends neither field. */
export async function profilePictureArgs(
  picture: ProfilePicture | undefined,
): Promise<{ photo?: ArrayBuffer | null; avatar?: AvatarId }> {
  if (!picture) return {};
  if (picture.kind === "avatar") return { avatar: picture.avatar, photo: null };
  return { photo: await profilePhotoBytes(picture.uri) };
}

/** An unsaved picture; deletes its draft photo when it is replaced or the screen closes. */
export function useProfilePictureDraft() {
  const [picture, setPicture] = useState<ProfilePicture>();
  const draft = useRef<string>(undefined);
  useEffect(() => () => removeProfilePhotoDraft(draft.current), []);
  const choose = useCallback((next: ProfilePicture) => {
    const uri = next.kind === "photo" ? next.uri : undefined;
    if (draft.current !== uri) removeProfilePhotoDraft(draft.current);
    draft.current = uri;
    setPicture(next);
  }, []);
  /** For a store that keeps its own copy of the photo, so the draft is no longer this screen's to delete. */
  const commit = useCallback(() => {
    draft.current = undefined;
    setPicture(undefined);
  }, []);
  return { picture, choose, commit };
}

/** What an avatar shows once `picture` replaces the saved photo and painting. */
export function shownPicture(
  saved: { photoUrl?: string; avatar?: AvatarId },
  picture: ProfilePicture | undefined,
): { photoUrl?: string; avatar?: AvatarId } {
  if (!picture) return saved;
  return picture.kind === "photo" ? { photoUrl: picture.uri, avatar: saved.avatar } : { avatar: picture.avatar };
}
