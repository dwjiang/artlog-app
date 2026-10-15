import { Host, Image, Label, Menu, Section, Text, Toggle } from "@expo/ui/swift-ui";
import { accessibilityLabel, contentShape, foregroundStyle, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";

import { Gallery } from "@/constants/theme";
import type { ExploreData } from "@/lib/explore/types";
import { chooseCity } from "@/lib/explore/use-explore";
import { useMyLocationAction } from "@/lib/explore/use-my-location";

/**
 * The header's city chip, marked with the location arrow while Explore follows the phone. A UIKit bar item shows only
 * its image once it has one, so SwiftUI draws the chip to keep the arrow beside the city name.
 */
export function CityMenu({
  city,
  cities,
  following,
  home,
}: Pick<ExploreData, "city" | "cities" | "following" | "home">) {
  const myLocation = useMyLocationAction({ following, home });
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.View>
        <Host matchContents colorScheme="light">
          <Menu
            label={
              <Label
                title={city.name}
                systemImage={following ? "location.fill" : undefined}
                // Padding inside the label keeps the whole capsule tappable.
                modifiers={[padding({ horizontal: 12, vertical: 11 }), contentShape(shapes.rectangle())]}
              />
            }
            modifiers={[
              accessibilityLabel(following ? `City, ${city.name}, My Location` : `City, ${city.name}`),
              foregroundStyle(Gallery.ink),
            ]}
          >
            <Section>
              {/* A menu row reads its first text as the title, a second as the subtitle, and the image as its icon. */}
              <Toggle isOn={myLocation.isOn} onIsOnChange={myLocation.onPress}>
                <Text>{myLocation.label}</Text>
                {myLocation.subtitle ? <Text>{myLocation.subtitle}</Text> : null}
                <Image systemName={myLocation.icon} />
              </Toggle>
            </Section>
            <Section>
              {cities.map((option) => (
                <Toggle
                  key={option.id}
                  label={option.name}
                  isOn={!following && option.id === city.id}
                  onIsOnChange={() => chooseCity(option.id)}
                />
              ))}
            </Section>
          </Menu>
        </Host>
      </Stack.Toolbar.View>
    </Stack.Toolbar>
  );
}
