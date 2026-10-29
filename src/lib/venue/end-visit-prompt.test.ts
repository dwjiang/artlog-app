import { Alert, type AlertButton } from "react-native";

import { withEndVisitPrompt } from "./end-visit-prompt";
import { VisitInProgressError } from "./use-venue";

jest.mock("./use-venue", () => {
  class MockVisitInProgressError extends Error {
    visit: { localId: string; venueName: string };
    constructor(visit: { localId: string; venueName: string }) {
      super("Another visit is open");
      this.visit = visit;
    }
  }
  return { VisitInProgressError: MockVisitInProgressError, venueController: { end: jest.fn() } };
});

const open = { localId: "met-visit", venueName: "The Met" } as ConstructorParameters<typeof VisitInProgressError>[0];
const controller = { end: jest.fn() };

function answer(text: string) {
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.text === text)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  controller.end.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it("asks before ending the open visit, then saves again so the save starts a new one", async () => {
  answer("End Visit");
  const save = jest.fn().mockRejectedValueOnce(new VisitInProgressError(open)).mockResolvedValueOnce("saved");
  await expect(withEndVisitPrompt(save, controller)).resolves.toBe("saved");
  expect(Alert.alert).toHaveBeenCalledWith(
    "End your visit to The Met?",
    "Only one visit can be open at a time. End it to start a new visit with this artwork.",
    expect.any(Array),
  );
  expect(controller.end).toHaveBeenCalledWith("met-visit");
  expect(save.mock.calls).toEqual([[false], [false]]);
});

it("saves again without a visit and leaves the open visit alone", async () => {
  answer("Save Artwork Only");
  const save = jest.fn().mockRejectedValueOnce(new VisitInProgressError(open)).mockResolvedValueOnce("saved");
  await expect(withEndVisitPrompt(save, controller)).resolves.toBe("saved");
  expect(save.mock.calls).toEqual([[false], [true]]);
  expect(controller.end).not.toHaveBeenCalled();
});

it("saves nothing when the person cancels", async () => {
  answer("Cancel");
  const save = jest.fn().mockRejectedValue(new VisitInProgressError(open));
  await expect(withEndVisitPrompt(save, controller)).resolves.toBeUndefined();
  expect(save).toHaveBeenCalledTimes(1);
  expect(controller.end).not.toHaveBeenCalled();
});

it("passes any other failure through without asking", async () => {
  answer("End Visit");
  const save = jest.fn().mockRejectedValue(new Error("SQLITE_BUSY"));
  await expect(withEndVisitPrompt(save, controller)).rejects.toThrow("SQLITE_BUSY");
  expect(Alert.alert).not.toHaveBeenCalled();
});
