import { Image } from "expo-image";

// Bound downloaded images; local photos use memory-only caching at their display sites.
export function limitImageCache() {
  Image.configureCache({ maxDiskSize: 100 * 1024 * 1024 });
}
