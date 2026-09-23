import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export async function chooseProfilePhoto(): Promise<string | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled) return;
  const asset = result.assets[0];
  const side = Math.min(asset.width, asset.height);
  if (!side) throw new Error("This photo could not be opened.");
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    const rendered = await context
      .crop({
        originX: (asset.width - side) / 2,
        originY: (asset.height - side) / 2,
        width: side,
        height: side,
      })
      .resize({ width: 256, height: 256 })
      .renderAsync();
    try {
      return (await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })).uri;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

export async function profilePhotoBytes(uri: string): Promise<ArrayBuffer> {
  const file = new File(uri);
  if (file.size > 512 * 1024) throw new Error("Choose a smaller photo.");
  return file.arrayBuffer();
}

export function removeProfilePhotoDraft(uri?: string) {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
