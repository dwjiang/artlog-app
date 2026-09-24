import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { DatabaseGate } from "./database-gate";
import { reportError } from "@/lib/observability";

const mockState: { success: boolean; error?: Error } = { success: false };

jest.mock("@/db/use-database-migrations", () => ({
  useDatabaseMigrations: () => mockState,
}));
jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function renderGate() {
  return render(
    <DatabaseGate>
      <Text>App ready</Text>
    </DatabaseGate>,
  );
}

it("holds the app until migrations finish", async () => {
  mockState.success = false;
  mockState.error = undefined;
  await renderGate();
  expect(screen.queryByText("App ready")).toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Opening your collection" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Opening your collection…")).toBeNull();
});

it("renders the app once the store is migrated", async () => {
  mockState.success = true;
  await renderGate();
  expect(screen.getByText("App ready")).toBeTruthy();
});

it("explains a migration failure instead of rendering the app", async () => {
  mockState.success = false;
  mockState.error = new Error("disk I/O error");
  await renderGate();
  expect(screen.getByText("Could not open the local database")).toBeTruthy();
  expect(screen.getByText("disk I/O error")).toBeTruthy();
  expect(screen.queryByText("App ready")).toBeNull();
  expect(reportError).toHaveBeenCalledWith(
    mockState.error,
    "database.initialize",
  );
});
