import { render, screen } from "@testing-library/react-native";

import { OpenSourceLicenses } from "./open-source-licenses";

it("lists each library with its version, license and notice", async () => {
  await render(
    <OpenSourceLicenses
      notices={{
        entries: [
          { name: "boost", license: "BSL-1.0", text: 1 },
          { name: "expo", version: "57.0.1", license: "MIT", text: 0 },
          { name: "metro-runtime", version: "0.84.5", license: "MIT", holder: "Meta", text: 0 },
        ],
        texts: ["Permission is hereby granted.", "Boost Software License"],
      }}
    />,
  );
  expect(screen.getByRole("header", { name: "expo" })).toBeOnTheScreen();
  expect(screen.getByText("57.0.1 · MIT")).toBeOnTheScreen();
  expect(screen.getByText("BSL-1.0")).toBeOnTheScreen();
  expect(screen.getByText("0.84.5 · MIT · Meta")).toBeOnTheScreen();
  expect(screen.getAllByText("Permission is hereby granted.")).toHaveLength(2);
  expect(screen.getByText("Boost Software License")).toBeOnTheScreen();
});
