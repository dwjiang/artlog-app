import * as Sentry from "@sentry/react-native";
import { renderHook } from "@testing-library/react-native";

import { useVisitDetailDiagnostics } from "./use-visit-detail-diagnostics";

let mockFocused = true;
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));

beforeEach(() => {
  mockFocused = true;
  jest.mocked(Sentry.addBreadcrumb).mockReset();
});

it("records loading and ready snapshots with bounded counts, not visit content", async () => {
  const { rerender } = await renderHook(useVisitDetailDiagnostics, {
    initialProps: { state: "loading", endReview: false } as Parameters<typeof useVisitDetailDiagnostics>[0],
  });
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith({
    category: "app",
    message: "visit.detail.snapshot",
    level: "info",
    data: { render_state: "loading", work_count: null, end_review: false },
  });
  const ready = {
    state: "ready" as const,
    workCount: 10_000,
    endReview: true,
    visitId: "private-visit",
    reflection: "private reflection",
    title: "private artwork",
  };
  await rerender(ready);
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith({
    category: "app",
    message: "visit.detail.snapshot",
    level: "info",
    data: { render_state: "ready", work_count: 500, end_review: true },
  });
  expect(JSON.stringify(jest.mocked(Sentry.addBreadcrumb).mock.calls)).not.toMatch(/private|visitId|reflection|title/);
});

it("deduplicates unchanged snapshots and stops after eight updates while focused", async () => {
  const { rerender } = await renderHook(useVisitDetailDiagnostics, {
    initialProps: { state: "ready" as const, workCount: 1, endReview: false },
  });
  await rerender({ state: "ready", workCount: 1, endReview: false });
  expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  for (let workCount = 2; workCount <= 20; workCount++) {
    await rerender({ state: "ready", workCount, endReview: false });
  }
  expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(8);
});

it("stops on blur, resumes with current data on refocus, and marks unmount", async () => {
  const props = { state: "ready" as const, workCount: 1, endReview: false };
  const { rerender, unmount } = await renderHook(useVisitDetailDiagnostics, { initialProps: props });
  mockFocused = false;
  await rerender(props);
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(expect.objectContaining({ message: "visit.detail.left" }));
  jest.mocked(Sentry.addBreadcrumb).mockClear();
  await rerender({ ...props, workCount: 5 });
  expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  mockFocused = true;
  await rerender({ ...props, workCount: 5 });
  expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: { render_state: "ready", work_count: 5, end_review: false } }),
  );
  await unmount();
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(expect.objectContaining({ message: "visit.detail.left" }));
});

it.each([NaN, Infinity, -10])("normalizes invalid counts (%s)", async (workCount) => {
  await renderHook(useVisitDetailDiagnostics, { initialProps: { state: "ready", workCount, endReview: false } });
  expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ work_count: 0 }) }),
  );
});

it("cannot break navigation when telemetry is unavailable", async () => {
  jest.mocked(Sentry.addBreadcrumb).mockImplementation(() => {
    throw new Error("SDK unavailable");
  });
  const { unmount } = await renderHook(useVisitDetailDiagnostics, {
    initialProps: { state: "error", endReview: false },
  });
  await expect(unmount()).resolves.toBeUndefined();
});
