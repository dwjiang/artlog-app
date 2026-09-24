import { requireNativeView } from "expo";
import type { ColorValue, ViewProps } from "react-native";

export type SystemVolumeSliderProps = ViewProps & {
  minimumTrackColor: ColorValue;
  maximumTrackColor: ColorValue;
};

/** Shows and sets the iPhone's media volume, so it moves with the hardware volume buttons. */
export const SystemVolumeSlider = requireNativeView<SystemVolumeSliderProps>("SystemVolume");
