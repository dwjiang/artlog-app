import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { Pressable, Text } from "react-native";

import { formStateFromValues } from "@/lib/label/fields";
import { useConfirmDetails } from "@/lib/result/use-confirm-details";

import type { Id } from "../../../convex/_generated/dataModel";

jest.mock("@/lib/convex-client", () => ({ convex: { mutation: async () => null } }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: true }) }));

function ConfirmRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: Id<"scans"> }>();
  const { confirm } = useConfirmDetails(scanId, "manual");
  return (
    <Pressable accessibilityRole="button" onPress={() => void confirm(formStateFromValues({ title: "Pond" }))}>
      <Text>Confirm details</Text>
    </Pressable>
  );
}

function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return <Text>Result {scanId}</Text>;
}

it.each(["/label/scan-1", "/enter-details/scan-1"] as const)(
  "confirming on %s returns to the artwork screen it came from instead of opening another",
  async (path) => {
    const view = await renderRouter(
      {
        _layout: () => <Stack />,
        index: () => <Text>Camera</Text>,
        "result/[scanId]": ResultRoute,
        "label/[scanId]": ConfirmRoute,
        "enter-details/[scanId]": ConfirmRoute,
      },
      { initialUrl: "/" },
    );
    await act(() => router.push({ pathname: "/result/[scanId]", params: { scanId: "scan-1", entrance: "capture" } }));
    const stack = () => view.getRouterState()!.routes[0].state!.routes;
    const artwork = stack()[1].key;
    await act(() => router.push(path));
    await fireEvent.press(await screen.findByRole("button", { name: "Confirm details" }));
    await waitFor(() => expect(view.getPathname()).toBe("/result/scan-1"));
    expect(stack().map((route) => route.key)).toEqual([stack()[0].key, artwork]);
  },
);
