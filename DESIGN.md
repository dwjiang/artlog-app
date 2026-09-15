---
version: alpha
name: Artlog Gallery
description: A quiet personal museum with warm paper, painted walls, tactile frames, and native iOS controls.
colors:
  primary: "#45524B"
  ink: "#262320"
  muted: "#6A6763"
  paper: "#F2F2EF"
  surface: "#FAFAF6"
  segment-track: "#DFE0DA"
  segment-selection: "#FBFBF8"
  fill: "#E4E4DE"
  sage: "#CDD0CA"
  slate: "#4C5B6B"
  burgundy: "#6C2F2B"
  plum: "#524650"
  limestone: "#E2DCD0"
  chalk: "#EDECE7"
  destructive: "#B42318"
typography:
  empty-title:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: 600
  artwork-artist:
    fontFamily: system-ui
    fontSize: 19px
    fontWeight: 600
    lineHeight: 25px
  artwork-title:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  sheet-title:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 600
  body:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
  button:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 500
  text-action:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 500
  segment:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 600
  caption:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  eyebrow:
    fontFamily: system-ui
    fontSize: 10px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 1.1px
  wall-label:
    fontFamily: system-ui
    fontSize: 10px
    fontWeight: 600
    lineHeight: 13px
rounded:
  artwork: 0px
  thumbnail: 4px
  segment-selection: 7px
  input: 9px
  control: 10px
  button: 11px
  full: 9999px
spacing:
  half: 2px
  one: 4px
  two: 8px
  compact: 12px
  three: 16px
  content: 20px
  four: 24px
  five: 32px
  six: 64px
components:
  screen:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  supporting-copy:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
  button-inverse:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
  button-text:
    textColor: "{colors.ink}"
    typography: "{typography.text-action}"
  button-destructive:
    textColor: "{colors.destructive}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
  segment-track:
    backgroundColor: "{colors.segment-track}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "{spacing.half}"
  segment-selected:
    backgroundColor: "{colors.segment-selection}"
    textColor: "{colors.ink}"
    typography: "{typography.segment}"
    rounded: "{rounded.segment-selection}"
  choice-selected:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "{spacing.compact}"
  wall-sage:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.ink}"
  wall-forest:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
  wall-slate:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.paper}"
  wall-burgundy:
    backgroundColor: "{colors.burgundy}"
    textColor: "{colors.paper}"
  wall-plum:
    backgroundColor: "{colors.plum}"
    textColor: "{colors.paper}"
  wall-limestone:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.ink}"
  wall-chalk:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.ink}"
---

# Artlog Gallery

## Overview

Artlog is a personal art journal for people who want to remember what they saw
and curate the works that stay with them. Its collection wall feels like a small
museum: calm, personal, and lightly tactile. Artwork supplies the detail and
color; the surrounding interface provides room to look.

This document captures the design language of the current collection wall,
its editing sheets, and the surrounding navigation. Other screens still use
the general app theme. Platform and appearance constraints live in
[AGENTS.md](AGENTS.md).

