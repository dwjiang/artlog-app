/**
 * The judges' demo build runs on a cloud iPhone simulator. It starts past the first-launch welcome, shows sample
 * paintings where the camera preview would be because the simulator has no camera the app can open, and keeps Home on
 * the Global feed without its friend sign-in prompts because the unsigned build cannot sign in.
 */
export function isJudgesDemo(): boolean {
  return process.env.EXPO_PUBLIC_JUDGES_DEMO === "1";
}
