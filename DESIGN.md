---
version: alpha
name: Artlog Graphic Index
description: A personal art journal on paper, with black typography, cobalt actions, lime selections, and artwork-led layouts.
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

# Artlog Graphic Index

## Overview

Artlog records artworks and visits in a personal collection. It is an iPhone
portrait app in light mode only. The interface reads as paper: calm, spacious,
and typographic, with strong black headings, cobalt for actions, and lime for
selection. Artwork supplies the visual detail, so chrome stays quiet: content
rows and thin dividers give structure, and white cards appear only where content
needs grouping. Native navigation, dialogs, Apple sign-in, menus, and sharing
keep their platform behavior.

Normative token values live in [src/constants/theme.ts](src/constants/theme.ts);
this document explains how to apply them. Dimensions are logical points.

## Colors

- **Primary (cobalt `#0A46F3`)**: actions, links, back buttons, header text
  actions, the tab bar, and focus borders. Filled buttons carry white labels.
- **Highlight (lime `#DFF64D`)**: editorial labels, selected segments, status and
  step chips, and completion marks. Always with black text.
- **Neutral (ink `#111111` on paper `#FCFCF9`)**: ink for text, header icons, and
  structural symbols; muted ink for metadata; white for inputs and cards; fill
  for placeholders; separators and soft borders for structure.
- **Status**: success, warning, and destructive tones always pair with a word or
  symbol. Uncertain, queued, and rejected identification stays distinct from
  verified.

Selection carries a weight, border, checkmark, or accessibility state; lime
never signals selection alone and never carries body text on paper. Ordinary
text meets 4.5:1 against its background, including through opacity.

## Typography

- **Headlines**: Anton Regular for the wordmark, page titles, prominent names,
  artist and note headings, and short editorial labels. Never synthesize bold
  for Anton; its license and attribution appear in About.
- **Body and labels**: system sans-serif for navigation, body text, forms,
  controls, and metadata.

Token sizes are defaults, not ceilings. Dynamic Type stays live in React Native
and SwiftUI. At large text scales, wordmark and page-title headings fall back to
display, and mastheads and controls stack.

## Layout

Use 20-point page gutters, 24-point section spacing, 16-point row padding, and
8 points between related items, drawn from the spacing tokens. Long names,
titles, and notes wrap. Above 1.4× text scale, artwork grids collapse to one
column. Scrolling, keyboard avoidance, and safe areas take precedence over a
fixed-height composition. The movable Wall keeps its own geometry and accessible
positioning controls.

## Elevation & Depth

Flat by default: hierarchy comes from type weight, ink versus muted, separators,
and white on paper. Interface surfaces carry no gradients. Soft paper shadows
lift prints, postcards, empty-state papers, and the visit bar. Material finishes
stay on decorative wall frames, functional camera scrims, and the globe. Toasts
are opaque ink pills with white text. Reduce Transparency replaces camera glass
with an opaque backing; reduced-motion settings govern animated transitions.

## Shapes

Artwork stays square. Thumbnails round 2 points, buttons and inputs 8, cards 12,
and in-content sheets 16; avatars are circular. Native controls keep their
platform geometry. Every control offers at least a 44 × 44-point target.

## Do's and Don'ts

Interface writing:

- Do write in plain, calm, specific language. Say what is here, what is
  missing, or what the person can do next.
- Do let artwork and visual design supply the personality; everyday tasks do not
  need slogans, quips, or inspirational encouragement.
- Do keep one brand statement, on Welcome: “Remember the art that stays with
  you.”
- Do use factual empty-state headings, such as “No saved artworks yet.” Add a
  short next step when useful: “Scan an artwork to add it to your collection.”
- Do match copy to the actual state: signing in, creating a profile, loading,
  and an empty result each need different explanations.
- Do name actions directly, and use neutral input prompts such as “Add a note…”
  instead of questions about feelings or inspiration.
- Do keep privacy, consent, saving behavior, uncertainty, and recovery
  instructions explicit.
- Do use natural contractions; warmth comes from clear, helpful wording.
- Do let lettering within an illustration remain part of its visual design.
- Don't imply a save or share succeeded before it has completed.
- Don't keep a sentence that adds no information. Caption a field or button only
  when the person needs the caption to act.
- Don't repeat a navigation title with a decorative heading.

Behavior and privacy:

- Do keep available content visible during refresh, pagination, and recoverable
  failures; show an empty state only after loading completes.
- Do keep busy actions labeled and in place, block duplicate activation, and
  announce progress.
- Do give every component VoiceOver labels, selected, busy, and disabled states,
  and gesture alternatives.
- Don't let private notes, reflections, or unselected photos enter a sharing
  preview; publish and update stay explicit actions.
- Don't replace native permission, consent, confirmation, or sharing dialogs.
- Don't substitute a portrait or a private photo for unavailable artwork; use a
  neutral placeholder.
