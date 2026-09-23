import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { useEffect } from "react";
import { ListeningProvider } from "./listening-provider";
import { useListening } from "./use-listening";
let mockOwner = "device:one";
const mockCancel = jest.fn();
const mockMounted = jest.fn();
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => mockOwner }));
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: async () => {},
}));
const mockGenerate = jest.fn();
jest.mock("convex/react", () => ({ useAction: () => mockGenerate }));
jest.mock("./narration-renderer", () => ({
  createNarrationRenderer: () => ({
    render: () => new Promise(() => {}),
    cancel: () => mockCancel(),
  }),
}));
function Screen() {
  const audio = useListening();
  useEffect(() => {
    mockMounted();
  }, []);
  return (
    <>
      <Text>{audio.current?.work.title ?? "No playback"}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Listen"
        onPress={() =>
          void audio.controller.play({
            work: {
              artworkId: "one" as never,
              title: "First owner’s artwork",
              artist: "Artist",
              opening: "This is First owner’s artwork, by Artist. Its date is unknown.",
              savedId: "private-id",
              facts: [
                { id: "f1", sourceUrl: "https://museum.example/work", sourceLabel: "Museum" },
              ],
            },
          })
        }
      />
    </>
  );
}
it("clears private playback and pending synthesis when the owner changes without remounting navigation", async () => {
  const view = await render(
    <ListeningProvider>
      <Screen />
    </ListeningProvider>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Listen" }));
  expect(screen.getByText("First owner’s artwork")).toBeOnTheScreen();
  await act(async () => {
    mockOwner = "account:two";
  });
  await view.rerender(
    <ListeningProvider>
      <Screen />
    </ListeningProvider>,
  );
  expect(screen.getByText("No playback")).toBeOnTheScreen();
  expect(mockCancel).toHaveBeenCalled();
  expect(mockMounted).toHaveBeenCalledTimes(1);
});
