import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import type { Id } from "../../../../convex/_generated/dataModel";
import { CONTRIBUTION_MESSAGES, contributionMessage } from "./contribute-result";
import { ContributionStatus, SHARE_BUTTON } from "./contribution-status";

jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => true }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const onShare = jest.fn();
const contributionId = "contrib-1" as Id<"contributions">;
beforeEach(() => jest.clearAllMocks());

it("keeps a saved artwork available and offers retry after sharing fails", async () => {
  await render(<ContributionStatus sharing={false} shareError="No connection" onShare={onShare} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/Your artwork is saved/);
  await fireEvent.press(screen.getByRole("button", { name: SHARE_BUTTON }));
  expect(onShare).toHaveBeenCalledTimes(1);
});

it("shows a sharing retry's progress inside the retry button", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  await render(<ContributionStatus sharing shareError="No connection" onShare={onShare} />);
  expect(screen.getByRole("button", { name: SHARE_BUTTON })).toBeDisabled();
  expect(announce).toHaveBeenCalledWith(`${SHARE_BUTTON}. In progress.`);
  expect(screen.queryByRole("progressbar")).toBeNull();
  announce.mockRestore();
});

it("shows the contribution outcome without a retry once sharing succeeded", async () => {
  await render(
    <ContributionStatus sharing={false} shared={{ contributionId, status: "tentative" }} onShare={onShare} />,
  );
  expect(screen.queryByRole("button", { name: SHARE_BUTTON })).toBeNull();
  expect(
    screen.getByText("Saved to the shared index as a tentative match for other visitors at this museum."),
  ).toBeOnTheScreen();
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
