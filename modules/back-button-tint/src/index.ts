import { requireOptionalNativeModule } from "expo";

type BackButtonTint = { setTint(color: string): void };

/** Colors the iOS 26 glass back chevron, which ignores `headerTintColor`. */
export function setBackButtonTint(color: string) {
  // Optional because Jest, which has no native modules, renders the root layout that calls this.
  requireOptionalNativeModule<BackButtonTint>("BackButtonTint")?.setTint(color);
}