The format follows [Google's DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md).
Tokens above record the current values; prose explains their visual purpose.
Dimensions use the specification's `px` notation for the equivalent logical
points in the native app. Native controls retain platform sizing and behavior.

### Implementation references

| Reference | Owns |
| --- | --- |
| [Gallery and spacing tokens](src/constants/theme.ts) | Shared palette and base spacing; `primary` here maps to `Gallery.accent` and the Forest wall color. |
| [Collection wall](src/components/collection/collection-wall.tsx) and [wall gallery](src/components/collection/wall-gallery.tsx) | Screen composition, artwork presentation, labels, and editing feedback. |
| [Gallery button](src/components/collection/gallery-button.tsx) and [view mode picker](src/components/collection/view-mode-picker.tsx) | Action hierarchy and segmented control styling. |
| [Frames](src/components/collection/wall-frame.tsx) and [wall options](src/components/collection/wall-options.tsx) | Frame materials, depth, and visual choices. |
| [Wall sheets](src/components/collection/wall-sheets.tsx) and [profile sheet](src/components/collection/wall-profile-sheet.tsx) | Sheet hierarchy, artwork summaries, and form styling. |

Component behavior and exact rendering remain defined by these sources. Update
this document alongside intentional changes to the shared visual language.

## Colors

Use warm, low-saturation neutrals around the artwork. Forest green connects
primary actions, selected navigation, and native control tint.

| Role | Token / value | Application |
| --- | --- | --- |
| Primary action | `primary` / `#45524B` | Forest green for filled actions and active control tint. |
| Main text | `ink` / `#262320` | Warm charcoal for headings, body text, and action labels. |
| Supporting text | `muted` / `#6A6763` | Captions, dates, explanatory copy, and counts. |
| Page foundation | `paper` / `#F2F2EF` | Collection chrome, sheet backgrounds, and inverse text. |
| Raised field | `surface` / `#FAFAF6` | A subtle lift for text inputs. |
| Segmented control | `segment-track` / `#DFE0DA`; `segment-selection` / `#FBFBF8` | Soft gray-green track with a pale selected segment. |
| Quiet emphasis | `fill` / `#E4E4DE` | Selected options, image placeholders, and inline error containers. |
| Separator | `rgba(38, 35, 32, 0.16)` | Fine rules and input outlines. |
| Destructive action | `destructive` / `#B42318` | Explicit removal actions. Pair with a clear action label. |

### Wall paint

Sage is the default. Wall paint is a personal display choice; the surrounding
chrome keeps its paper background. Use ink labels on Sage, Limestone, and Chalk;
use paper labels on Forest, Slate, Burgundy, and Plum.

| Finish | Color | Character |
| --- | --- | --- |
| Sage | `#CDD0CA` | Quiet, pale green-gray. |
| Forest | `#45524B` | Deep, muted green. |
| Slate | `#4C5B6B` | Cool blue-gray. |
| Burgundy | `#6C2F2B` | Warm, dark red. |
| Plum | `#524650` | Subdued purple-gray. |
| Limestone | `#E2DCD0` | Warm stone. |
| Chalk | `#EDECE7` | Soft off-white. |

## Typography

Use the iOS system sans-serif. Native navigation owns the large page title.
Within content, medium and semibold weights establish hierarchy without
competing with the art.

Artist names lead artwork summaries at 19/25, semibold. Artwork titles follow
at 15/22 in italic, with dates in regular muted text. General body copy uses
14/21, and supporting copy uses 12/18. Sheet titles use 15-point semibold.

Small wall labels resemble museum captions: a 10/13 semibold artist name above
a regular italic title at the same size, with the title at 80% opacity. Keep
these captions subordinate to the image; details belong in the artwork sheet.
The artwork-count eyebrow uses uppercase text and 1.1-point tracking. Reserve
this treatment for short contextual labels.

Empty states use a 24-point semibold headline and centered 15/22 supporting
copy. Native text scaling and readable wrapping take precedence over forcing
copy into a fixed box.

## Layout

The composition moves from native navigation to compact controls, then into a
full-width painted wall. Align the collection controls and footer to an
18-point horizontal inset. Sheets use 20-point content insets. Most internal
spacing follows the shared 2, 4, 8, 16, 24, 32, and 64-point scale; 12 and 20
are established additions in the wall UI.

Arrange art in an asymmetrical hanging with varied widths, staggered heights,
and generous breathing room. A few large works establish the composition;
smaller pieces fill the surrounding space. Preserve each artwork's aspect
ratio and keep its label directly below its frame. Wall placement scales with
the available width and extends vertically with the collection.

Use regular rows and grids for choosing or finding artwork. The add-artwork
sheet uses three columns, 12-point gaps, and square preview containers that
contain the image. Forms and artwork details follow one vertical reading order.
Let native safe areas, scrolling, and sheet presentation govern screen edges.

## Elevation & Depth

Give the art physical depth while keeping page chrome quiet. The wall has a
subtle vertical lighting wash: white at 10% opacity at the top, transparent
at 24%, and black at 9% at the bottom. Artwork-summary backdrops use a lighter
wash from white at 8% to black at 6%.

Full-size frames cast a low, soft shadow with a tighter contact shadow:
`0 14px 22px -12px rgba(0,0,0,0.65), 0 2px 3px rgba(0,0,0,0.28)`.
Small previews use `0 1px 3px rgba(0,0,0,0.25)`. Fine highlights and inner
shadows give frame edges their material character.

Selected segments have only a small shadow: black at roughly 12.5% opacity,
2-point blur, and 1-point vertical offset. Use tonal changes and hairline
separators for other grouping. Native sheets and navigation supply their own
elevation and glass treatment.

## Shapes

Artwork and frames have square corners. Controls are softly rounded: 11-point
buttons, 10-point choice tiles and segment tracks, 9-point inputs, and 7-point
selected segments. Small image placeholders use a 4-point radius. Wall-paint
swatches are 32-point circles; editing badges are 26-point circles.

Frame finishes carry the decorative detail. Their base colors are material
anchors; gradients and edge treatments remain in the frame component.

| Frame | Base color | Treatment |
| --- | --- | --- |
| Gilt | `#B3924B` | Narrow gold with warm reflective edges. |
| Baroque | `#8A6620` | Deeper gold, wider molding, and an inset decorative rule. |
| Walnut | `#45301F` | Dark wood with subtle tonal grain. |
| Oak | `#C4A066` | Pale, honey-colored wood. |
| Black | `#1C1A18` | Thin, restrained dark edge. |
| White float | `#F4F2EE` | Pale surround with a dark inner reveal. |
| Mat | `#F5F3EE` | Broad warm-white mat with a fine dark outline. |
| No frame | Transparent | Bare artwork with a hanging shadow. |

## Components

### Navigation and selection

Keep large titles, toolbar actions, tabs, sheets, sliders, and text entry native
to iOS. Tint them with the gallery palette. Use SF Symbols with familiar
meanings; custom action icons are typically 15 points beside a text label.

Segmented controls are compact and full-width, with equal-width choices and
a pale selected surface. The built control has a 33-point inner segment and
2-point track padding. Selected options also expose their selected state to
accessibility; disabled segments use 55% opacity.

### Buttons and forms

Filled forest buttons identify the main action; use paper text. On dark wall
paint, an inverse filled button uses paper with ink text. Secondary actions
use native outlined styling; low-emphasis actions use plain ink labels.
Destructive actions use red text and explicit wording.

Gallery buttons have a minimum 44-point height. Filled and outlined variants
use 8-point vertical and 12-point horizontal padding. Native controls own
pressed and disabled feedback. Keep loading labels specific, such as
“Publishing…” or “Creating…”.

Inputs use the pale surface color, 12-point padding, a fine separator outline,
and visible labels above the field. Supporting and error messages sit near
the relevant action. State the problem and a concrete next step in plain text.

### Artwork and editing

Show the complete image inside its chosen frame. During editing, a small
circular move badge signals manipulation; the dragged piece rises above other
works and uses 92% opacity. Motion follows the user's movement directly.
Provide labeled position controls alongside dragging.

Frame choices show miniature material samples. Paint choices show circular
swatches. Both include text labels and a quiet filled selection background.
Artwork detail sheets lead with a centered framed preview on wall paint,
followed by artist, italic title, date, and medium. Controls sit in clearly
separated sections below the artwork.

### Empty states and copy

Use a simple symbol, a short welcoming headline, one explanatory sentence,
and one clear action. “Your own little museum.” captures the desired tone:
personal, concrete, and calm. Describe public visibility beside the actions
that make it relevant. Keep private-note and visit explanations easy to scan.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Let artwork provide visual variety; use warm, quiet chrome around it. | Add saturated UI accents or decorative backgrounds that compete with the collection. |
| Preserve full artwork proportions and give each hanging room to breathe. | Crop paintings to force a uniform wall grid or round the artwork's corners. |
| Use native system typography, italic work titles, and restrained weight changes. | Introduce a display font or turn ordinary body copy into tracked uppercase labels. |
| Concentrate material texture and shadows on the frames. | Apply frame-like gradients, bevels, or heavy shadows to every control. |
| Preserve readable contrast, visible labels, selected states, and alternatives to gestures. | Use color or drag gestures as the only way to understand or operate a control. |

For new text/background combinations, target at least 4.5:1 contrast for normal
text and check the rendered result with opacity and gradients applied. The
token pairs describe base colors; they do not certify accessibility of the
whole screen.
