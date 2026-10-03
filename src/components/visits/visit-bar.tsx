import { Button, Column, Host, Icon, Row, Text } from "@expo/ui";
import {
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  contentShape,
  fixedSize,
  font,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import * as Sentry from "@sentry/react-native";
import { useRouter } from "expo-router";
import { useWindowDimensions } from "react-native";

import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useVenue } from "@/lib/venue/use-venue";

/** The bar's content height; screens that lay out under the accessory slot reserve this much, like the mini player's. */
export const VISIT_BAR_HEIGHT = 48;

export function VisitBar() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { visit, venue } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, useLocalOwner());
  if (!visit) return null;
  // Away from its museum the visit is paused, not over: only the person ends it.
  const here = visit.venueId === venue?.venueId;
  const count = loading || error ? undefined : `${works.length} ${works.length === 1 ? "artwork" : "artworks"}`;
  const detail = [here ? "Currently visiting" : "Visit open", count].filter(Boolean).join(" · ");
  return (
    <Sentry.Mask style={{ width: "100%" }}>
      <Host
        key={fontScale}
        matchContents={{ vertical: true }}
        ignoreSafeArea="all"
        colorScheme="light"
        seedColor={Gallery.accent}
        style={{ width: "100%" }}
      >
        <Row
          alignment="center"
          spacing={10}
          style={{ paddingHorizontal: 12 }}
          modifiers={[frame({ minHeight: VISIT_BAR_HEIGHT })]}
        >
          <Button
            variant="text"
            onPress={() =>
              router.push({
                pathname: "/journal/[visitId]",
                params: { visitId: visit.localId },
              })
            }
            modifiers={[
              accessibilityLabel(here ? `Visiting ${visit.venueName}` : `Visit open at ${visit.venueName}`),
              accessibilityValue(
                [formatVisitStart(visit.startedAt, visit.timeZone), count].filter(Boolean).join(" · "),
              ),
              accessibilityHint("Opens the current visit"),
              frame({ maxWidth: Infinity, alignment: "leading" }),
            ]}
          >
            <Row
              alignment="center"
              spacing={10}
              modifiers={[
                frame({ minHeight: 44, maxWidth: Infinity, alignment: "leading" }),
                contentShape(shapes.rectangle()),
              ]}
            >
              <Icon name="building.columns.fill" size={22} color={Gallery.accent} />
              <Column spacing={1} alignment="start">
                <Text
                  numberOfLines={1}
                  textStyle={{ color: Gallery.ink }}
                  modifiers={[font({ textStyle: "subheadline", weight: "semibold" })]}
                >
                  {visit.venueName}
                </Text>
                <Text
                  numberOfLines={1}
                  textStyle={{ color: Gallery.muted }}
                  modifiers={[font({ textStyle: "caption" })]}
                >
                  {detail}
                </Text>
              </Column>
            </Row>
          </Button>
          <Button
            variant="text"
            onPress={() =>
              router.push({
                pathname: "/journal/[visitId]",
                params: { visitId: visit.localId, endVisit: "true" },
              })
            }
            modifiers={[
              accessibilityLabel("End visit"),
              accessibilityHint("Opens a review before saving and ending the visit"),
              fixedSize({ horizontal: true, vertical: true }),
            ]}
          >
            <Row
              alignment="center"
              modifiers={[frame({ minHeight: 44, minWidth: 44 }), contentShape(shapes.rectangle())]}
            >
              <Text textStyle={{ color: Gallery.accent }} modifiers={[font({ textStyle: "subheadline" })]}>
                End visit
              </Text>
            </Row>
          </Button>
        </Row>
      </Host>
    </Sentry.Mask>
  );
}
