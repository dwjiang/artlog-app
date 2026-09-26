import { act, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { VisitSummary } from "@/lib/journal/visit-summaries";

import { VisitDetailsFields } from "./visit-details-fields";

jest.mock("./visit-date-picker", () => ({
  VisitDateField: ({ latest }: { latest: string }) => {
    const React = jest.requireActual("react");
    const { Text } = jest.requireActual("react-native");
    return React.createElement(Text, null, `Latest visit date: ${latest}`);
  },
}));

const visit = {
  venueName: "Museum",
  timeZone: "America/Los_Angeles",
  visitedOn: "2026-09-24",
} as VisitSummary;
const props = {
  visit,
  visibility: "private" as const,
  disabled: false,
  visibilityDisabled: false,
  onMuseum: jest.fn(),
  onDate: jest.fn(),
  onVisibility: jest.fn(),
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-26T06:59:59Z"));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("allows the new day when midnight passes at the museum", async () => {
  await render(<VisitDetailsFields {...props} />);
  expect(screen.getByText("Latest visit date: 2026-09-25")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByText("Latest visit date: 2026-09-26")).toBeOnTheScreen();
});

it("refreshes the date when returning after suspended background timers", async () => {
  let changeState!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    changeState = callback;
    return { remove };
  });
  const view = await render(<VisitDetailsFields {...props} />);
  await act(() => changeState?.("background"));
  jest.setSystemTime(new Date("2026-09-27T18:00:00Z"));
  await act(() => changeState?.("active"));
  expect(screen.getByText("Latest visit date: 2026-09-27")).toBeOnTheScreen();
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("uses the newly selected museum's timezone for the date limit", async () => {
  const view = await render(<VisitDetailsFields {...props} />);
  expect(screen.getByText("Latest visit date: 2026-09-25")).toBeOnTheScreen();
  await view.rerender(<VisitDetailsFields {...props} visit={{ ...visit, timeZone: "Asia/Tokyo" }} />);
  expect(screen.getByText("Latest visit date: 2026-09-26")).toBeOnTheScreen();
});
