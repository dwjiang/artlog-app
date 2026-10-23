import { Directory, Paths } from "expo-file-system";

import { deleteAllLocalData } from "@/db/repos/local-data";
import { forgetDeviceIdentity } from "@/lib/device-identity";
import { PHOTO_FOLDERS } from "@/lib/files/photo-folders";
import { clearImageCaches } from "@/lib/image-cache";
import { startNewInstallation } from "@/lib/installation-storage";

import { initializeOwner } from "./owner-store";

/** Leaves this iPhone as a fresh install would: no journal, photos, preferences or device identity. */
export async function eraseLocalData(): Promise<void> {
  deleteAllLocalData();
  for (const folder of Object.values(PHOTO_FOLDERS)) {
    const directory = new Directory(Paths.document, folder);
    if (directory.exists) directory.delete();
  }
  await clearImageCaches();
  await forgetDeviceIdentity();
  initializeOwner(startNewInstallation());
}
