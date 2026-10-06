import { requireNativeView } from "expo";
import type { ViewProps } from "react-native";

/**
 * A band across the top of a tab screen, starting under the status bar. The screen's safe area grows by the band's
 * height below the status bar, so its header, scroll insets and `useSafeAreaInsets` start under the band.
 */
export const SafeAreaBand = requireNativeView<ViewProps>("SafeAreaBand");
