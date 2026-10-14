import * as settings from "@/db/repos/settings";

import { answerSafetyChecks, SAFETY_CHECKS_SETTING } from "./safety-checks-answer";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const mockMutation = jest.fn();
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

beforeEach(async () => {
  jest.restoreAllMocks();
  mockMutation.mockReset().mockResolvedValue(true);
  await settings.removeSetting(SAFETY_CHECKS_SETTING);
});

it.each([true, false])("keeps a guest's answer %s locally until sign-in", async (enabled) => {
  await answerSafetyChecks(enabled, false);
  expect(await settings.getSetting(SAFETY_CHECKS_SETTING)).toBe(enabled ? "on" : "off");
  expect(mockMutation).not.toHaveBeenCalled();
});

it("rejects a failed signed-in opt-out so the caller can offer an explicit retry", async () => {
  const failure = new Error("Consent write failed");
  mockMutation.mockRejectedValueOnce(failure);
  await expect(answerSafetyChecks(false, true)).rejects.toBe(failure);
  expect(await settings.getSetting(SAFETY_CHECKS_SETTING)).toBeUndefined();

  await answerSafetyChecks(false, true);
  expect(mockMutation).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
  expect(await settings.getSetting(SAFETY_CHECKS_SETTING)).toBeUndefined();
});

it("does not leave a signed-in answer for another account if the app exits during its upload", async () => {
  let finish!: (enabled: boolean) => void;
  mockMutation.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
  const answer = answerSafetyChecks(true, true);
  await Promise.resolve();
  expect(await settings.getSetting(SAFETY_CHECKS_SETTING)).toBeUndefined();
  finish(true);
  await answer;
});
