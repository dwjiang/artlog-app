import { render, screen } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { Text } from "react-native";

import { db } from "@/db/client";
import { bundledMigrationCount } from "@/db/migrate-database";
import { savedWorks } from "@/db/schema";
import { createTestDatabase } from "@/db/test-db";
import { reportError } from "@/lib/observability";

import { DatabaseGate } from "./database-gate";

let mockDb: ReturnType<typeof createTestDatabase>;

jest.mock("@/db/client", () => ({
  get db() {
    return mockDb;
  },
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
  mockDb = createTestDatabase();
  db.run(sql`ALTER TABLE savedWorks DROP COLUMN photoUpdatedAt`);
  db.run(sql`INSERT INTO savedWorks (owner, localId, savedAt, title, artist)
    VALUES ('device:test-installation', 'work', 1, 'Test painting', 'Test artist')`);
});

afterEach(() => {
  jest.restoreAllMocks();
  mockDb.$client.close();
});

it("repairs the missing column before database consumers mount", async () => {
  await render(<App />);

  expect(screen.getByText("Photo timestamp: 0")).toBeOnTheScreen();
  expect(reportError).not.toHaveBeenCalled();
});

it("keeps consumers behind the gate after a failed repair and recovers on relaunch without losing the collection", async () => {
  const error = new Error("disk I/O error");
  jest.spyOn(db, "run").mockImplementationOnce(() => {
    throw error;
  });
  const view = await render(<App />);

  expect(screen.getByText("Could not open the local database")).toBeOnTheScreen();
  expect(screen.queryByText(/Photo timestamp:/)).toBeNull();
  expect(reportError).toHaveBeenCalledWith(error, "database.initialize", {
    data: {
      step: "photo_timestamp",
      applied_migrations: bundledMigrationCount,
      bundled_migrations: bundledMigrationCount,
    },
  });
  expect(db.get(sql`SELECT title FROM savedWorks`)).toEqual({ title: "Test painting" });

  const ledger = db.all(sql`SELECT * FROM __drizzle_migrations`);
  await view.unmount();
  await render(<App />);

  expect(screen.getByText("Photo timestamp: 0")).toBeOnTheScreen();
  expect(db.get(sql`SELECT title FROM savedWorks`)).toEqual({ title: "Test painting" });
  expect(db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual(ledger);
  expect(reportError).toHaveBeenCalledTimes(1);
});
