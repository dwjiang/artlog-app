import { requireOptionalNativeModule } from "expo";

export type LookAround = {
  /**
   * A JPEG still of the Look Around scene nearest the coordinate, as a file URI that lasts until the app next starts;
   * null where Apple has no imagery. Sends the coordinate to Apple Maps.
   */
  snapshot(lat: number, lng: number, width: number, height: number): Promise<string | null>;
  /** Presents Apple's interactive Look Around viewer at the coordinate. */
  open(lat: number, lng: number): Promise<void>;
};

const EXPECTED_CODES = new Set([
  "ERR_LOOK_AROUND_THROTTLED",
  "ERR_LOOK_AROUND_UNREACHABLE",
  "ERR_LOOK_AROUND_NO_SCENE",
]);

/** Throttling, a lost connection or a place without imagery: conditions a phone meets routinely, not failures. */
export function isExpectedLookAroundError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && EXPECTED_CODES.has(code);
}

let instance: LookAround | null | undefined;

/** Undefined in builds without the native module, such as a dev client older than it. */
export function getLookAround(): LookAround | undefined {
  instance ??= requireOptionalNativeModule<LookAround>("LookAround");
  return instance ?? undefined;
}
