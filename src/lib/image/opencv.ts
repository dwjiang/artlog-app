import type * as FastOpenCVModule from "react-native-fast-opencv";

/** The `react-native-fast-opencv` module namespace: `OpenCV` functions, `Mat`/`Size` factories and enums. */
export type FastOpenCV = typeof FastOpenCVModule;

/**
 * Loaded on first use rather than at import: the package installs its JSI bindings when imported,
 * which needs the native runtime, so pure callers and Jest never touch it.
 */
export function loadOpenCV(): Promise<FastOpenCV> {
  return import("react-native-fast-opencv");
}
