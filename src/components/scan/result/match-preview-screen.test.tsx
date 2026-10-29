import { fireEvent, render, screen } from "@testing-library/react-native";

import { storeMatchPreview } from "@/lib/result/match-preview";

import { bridge, haystacks } from "./__fixtures__/scan";
import { CHOOSE_MATCH, MatchPreviewScreen } from "./match-preview-screen";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));

beforeEach(() => jest.clearAllMocks());

const photoUri = "file:///crops/c1.jpg";

it("puts the owner's photo above the museum image with the work's details, choosing nothing until asked", async () => {
  const onChoose = jest.fn();
  await render(<MatchPreviewScreen previewId={storeMatchPreview({ candidate: bridge, photoUri, onChoose })} />);
  expect(screen.getByLabelText("Your photo of this painting").props.source).toEqual([{ uri: photoUri }]);
  expect(screen.getByLabelText("Museum image of The Japanese Footbridge").props.source).toEqual([
    { uri: "https://images.example/bridge.jpg" },
  ]);
  // The labels repeat the images' own accessibility labels, so VoiceOver skips them.
  expect(screen.getByText("Your photo", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByText("Museum image", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByText("Museum image")).toBeNull();
  expect(screen.getByLabelText("Possible match, 31% confidence")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "The Japanese Footbridge" })).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · 1899")).toBeOnTheScreen();
  expect(screen.getByText("National Gallery of Art")).toBeOnTheScreen();
  expect(onChoose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: CHOOSE_MATCH }));
  expect(onChoose).toHaveBeenCalledWith(bridge);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("names a visitor's photo as the source of a tentative match", async () => {
  const tentative = { ...bridge, identityStatus: "tentative" as const };
  await render(
    <MatchPreviewScreen previewId={storeMatchPreview({ candidate: tentative, photoUri, onChoose: jest.fn() })} />,
  );
  expect(screen.getByText("Visitor photo", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByLabelText("Visitor photo of The Japanese Footbridge")).toBeOnTheScreen();
  expect(screen.getByText("Shared by a visitor. Label not independently confirmed.")).toBeOnTheScreen();
});

it("shows a placeholder instead of the pair when the work has no public-domain image", async () => {
  await render(
    <MatchPreviewScreen previewId={storeMatchPreview({ candidate: haystacks, photoUri, onChoose: jest.fn() })} />,
  );
  expect(screen.getByText("No public-domain image")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Your photo of this painting")).toBeNull();
  expect(screen.getByRole("button", { name: CHOOSE_MATCH })).toBeOnTheScreen();
});

it("shows the museum image alone when there is no photo of the painting to compare", async () => {
  await render(<MatchPreviewScreen previewId={storeMatchPreview({ candidate: bridge, onChoose: jest.fn() })} />);
  expect(screen.getByLabelText("Museum image of The Japanese Footbridge")).toBeOnTheScreen();
  expect(screen.queryByText("Museum image", { includeHiddenElements: true })).toBeNull();
});

it("offers a way back when the preview it was opened for is gone", async () => {
  const stale = storeMatchPreview({ candidate: bridge, photoUri, onChoose: jest.fn() });
  storeMatchPreview({ candidate: haystacks, photoUri, onChoose: jest.fn() });
  await render(<MatchPreviewScreen previewId={stale} />);
  expect(screen.getByText("This match is no longer open.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: CHOOSE_MATCH })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
