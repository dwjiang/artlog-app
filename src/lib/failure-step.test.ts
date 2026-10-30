import { failureDetails, tagFailure } from "./failure-step";

it("keeps the innermost step that tagged an error, without changing the error", () => {
  const error = new Error("Disk full");
  tagFailure(error, { step: "copy_files" });
  tagFailure(error, { step: "save" });
  expect(failureDetails(error)).toEqual({ step: "copy_files" });
  expect(Object.keys(error)).toEqual([]);
});

it("has nothing for untagged or non-object errors", () => {
  tagFailure("text failure", { step: "save" });
  expect(failureDetails("text failure")).toBeUndefined();
  expect(failureDetails(new Error("other"))).toBeUndefined();
});
