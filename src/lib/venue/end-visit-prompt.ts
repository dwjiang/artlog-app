import { Alert } from "react-native";

import { venueController, VisitInProgressError, type VenueController } from "./use-venue";

type Answer = "end" | "withoutVisit" | "cancel";

function askToEndVisit(venueName: string): Promise<Answer> {
  return new Promise((resolve) => {
    Alert.alert(
      `End your visit to ${venueName}?`,
      "Only one visit can be open at a time. End it to start a new visit with this artwork.",
      [
        { text: "End Visit", onPress: () => resolve("end") },
        { text: "Save Artwork Only", onPress: () => resolve("withoutVisit") },
        { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
      ],
    );
  });
}

/**
 * Runs a save that may start a visit. While another visit is open, the person ends it and the save starts a new one,
 * saves again with `withoutVisit` set, or cancels, which resolves undefined.
 */
export async function withEndVisitPrompt<T>(
  save: (withoutVisit: boolean) => Promise<T>,
  controller: Pick<VenueController, "end"> = venueController,
): Promise<T | undefined> {
  let withoutVisit = false;
  for (;;) {
    try {
      return await save(withoutVisit);
    } catch (cause) {
      if (!(cause instanceof VisitInProgressError)) throw cause;
      const answer = await askToEndVisit(cause.visit.venueName);
      if (answer === "cancel") return undefined;
      if (answer === "end") await controller.end(cause.visit.localId);
      else withoutVisit = true;
    }
  }
}
