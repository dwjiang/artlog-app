import { render, screen } from "@testing-library/react-native";
import { type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { SafeAreaFlatList, SafeAreaScrollView } from "./safe-area-scroll";
import { scrollViewHolding } from "./scroll-view.testing";

const railOnTheRight = ({ children }: { children: ReactNode }) => (
  <SafeAreaInsetsContext.Provider value={{ top: 59, right: 84, bottom: 34, left: 0 }}>
    {children}
  </SafeAreaInsetsContext.Provider>
);

const contentStyleAround = (text: string) =>
  StyleSheet.flatten(scrollViewHolding(screen.getByText(text)).props.contentContainerStyle);

it("pads a vertical list's content across its axis when it adjusts for the safe area", async () => {
  await render(
    <SafeAreaScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20 }}>
      <Text>Water Lilies</Text>
    </SafeAreaScrollView>,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Water Lilies")).toMatchObject({ paddingLeft: 20, paddingRight: 104 });
});

it("pads list content the same way", async () => {
  await render(
    <SafeAreaFlatList
      contentInsetAdjustmentBehavior="automatic"
      data={["Water Lilies"]}
      renderItem={({ item }) => <Text>{item}</Text>}
    />,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Water Lilies")).toMatchObject({ paddingLeft: 0, paddingRight: 84 });
});

it("leaves lists that do not adjust, or scroll sideways, to their own padding", async () => {
  await render(
    <>
      <SafeAreaScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 20 }}>
        <Text>Never</Text>
      </SafeAreaScrollView>
      <SafeAreaScrollView horizontal contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20 }}>
        <Text>Sideways</Text>
      </SafeAreaScrollView>
    </>,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Never")).toEqual({ padding: 20 });
  expect(contentStyleAround("Sideways")).toEqual({ padding: 20 });
});
