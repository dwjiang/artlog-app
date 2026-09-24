import { getSetting, setSetting } from "@/db/repos/settings";

const KEY = "save-originals-to-photos";

export async function getSaveToPhotos(): Promise<boolean> {
  return (await getSetting(KEY)) !== "false";
}

export async function setSaveToPhotos(enabled: boolean): Promise<void> {
  await setSetting(KEY, String(enabled));
}
