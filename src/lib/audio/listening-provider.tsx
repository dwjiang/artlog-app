import { useAction } from "convex/react";
import { useEffect, useMemo, type ReactNode } from "react";

import { useLocalOwner } from "@/lib/account/owner-store";

import { api } from "../../../convex/_generated/api";
import { ListeningController } from "./listening-controller";
import { createNarrationPlayer } from "./narration-player";
import { createNarrationRenderer } from "./narration-renderer";
import { configureSpokenAudio } from "./spoken-audio-mode";
import { ListeningContext } from "./use-listening";

export function ListeningProvider({ children }: { children: ReactNode }) {
  const owner = useLocalOwner();
  const generate = useAction(api.narration.render);
  const session = useMemo(
    () => ({
      owner,
      controller: new ListeningController({
        ...createNarrationRenderer(generate),
        create: createNarrationPlayer,
        configure: configureSpokenAudio,
      }),
    }),
    [owner, generate],
  );
  useEffect(() => () => session.controller.dispose(), [session]);
  return <ListeningContext value={session.controller}>{children}</ListeningContext>;
}
