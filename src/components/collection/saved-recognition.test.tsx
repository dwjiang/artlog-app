import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import type { SavedWork } from "@/db/schema";
import { identifySavedArtwork, acceptSavedRecognition } from "@/lib/collection/saved-recognition";

import type { Id } from "../../../convex/_generated/dataModel";
import { SavedRecognition } from "./saved-recognition";

jest.mock("@/lib/collection/saved-recognition", () => ({
  identifySavedArtwork: jest.fn(),
  acceptSavedRecognition: jest.fn(),
  savedRecognitionError: () => "Connect to the internet and try identifying again.",
}));
const work = { owner: "device:mine", localId: "saved", title: "Unidentified artwork" } as SavedWork;
const onAccepted = jest.fn();
const onBusyChange = jest.fn();
const result = {
  attempt: 2,
  outcome: "soft",
  candidates: [
    {
      objectId: "object" as Id<"objects">,
      artworkId: "artwork" as Id<"artworks">,
      title: "Water Lilies",
      artist: "Claude Monet",
      date: "1916",
      probability: 0.7,
      identityStatus: "established",
      rightsStatus: "public_domain",
    },
  ],
} as const;
const element = () => (
  <SavedRecognition work={work} disabled={false} onBusyChange={onBusyChange} onAccepted={onAccepted} />
);

beforeEach(() => jest.resetAllMocks());

it("searches only on request and applies only the match the person chooses", async () => {
  jest.mocked(identifySavedArtwork).mockResolvedValue({ ...result, candidates: [...result.candidates] });
  jest.mocked(acceptSavedRecognition).mockResolvedValue(true);
  await render(element());
  expect(identifySavedArtwork).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  expect(await screen.findByText("Water Lilies")).toBeOnTheScreen();
  expect(acceptSavedRecognition).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Use this match: Water Lilies, Claude Monet" }));
  expect(acceptSavedRecognition).toHaveBeenCalledWith(work, 2, "object");
  expect(onAccepted).toHaveBeenCalledTimes(1);
});

it("keeps the retry control after a miss or recoverable failure", async () => {
  jest
    .mocked(identifySavedArtwork)
    .mockResolvedValueOnce({ attempt: 1, outcome: "miss", candidates: [] })
    .mockRejectedValueOnce(new Error("Network request failed"));
  await render(element());
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  expect(await screen.findByText("No match found yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  expect(await screen.findByText("Connect to the internet and try identifying again.")).toBeOnTheScreen();
  expect(onAccepted).not.toHaveBeenCalled();
});

it("prevents duplicate searches and ignores a response after the screen closes", async () => {
  let resolve!: (value: null) => void;
  jest.mocked(identifySavedArtwork).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await render(element());
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  expect(identifySavedArtwork).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => resolve(null));
  expect(onAccepted).not.toHaveBeenCalled();
});

it("shows progress only on the match being applied", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  // `resetAllMocks` clears the preset stubs the busy spinner's reduced-motion hook relies on.
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
  const other = { ...result.candidates[0], objectId: "other" as Id<"objects">, title: "Haystacks" };
  jest.mocked(identifySavedArtwork).mockResolvedValue({ ...result, candidates: [...result.candidates, other] });
  jest.mocked(acceptSavedRecognition).mockReturnValue(new Promise(() => {}));
  await render(element());
  await fireEvent.press(screen.getByRole("button", { name: "Try identifying again" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Use this match: Haystacks, Claude Monet" }));
  expect(announce).toHaveBeenCalledWith("Use this match: Haystacks, Claude Monet. In progress.");
  expect(announce).not.toHaveBeenCalledWith("Use this match: Water Lilies, Claude Monet. In progress.");
});
