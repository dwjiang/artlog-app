/**
 * The judges' demo build runs on a cloud iPhone simulator. It starts past the first-launch welcome, and shows sample
 * paintings where the camera preview would be because the simulator has no camera the app can open.
 */
export function isJudgesDemo(): boolean {
  return process.env.EXPO_PUBLIC_JUDGES_DEMO === "1";
}
