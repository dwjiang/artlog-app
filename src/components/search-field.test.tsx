import { fireEvent, render, screen } from "@testing-library/react-native";

import { SearchField } from "./search-field";

it("keeps a visible search label while entering and clearing a filter", async () => {
  const onChange = jest.fn();
  const onClear = jest.fn();
  await render(<SearchField label="Search artworks" value="" onChange={onChange} onClear={onClear} />);
  expect(screen.getByText("Search artworks")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Search artworks"), "Monet");
  expect(onChange).toHaveBeenCalledWith("Monet");

  await screen.rerender(<SearchField label="Search artworks" value="Monet" onChange={onChange} onClear={onClear} />);
  expect(screen.getByText("Search artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

it("blocks clearing while a search is disabled", async () => {
  const onClear = jest.fn();
  await render(
    <SearchField label="Find saved artwork" value="Monet" editable={false} onChange={jest.fn()} onClear={onClear} />,
  );

  const clear = screen.getByRole("button", { name: "Clear search" });
  expect(clear).toBeDisabled();
  await fireEvent.press(clear);
  expect(onClear).not.toHaveBeenCalled();
});
