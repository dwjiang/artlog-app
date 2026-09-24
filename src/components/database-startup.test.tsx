import { render, screen } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { Text } from "react-native";

import { db } from "@/db/client";
import { savedWorks } from "@/db/schema";
import { reportError } from "@/lib/observability";

import { DatabaseGate } from "./database-gate";

const mockMigrationState = { success: false };

jest.mock("drizzle-orm/expo-sqlite/migrator", () => ({
  useMigrations: () => mockMigrationState,
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
  describeDatabase: jest.fn(),
}));
jest.mock("@/lib/installation-storage", () => ({
  getInstallationId: () => "test-installation",
}));
jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function Collection() {
  const work = db.select().from(savedWorks).get();
  return <Text>Photo timestamp: {work?.photoUpdatedAt}</Text>;
}

function App() {
  return (
    <DatabaseGate>
      <Collection />
    </DatabaseGate>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMigrationState.success = false;
  db.run(sql`BEGIN`);
  db.run(sql`ALTER TABLE savedWorks DROP COLUMN photoUpdatedAt`);
  db.run(sql`INSERT INTO savedWorks (owner, localId, savedAt, title, artist)
    VALUES ('device:test-installation', 'work', 1, 'Test painting', 'Test artist')`);
});

afterEach(() => {
  jest.restoreAllMocks();
  db.run(sql`ROLLBACK`);
});

it("repairs the missing column before database consumers mount", async () => {
  const view = await render(<App />);
  expect(screen.getByRole("progressbar", { name: "Opening your collection" })).toBeOnTheScreen();

  mockMigrationState.success = true;
  await view.rerender(<App />);

  expect(screen.getByText("Photo timestamp: 0")).toBeOnTheScreen();
  expect(reportError).not.toHaveBeenCalled();
});

it("reports a failed repair and keeps database consumers behind the gate", async () => {
  const error = new Error("disk I/O error");
  jest.spyOn(db, "run").mockImplementationOnce(() => {
    throw error;
  });
  mockMigrationState.success = true;

  await render(<App />);

  expect(screen.getByText("Could not open the local database")).toBeOnTheScreen();
  expect(screen.queryByText(/Photo timestamp:/)).toBeNull();
  expect(reportError).toHaveBeenCalledWith(error, "database.initialize");
  expect(db.get(sql`SELECT title FROM savedWorks`)).toEqual({ title: "Test painting" });
});
