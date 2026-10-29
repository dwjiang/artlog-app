import { render, screen } from "@testing-library/react-native";

import { PermissionAsk } from "./permission-ask";

it("explains Want to see's notifications as show reminders, without the friends framing", async () => {
  await render(<PermissionAsk kind="exhibitionReminders" />);
  expect(screen.getByRole("image", { name: "Notification permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Get show reminders." })).toBeOnTheScreen();
  expect(screen.getByText("Reminds you when a saved show opens and a week before it closes.")).toBeOnTheScreen();
  expect(screen.getByText("Choose which in Settings.")).toBeOnTheScreen();
  expect(screen.queryByText(/friend/i)).toBeNull();
});
