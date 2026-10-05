import { useState } from "react";
import { StyleSheet, Text, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";

import { Gallery } from "@/constants/theme";
import { activeHashtag, completeHashtag, hashtagSegments } from "@/shared/social/hashtags";

import { HashtagSuggestions } from "./hashtag-suggestions";

type Selection = { start: number; end: number };

/**
 * Wires a text field for hashtags: tags are tinted as they're typed, tags already in use that start with the one at
 * the cursor are suggested, and choosing one completes it. Spread `inputProps` onto the `TextInput` (it supplies the
 * text as children, so pass no `value`) and place `suggestions` where the list belongs.
 */
export function useHashtagInput(
  text: string,
  onChangeText: (text: string) => void,
  maxLength: number,
  editable: boolean,
) {
  const [selection, setSelection] = useState<Selection>({ start: text.length, end: text.length });
  // The cursor is set only right after a completion, so typing never fights it.
  const [placed, setPlaced] = useState<Selection>();
  const active = selection.start === selection.end ? activeHashtag(text, selection.start) : null;
  const complete = (tag: string) => {
    if (!editable || !active) return;
    const next = completeHashtag(text, active, tag, maxLength);
    if (!next) return;
    const cursor = { start: next.cursor, end: next.cursor };
    onChangeText(next.text);
    setSelection(cursor);
    setPlaced(cursor);
  };
  return {
    inputProps: {
      editable,
      maxLength,
      onChangeText,
      selection: placed,
      onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        setSelection(event.nativeEvent.selection);
        setPlaced(undefined);
      },
      // The test renderer, like the native field, only takes text inside Text children.
      children: hashtagSegments(text).map(({ text: part, tag }, index) => (
        <Text key={index} style={tag && styles.tag}>
          {part}
        </Text>
      )),
    },
    suggestions: (
      <HashtagSuggestions
        disabled={!editable}
        query={active?.query || undefined}
        canPick={(tag) => !!active && completeHashtag(text, active, tag, maxLength) !== null}
        onPick={complete}
      />
    ),
  };
}

const styles = StyleSheet.create({
  tag: { color: Gallery.accent },
});
