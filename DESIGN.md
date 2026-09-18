---
version: alpha
name: Artlog Graphic Index
description: A personal art journal on paper, with black typography, cobalt actions, lime selections, and artwork-led layouts.
colors:
  primary: "#0A46F3"
  primary-pressed: "#0836C4"
  ink: "#111111"
  muted: "#6A6B70"
  paper: "#FCFCF9"
  surface: "#FFFFFF"
  fill: "#F0F0EC"
  avatar: "#D7D7D8"
  highlight: "#DFF64D"
  separator: "#CDCDD0"
  control-border: "#111111"
  success: "#2F6846"
  warning: "#865A15"
  destructive: "#B42318"
typography:
  wordmark: { fontFamily: Anton, fontSize: 64px, lineHeight: 72px }
  large-title: { fontFamily: system-ui, fontSize: 34px, lineHeight: 41px, fontWeight: 700 }
  display: { fontFamily: Anton, fontSize: 32px, lineHeight: 38px }
  section: { fontFamily: Anton, fontSize: 20px, lineHeight: 26px }
  body: { fontFamily: system-ui, fontSize: 17px, lineHeight: 25px }
  secondary: { fontFamily: system-ui, fontSize: 15px, lineHeight: 22px }
  metadata: { fontFamily: system-ui, fontSize: 13px, lineHeight: 18px }
  button: { fontFamily: system-ui, fontSize: 17px, lineHeight: 22px, fontWeight: 600 }
rounded:
  artwork: 0px
  thumbnail: 2px
  button: 8px
  input: 8px
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
---

# Artlog Graphic Index

Artlog records artworks and visits in a personal collection. Paper, strong black
typography, cobalt actions, and lime selections give the app a consistent identity. Artwork supplies the visual detail. Content rows and thin
dividers establish structure without turning every section into a card.

This language covers entry, Home, Collection, visits, scanning, profiles, social
screens, Settings, and their sheets and state presentations. The product is an
iPhone portrait app in light mode. Native navigation, system dialogs, Apple
sign-in, menus, and sharing retain their platform behavior.

## Sources of truth

[Theme tokens](src/constants/theme.ts) own interface colors, typography, spacing,
and geometry. [Shared text](src/components/themed-text.tsx) applies semantic
roles and refreshes native measurements after live Dynamic Type changes.
[Gallery buttons](src/components/collection/gallery-button.tsx),
[segmented selection](src/components/collection/native-segmented-picker.tsx),
and [search fields](src/components/collection/collection-search-field.tsx)
apply the same language to controls. Component behavior remains defined in code.

The token notation follows [Google's DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md).
Dimensions written as `px` represent logical points in the native app.

## Color and hierarchy

Paper is the page and sheet background. White separates inputs and surfaces
where needed; subtle fill supports placeholders and quiet grouped areas. Ink
carries primary text and structural symbols. Muted ink carries metadata and
supporting copy. Separator rules divide content; the stronger control border
identifies editable or selectable boundaries.

Cobalt identifies primary actions and links; header icon buttons are ink. Lime
highlights editorial labels, selected segments, wall numbering, and the note
swatch, always with black text.
Selection also has a weight, border, checkmark, or accessibility state. Lime
never carries body text on paper or communicates selection by itself.

Success, warning, and destructive colors appear with explicit words or symbols.
Uncertain, tentative, queued, and rejected identification states remain distinct
from verified identification and successful sharing.

Cobalt on paper has 6.4:1 contrast; muted ink on paper has 5.2:1; black on lime
has 15.7:1. Check any new text/background pairing, including opacity,
against a minimum 4.5:1 for ordinary text.

## Typography and layout

Anton Regular carries the Artlog wordmark, prominent names, artist headings,
and short editorial headings. System sans-serif carries navigation, body text,
forms, controls, and metadata. Anton is embedded at native startup; its license
and attribution appear in About. Do not synthesize bold weights for Anton.

The semantic ramp is wordmark 64, native large title 34, display 32/38, section
20/26, body 17/25, secondary 15/22, and metadata 13/18. These are default sizes,
not ceilings. Use corresponding native text styles in SwiftUI so Dynamic Type
remains live there too.

Use 20-point page gutters, 24-point section spacing, 16-point row padding, and
8-point spacing between related items. Long names, titles, and notes wrap. At
accessibility sizes, ordinary artwork grids collapse to one column and controls
stack. Scrolling, keyboard avoidance, and safe areas take precedence over a
fixed-height composition. The movable Wall retains its own geometry and
accessible positioning controls.

Artwork edges remain square. Ordinary thumbnails have 2-point rounding,
app-owned buttons 6 points, and inputs 8 points. Avatars remain circular.
Native controls keep their platform geometry.

## Controls, navigation, and feedback

Filled cobalt buttons use white labels. Secondary actions use cobalt text or an
outline; destructive actions use red and explicit wording. Controls provide at
least a 44 × 44-point target. Busy actions retain their labels and layout, block
duplicate activation, and announce progress.

Segmented controls sit in a one-point ink border; the selected segment is flat
lime with black text and the rest are white. Their selected state is available
to VoiceOver; disabled state does not rely on color alone.
Inputs have visible labels, readable muted placeholders, a stronger control
border, cobalt focus and selection tint, and light keyboards. Validation stays
near the relevant field or operation.

Navigation uses paper backgrounds, black titles, labeled back buttons, and ink
header icons in every stack, including Scan. Settings and About are plain rows
with separators rather than inset groups. Home has one Artlog masthead with
search and friends actions; an overflow menu carries secondary actions.

Toasts and undo use an opaque ink surface, white wrapping text, and readable
44-point actions. Existing timing and undo behavior remain intact. Available
content stays visible during refresh, pagination, and recoverable failures.
Initial progress is labeled; an empty state appears only after loading completes.
Missing or inaccessible content has a clear unavailable message and a way out.

Remove decorative interface gradients and heavy shadows. Preserve material
finishes on selected decorative frames, functional camera scrims, and the globe's
dimensional rendering. Reduce Transparency replaces camera glass with an opaque
backing; reduced-motion settings govern animated transitions.

## Artwork, Wall, and branding

Full artwork views preserve the complete image and their existing photo-selection
behavior. Neutral placeholders identify unavailable artwork without substituting
a portrait or a private photograph.

Wall pieces keep their free arrangement and size; each is numbered in lime in
hanging order with artist and title beneath it. New walls use Paper and new placements use the
thin Black frame. Ordinary thumbnails without an explicit frame use No frame. Shared persisted defaults
remain separate from interface tokens. Existing paint, frames, positions, sizes,
and selected photographs remain unchanged. Paper joins Sage, Forest, Slate,
Burgundy, Plum, Limestone, and Chalk in the paint picker. Wall edits continue to
save automatically; Done exits editing.

The charcoal portrait supplies the installed icon, centered launch mark,
Welcome, and About. iOS applies the production icon mask. Welcome pairs the
portrait with the Anton wordmark and the tagline; About uses a compact portrait
beside the name and version. Everyday screens use typography without
repeating the portrait.

## Privacy and accessible states

Visual changes preserve guest collections, saving, synchronization, sharing, and
account ownership. Private notes, reflections, and unselected photos never
enter a sharing preview. Publish and update remain explicit actions.

Status text must explain the operation and available recovery. Keep drafts and
local content available through failures and offline use. Native permission,
consent, confirmation, and sharing dialogs retain their system presentation.
VoiceOver labels, selected/busy/disabled states, announcements, and gesture
alternatives remain part of every component's contract.
