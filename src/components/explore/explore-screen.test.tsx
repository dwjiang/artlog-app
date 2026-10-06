import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { toggleWantToSee } from "@/lib/explore/plans";

import { ExhibitionListScreen } from "./exhibition-list-screen";
import { ExploreScreen } from "./explore-screen";
import { WantToSeeScreen } from "./want-to-see-screen";

const mockPush = jest.fn();
let mockParams: { timing?: string } = {};

jest.mock("expo-router", () => {
  const { mockStack } = jest.requireActual("@/components/stack-toolbar-mock");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams,
    Stack: mockStack,
  };
});
// The heading menu draws its label as the trigger; the shared mock's Menu drops it.
jest.mock("@expo/ui/swift-ui", () => {
  const { View } = jest.requireActual("react-native");
  return {
    ...jest.requireActual("@/__mocks__/@expo/ui/swift-ui"),
    Menu: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
      <View>
        {label}
        {children}
      </View>
    ),
  };
});

const card = (title: string) => screen.queryByRole("button", { name: new RegExp(`^${title}, .*(Museum|Institute)`) });

beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
});

describe("Explore", () => {
  it("switches only the exhibitions row from its heading menu", async () => {
    await render(<ExploreScreen />);
    expect(card("Hokusai: Views of Mount Fuji")).toBeOnTheScreen();
    expect(card("Utamaro and the Floating World")).toBeOnTheScreen();
    expect(card("Kandinsky: Painting Music")).toBeNull();

    await fireEvent.press(screen.getByRole("checkbox", { name: "Opening soon" }));

    expect(screen.getByText("Opening soon")).toBeOnTheScreen();
    expect(card("Kandinsky: Painting Music")).toBeOnTheScreen();
    expect(card("Mary Cassatt at Home")).toBeOnTheScreen();
    expect(card("Utamaro and the Floating World")).toBeNull();
    // Friends want to see and the museums keep their content.
    expect(
      screen.getByRole("button", { name: /^Hokusai: Views of Mount Fuji, Ends in 8 days, Maya/ }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Art Institute of Chicago, 0.6 mi/ })).toBeOnTheScreen();
  });

  it("opens the full list with the row's choice", async () => {
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Just opened" }));
    await fireEvent.press(screen.getByRole("button", { name: "See all: Just opened" }));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/exhibitions", params: { timing: "opened" } });
  });

  it("opens the map, Want to see and a show from the page", async () => {
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    await fireEvent.press(screen.getByRole("button", { name: "Want to see" }));
    await fireEvent.press(card("Hokusai: Views of Mount Fuji")!);

    expect(mockPush.mock.calls).toEqual([
      ["/explore-map"],
      ["/want-to-see"],
      [{ pathname: "/exhibition/[exhibitionId]", params: { exhibitionId: "hokusai" } }],
    ]);
  });
});

describe("Exhibitions list", () => {
  it("starts on the timing Explore passed and switches with its menu", async () => {
    mockParams = { timing: "upcoming" };
    await render(<ExhibitionListScreen />);
    expect(screen.getByRole("button", { name: /^Kandinsky: Painting Music, Opens/ })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Hokusai/ })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Ending soon" }));

    expect(screen.getByRole("button", { name: /^Hokusai: Views of Mount Fuji, Ends in 8 days/ })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Kandinsky/ })).toBeNull();
  });
});

describe("Want to see", () => {
  it("lists saved shows until they are removed", async () => {
    await render(<WantToSeeScreen />);
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();

    await act(() => toggleWantToSee("monet"));
    expect(screen.getByRole("button", { name: /^Monet and the Water Garden, Until/ })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Remove Monet and the Water Garden from Want to see" }));
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();
  });
});
