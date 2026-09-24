import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Id } from "../../../../convex/_generated/dataModel";
import { CONTRIBUTION_MESSAGES, contributionMessage } from "./contribute-result";
import { LabelActions, SHARE_BUTTON } from "./label-actions";

jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => true }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const handlers = {
  onSave: jest.fn(),
  onShare: jest.fn(),
  onViewSaved: jest.fn(),
};
const contributionId = "contrib-1" as Id<"contributions">;
beforeEach(() => jest.clearAllMocks());

it("explains automatic sharing before saving and gates saving on a title", async () => {
  const view = await render(<LabelActions canSave saving={false} sharing={false} {...handlers} />);
  expect(screen.getByText(/Also saves the confirmed label/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: SHARE_BUTTON })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Confirm & save" }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  await view.rerender(<LabelActions canSave={false} saving={false} sharing={false} {...handlers} />);
  expect(screen.getByRole("button", { name: "Confirm & save" })).toBeDisabled();
});

it("keeps a saved artwork available and offers retry after sharing fails", async () => {
  await render(
    <LabelActions canSave saving={false} sharing={false} savedId="saved-1" shareError="No connection" {...handlers} />,
  );
  expect(screen.getByRole("link", { name: "Saved · View in collection" })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/Your artwork is saved/);
  await fireEvent.press(screen.getByRole("button", { name: SHARE_BUTTON }));
  expect(handlers.onShare).toHaveBeenCalledTimes(1);
});

it("replaces the buttons with the saved link and the contribution outcome", async () => {
  await render(
    <LabelActions
      canSave
      saving={false}
      sharing={false}
      savedId="saved-1"
      shared={{ contributionId, status: "tentative" }}
      {...handlers}
    />,
  );
  expect(screen.queryByRole("button", { name: "Confirm & save" })).toBeNull();
  expect(screen.queryByRole("button", { name: SHARE_BUTTON })).toBeNull();
  expect(screen.queryByText("stale")).toBeNull();
  expect(
    screen.getByText("Saved to the shared index as a tentative match for other visitors at this museum."),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Saved · View in collection" }));
  expect(handlers.onViewSaved).toHaveBeenCalledTimes(1);
});

it("words every contribution outcome", () => {
  expect(
    contributionMessage({
      contributionId,
      status: "rejected",
      reason: "duplicate",
    }),
  ).toBe(CONTRIBUTION_MESSAGES.duplicate);
  expect(contributionMessage({ contributionId, status: "rejected" })).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(
    contributionMessage({
      contributionId,
      status: "rejected",
      reason: "device_reverted",
    }),
  ).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(
    contributionMessage({
      contributionId,
      status: "rejected",
      reason: "object_reverted",
    }),
  ).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(contributionMessage({ contributionId, status: "tentative" })).toBe(CONTRIBUTION_MESSAGES.tentative);
});
