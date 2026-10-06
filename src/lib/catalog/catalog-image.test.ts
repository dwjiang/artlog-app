import { pageSizedImage } from "./catalog-image";

describe("page-sized catalog pictures", () => {
  it("asks Commons for a larger standard width", () => {
    expect(
      pageSizedImage(
        "https://commons.wikimedia.org/wiki/Special:FilePath/Claude%20Monet%20-%20Water%20Lilies.jpg?width=330",
      ),
    ).toBe("https://commons.wikimedia.org/wiki/Special:FilePath/Claude%20Monet%20-%20Water%20Lilies.jpg?width=1280");
  });

  it.each(["https://images.metmuseum.org/CRDImages/ep/web-large/DT1567.jpg", "not a url"])("leaves %s alone", (url) => {
    expect(pageSizedImage(url)).toBe(url);
  });
});
