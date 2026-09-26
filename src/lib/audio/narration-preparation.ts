export type NarrationPreparationStage = "preparing" | "generating" | "downloading" | "buffering";

export function preparationLabel(stage: NarrationPreparationStage = "preparing") {
  switch (stage) {
    case "preparing":
      return "Preparing narration…";
    case "generating":
      return "Generating narration…";
    case "downloading":
      return "Downloading audio…";
    case "buffering":
      return "Starting audio…";
  }
}
