import { SocialState, StateScreen } from "@/components/social/social-state";
import type { ExploreView } from "@/lib/explore/use-explore";

/** What an Explore page shows until its city's shows arrive. */
export function ExploreState({ view }: { view: ExploreView }) {
  return (
    <StateScreen>
      <ExploreStateMessage view={view} />
    </StateScreen>
  );
}

/** The loading, offline, failure or empty message alone, for a page that keeps its own controls above it. */
export function ExploreStateMessage({
  view,
  subject = "exhibitions",
}: {
  view: Pick<ExploreView, "status" | "retry">;
  subject?: "exhibitions" | "museums";
}) {
  if (view.status === "offline") {
    return <SocialState title="You’re offline." detail={`Connect to see ${subject}.`} icon="wifi.slash" />;
  }
  if (view.status === "error") {
    return (
      <SocialState
        title={`Couldn’t load ${subject}.`}
        detail="Check your connection and try again."
        action="Try again"
        onAction={view.retry}
      />
    );
  }
  if (view.status === "empty") return <SocialState title="No exhibitions listed yet." icon="building.columns" />;
  return <SocialState title={`Loading ${subject}…`} loading />;
}
