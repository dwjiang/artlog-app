/** The visit a save landed in: `started` opened it, `joined` added to the open one, `past` went to a visit on the books. */
export type CompletionVisit = {
  localId: string;
  venueName: string;
  startedAt: number | null;
  visitedOn: string;
  timeZone: string;
  outcome: "started" | "joined" | "past";
};

export type CaptureCompletion = {
  savedId: string;
  title: string;
  artist?: string | null;
  date?: string | null;
  medium?: string | null;
  previewPath: string | null;
  visit?: CompletionVisit;
};
