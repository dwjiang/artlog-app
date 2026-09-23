import { ThemedText } from "@/components/themed-text";

export function TentativeOriginNotice() {
  return (
    <ThemedText type="small" themeColor="warning">
      Shared by a visitor. Label not independently confirmed.
    </ThemedText>
  );
}
