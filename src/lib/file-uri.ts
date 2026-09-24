/** The filesystem path behind a `file://` URI; other strings are returned unchanged. */
export function filePath(uri: string): string {
  return uri.startsWith("file://")
    ? decodeURI(uri.slice("file://".length))
    : uri;
}
