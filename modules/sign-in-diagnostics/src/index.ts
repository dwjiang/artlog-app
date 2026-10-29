import { requireOptionalNativeModule } from "expo";

type DiagnosticData = Record<string, string | number | boolean>;
const flags = [
  "guidedAccess",
  "hasPresenter",
  "hasApplePresentationWindow",
  "presenterHasWindow",
  "presenterBeingPresented",
  "presenterBeingDismissed",
  "presenterHasTransition",
] as const;

export function diagnosticAppState(value: unknown): string {
  return value === "active" || value === "inactive" || value === "background" ? value : "unknown";
}

// A native rebuild is needed to include this optional module. Old binaries and diagnostic
// failures must still be able to sign in; even a stalled bridge has a bounded wait.
export async function signInPresentationSnapshot(): Promise<DiagnosticData> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const module = requireOptionalNativeModule<{ snapshot(): Promise<unknown> }>("SignInDiagnostics");
    if (!module) return { snapshot: "unavailable" };
    const result = await Promise.race([
      module.snapshot(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 150);
      }),
    ]);
    if (result === undefined) return { snapshot: "timeout" };
    if (!result || typeof result !== "object") return { snapshot: "invalid" };
    const raw = result as Record<string, unknown>;
    const data: DiagnosticData = { snapshot: "available", applicationState: diagnosticAppState(raw.applicationState) };
    for (const flag of flags) if (typeof raw[flag] === "boolean") data[flag] = raw[flag];
    return data;
  } catch {
    return { snapshot: "failed" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
