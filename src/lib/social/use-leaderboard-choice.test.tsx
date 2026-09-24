import { act, renderHook, waitFor } from "@testing-library/react-native";
import { getSetting, setSetting } from "@/db/repos/settings";
import { useLeaderboardChoice } from "./use-leaderboard-choice";

jest.mock("@/db/repos/settings", () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getSetting).mockResolvedValue(undefined);
  jest.mocked(setSetting).mockResolvedValue(undefined);
});

it("restores every filter after reopening the board", async () => {
  let saved: string | undefined;
  jest.mocked(getSetting).mockImplementation(async () => saved);
  jest.mocked(setSetting).mockImplementation(async (_key, value) => {
    saved = value;
  });
  const first = await renderHook(useLeaderboardChoice);
  await act(() => first.result.current.changeChoice({ audience: "global" }));
  await act(() => first.result.current.changeChoice({ metric: "artworks" }));
  await act(() => first.result.current.changeChoice({ period: "all" }));
  await first.unmount();
  const reopened = await renderHook(useLeaderboardChoice);
  await waitFor(() =>
    expect(reopened.result.current.choice).toEqual({
      audience: "global",
      metric: "artworks",
      period: "all",
    }),
  );
});

it("does not overwrite a new choice with a delayed stored value", async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getSetting).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = await renderHook(useLeaderboardChoice);
  await act(() => hook.result.current.changeChoice({ audience: "global" }));
  await act(() => resolve('{"audience":"friends"}'));
  expect(hook.result.current.choice.audience).toBe("global");
});

it("uses valid defaults for malformed stored preferences", async () => {
  jest.mocked(getSetting).mockResolvedValue("{broken");
  const hook = await renderHook(useLeaderboardChoice);
  expect(hook.result.current.choice).toEqual({
    audience: "friends",
    metric: "visits",
    period: "month",
  });
});

it("keeps browsing available when preferences cannot save", async () => {
  jest.mocked(setSetting).mockRejectedValue(new Error("disk full"));
  const hook = await renderHook(useLeaderboardChoice);
  await act(() => hook.result.current.changeChoice({ period: "all" }));
  expect(hook.result.current.choice.period).toBe("all");
  await waitFor(() =>
    expect(hook.result.current.error).toMatch(/could not be remembered/),
  );
});
