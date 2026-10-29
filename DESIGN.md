---
name: Artlog Index
description: A personal art journal with Space Grotesk headings, native SF Pro body text, and ultramarine actions on white.
omitted:
  - section: colors
    reason: "Token values are defined in src/constants/theme.ts"
  - section: typography
    reason: "Token values are defined in src/constants/theme.ts"
  - section: rounded
    reason: "Token values are defined in src/constants/theme.ts"
  - section: spacing
    reason: "Token values are defined in src/constants/theme.ts"
  - section: components
    reason: "Component styling and behavior are defined in code under src/components"
---

# Artlog Index

## Overview

Artlog records artworks and visits in a personal collection. It is an iPhone
app in light mode only, in portrait and landscape. The interface is calm, spacious, and typographic, with dark ink on white,
ultramarine actions, and pale blue selection accents. Artwork supplies the visual detail, so chrome stays quiet: content
rows and thin dividers give structure, and white cards appear only where content
needs grouping. Native navigation, dialogs, Apple sign-in, menus, and sharing
keep their platform behavior.

Normative token values live in [src/constants/theme.ts](src/constants/theme.ts);
this document explains how to apply them. Dimensions are logical points.

## Colors

- **Primary (ultramarine)**: actions, links, the back button, Done and prominent
  bar actions, the tab bar, and focus borders. Filled buttons carry white labels.
- **Highlight (pale blue)**: selected items, status and step chips, and completion
  marks. Segmented controls use white selections and ultramarine labels on a cool gray track.
- **Neutral (dark ink on white)**: ink for text, other bar items, and
  structural symbols; muted ink for metadata; white for inputs and cards; fill
  for placeholders, never behind a shown photo; separators and soft borders for
  structure.
- **Status**: success, warning, and destructive tones pair with a word or
  symbol; badges stay system red. Uncertain, queued, and rejected identification
  stays distinct from verified.

Selection carries a weight, border, checkmark, or accessibility state; color
never signals selection alone. Ordinary
text meets 4.5:1 against its background, including through opacity.

## Typography

- **Headlines**: Space Grotesk Semibold for the wordmark, large titles, artwork
  titles, prominent names, and section headings. Use the bundled face without
  synthesizing a weight; its license and attribution appear in About.
- **Body and labels**: native SF Pro for navigation, body text, notes, forms,
  controls, and metadata. Use Regular for reading and Semibold for actions.

Token sizes are defaults, not ceilings. Dynamic Type stays live in React Native
and SwiftUI. At large text scales, wordmark and page-title headings fall back to
display, and controls stack.

## Layout

Use 20-point page gutters, 24-point section spacing, 16-point row padding, and
8 points between related items, drawn from the spacing tokens. A text button
under another button gets no added gap (`ActionStack`): its 44-point target
already leaves about 11 points above the label. Long names,
titles, and notes wrap. Above 1.4× text scale, artwork grids collapse to one
column; wider screens repeat the phone grid side by side. Scrolling, keyboard avoidance, and safe areas take precedence over a
fixed-height composition. Gutters, pinned bars, and floating controls start
inside the left and right safe area; backgrounds, photos, and the camera still
reach the screen edges. The movable Wall keeps its own geometry and accessible
positioning controls.

## Elevation & Depth

Flat by default: hierarchy comes from type weight, ink versus muted, separators,
and cool gray grouping surfaces. Notes use plain text and quiet separators. A footer pinned under scrolling content
takes a hairline separator on its top edge. Interface surfaces carry no gradients. Soft paper shadows
lift prints, postcards, empty-state papers, and the Now card. Material finishes
stay on glass bars and controls over the wall, wall frames, camera, visit-band and
wall-edge scrims, and the globe; onboarding
artwork shown full-bleed under a white sheet takes the camera's scrim and glass
controls. Toasts
are opaque ink pills with white text. Reduce Transparency replaces camera glass
with an opaque backing; reduced-motion settings govern animated transitions.

## Shapes

Artwork stays square. Thumbnails round 2 points, buttons and inputs 6, cards 12,
and in-content sheets 16; avatars are circular. Native controls keep their
platform geometry. Every control offers at least a 44 × 44-point target.

## Do's and Don'ts

Interface writing:

- Do write in plain, calm, specific language. Say what is here, what is
  missing, or what the person can do next.
- Do let artwork and visual design supply the personality; everyday tasks do not
  need slogans, quips, or inspirational encouragement.
- Do keep one brand statement, on Welcome: “Point at a painting. Learn its
  story.”
- Do use factual empty-state headings, such as “No saved artworks yet.” Add a
  short next step when useful: “Scan an artwork to add it to your collection.”
- Do match copy to the actual state: signing in, creating a profile, loading,
  and an empty result each need different explanations.
- Do name actions directly, and use neutral input prompts such as “Add a note…”
  instead of questions about feelings or inspiration.
- Do state privacy, consent, saving behavior, uncertainty, and recovery
  where a choice depends on them; reassurance alone is not information.
- Do use natural contractions; warmth comes from clear, helpful wording.
- Do write navigation, screen, and sheet titles, menu items, and alert and
  action-sheet buttons in Apple title case (“Remove from Collection…”); headings,
  body copy, captions, empty states, and question alert titles stay in sentence
  case. Write dates as “Oct 29, 2026” and attribution as “Artist · 1889”.
- Do let lettering within an illustration remain part of its visual design.
- Don't imply a save or share succeeded before it has completed.
- Don't add captions, helper text, or chips by default or to fill space. Keep
  them only for meaningful status, non-obvious constraints, consequences, or
  recovery not already conveyed nearby.
- Don't repeat a navigation title with a decorative heading.

Behavior and privacy:

- Do keep shared headers and controls mounted in the same layout across tabs and
  filters. Put changing content below them; retain unavailable controls as disabled.
- Do keep available content visible during refresh, pagination, and recoverable
  failures; show an empty state only after loading completes.
- Do keep busy actions labeled and in place, block duplicate activation, and
  announce progress.
- Do close a sheet with nothing to save with an X at its top trailing edge.
  Unsaved edits put Cancel (Back on a pushed form) at the bar's leading edge and
  the commit (Save, Post) at its trailing edge. An edit mode on a page ends with
  Done.
- Do give every component VoiceOver labels, selected, busy, and disabled states,
  and gesture alternatives.
- Don't let private notes, reflections, or unselected photos enter a sharing
  preview; publish and update stay explicit actions.
- Don't replace native permission, consent, confirmation, or sharing dialogs.
- Don't substitute a portrait or a private photo for unavailable artwork; use a
  neutral placeholder.
