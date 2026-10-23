import { Image } from "expo-image";

// Bound downloaded images; local photos use memory-only caching at their display sites.
export function limitImageCache() {
  Image.configureCache({ maxDiskSize: 100 * 1024 * 1024 });
}

// The disk holds the signed-in account's shared visit photos, so leaving an account must clear it too.
export async function clearImageCaches() {
  await Image.clearDiskCache();
  await Image.clearMemoryCache();
}
