import { RNHostView } from "@expo/ui";
import { Gallery } from "@/constants/theme";
import { LoadingRing } from "./loading-ring";

export function NativeLoadingRing({
  label,
  color = Gallery.accent,
}: {
  label: string;
  color?: string;
}) {
  return (
    <RNHostView matchContents>
      <LoadingRing
        accessibilityLabel={label}
        color={color}
        style={{ width: 24, height: 24 }}
      />
    </RNHostView>
  );
}
