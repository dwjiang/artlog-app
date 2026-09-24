import { ImageManipulator } from "expo-image-manipulator";

import { loadLocalImage } from "./local-image";

jest.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate: jest.fn() } }));
const manipulate = jest.mocked(ImageManipulator.manipulate);
const source = { width: 4032, height: 3024, release: jest.fn() };
const result = { width: 2048, height: 1536, release: jest.fn() };
const resize = jest.fn();
const releaseSourceContext = jest.fn();
const releaseResizeContext = jest.fn();
const render = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  source.width = 4032;
  source.height = 3024;
  render.mockResolvedValue(result);
  const resized = { resize, renderAsync: render, release: releaseResizeContext };
  resize.mockReturnValue(resized);
  manipulate.mockReturnValueOnce({ renderAsync: async () => source, release: releaseSourceContext } as never);
  manipulate.mockReturnValueOnce(resized as never);
});

it("decodes and bounds a local image in memory, with no temporary output file", async () => {
  expect(await loadLocalImage("file:///photo.jpg", 2048)).toBe(result);
  expect(resize).toHaveBeenCalledWith({ width: 2048 });
  expect(source.release).toHaveBeenCalledTimes(1);
  expect(result.release).not.toHaveBeenCalled();
  expect(releaseSourceContext).toHaveBeenCalledTimes(1);
  expect(releaseResizeContext).toHaveBeenCalledTimes(1);
});

it("preserves a small image at its original size until its caller releases it", async () => {
  source.width = 300;
  source.height = 400;
  expect(await loadLocalImage("file:///crop.jpg", 2048)).toBe(source);
  expect(resize).not.toHaveBeenCalled();
  expect(source.release).not.toHaveBeenCalled();
  expect(releaseSourceContext).toHaveBeenCalledTimes(1);
});

it("releases decoded source memory when resizing fails", async () => {
  render.mockRejectedValue(new Error("Resize failed"));
  await expect(loadLocalImage("file:///photo.jpg", 2048)).rejects.toThrow("Resize failed");
  expect(source.release).toHaveBeenCalledTimes(1);
  expect(releaseResizeContext).toHaveBeenCalledTimes(1);
  expect(releaseSourceContext).toHaveBeenCalledTimes(1);
});
