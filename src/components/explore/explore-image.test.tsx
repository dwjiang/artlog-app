import { fireEvent, render, screen } from "@testing-library/react-native";

import { Radius } from "@/constants/theme";

import { ExploreImage, HeaderPhoto, LINK_PREVIEW_ASPECT } from "./explore-image";

const load = (label: string, width: number, height: number) =>
  fireEvent(screen.getByLabelText(label), "load", { nativeEvent: { source: { width, height } } });
// The picture draws in LoadingImage's view, inside a rounded clip at the drawn picture's size, inside the box the page
// lays out.
const pictureOf = (label: string) => screen.getByLabelText(label).parent;
const drawnOf = (label: string) => pictureOf(label)?.parent;
const boxOf = (label: string) => drawnOf(label)?.parent;

it("gives a show's page the shape its picture had in the list it was opened from", async () => {
  const uri = "https://museum.example/garuda.jpg";
  await render(<ExploreImage image={{ uri, label: "Garuda in Bali" }} style={{ width: 80, height: 80 }} />);
  await load("Garuda in Bali", 1800, 1000);

  await render(<HeaderPhoto uri={uri} label="Garuda" width={360} fallbackAspect={LINK_PREVIEW_ASPECT} />);
  expect(boxOf("Garuda")).toHaveStyle({ width: 360, height: 200 });
  expect(drawnOf("Garuda")).toHaveStyle({ width: 360, height: 200, borderRadius: Radius.card });

  await load("Garuda", 1800, 1000);
  expect(boxOf("Garuda")).toHaveStyle({ width: 360, height: 200 });
  expect(drawnOf("Garuda")).toHaveStyle({ width: 360, height: 200, borderRadius: Radius.card });
});

it.each([
  { shape: "narrower", size: [1000, 1000], drawn: { width: 200, height: 200 } },
  { shape: "wider", size: [4000, 1000], drawn: { width: 382, height: 95.5 } },
])(
  "keeps a $shape picture's box at the shape it opened with, showing the picture whole with rounded corners",
  async ({ size: [width, height], drawn }) => {
    const label = `Show ${width}x${height}`;
    await render(
      <HeaderPhoto
        uri={`https://museum.example/${width}x${height}.jpg`}
        label={label}
        width={382}
        fallbackAspect={1.91}
      />,
    );
    expect(drawnOf(label)).toHaveStyle({ width: 382, height: 200, borderRadius: Radius.card });

    await load(label, width, height);

    expect(boxOf(label)).toHaveStyle({ width: 382, height: 200 });
    expect(drawnOf(label)).toHaveStyle({ ...drawn, borderRadius: Radius.card });
    // expo-image loads a picture again whenever its view is resized.
    expect(pictureOf(label)).toHaveStyle({ width: 382, height: 200 });
  },
);
