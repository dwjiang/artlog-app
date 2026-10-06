import { useId, useState } from "react";
import {
  InputAccessoryView,
  StyleSheet,
  Text,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";

import { Gallery } from "@/constants/theme";
import type { MentionPlace } from "@/lib/social/types";
import { activeHashtag, completeHashtag } from "@/shared/social/hashtags";
import { activeMention, completeMention } from "@/shared/social/mentions";
import { richTextSegments } from "@/shared/social/rich-text";

import { HashtagSuggestions } from "./hashtag-suggestions";
import { MentionSuggestions } from "./mention-suggestions";

type Selection = { start: number; end: number };

/**
 * Wires a text field for #tags and @mentions: both are tinted as they're typed, tags in use or people `place` allows
 * are suggested for the word at the cursor, and choosing one completes it. Spread `inputProps` onto the `TextInput`
 * (it supplies the text as children, so pass no `value`) and render `suggestions` after it. `docked` shows the list
 * on top of the keyboard, for fields in a scrolling form where a list under the field would sit behind the keyboard;
 * otherwise `suggestions` goes where the list belongs. `replace` sets the whole text with the cursor at its end, for
 * prefills such as a reply's handle; it returns false if editing is disabled or the text exceeds the field limit.
 */
export function useRichTextInput({
  text,
  onChangeText,
  maxLength,
  editable,
  place,
  docked = false,
}: {
  text: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  editable: boolean;
  place: MentionPlace;
  docked?: boolean;
}) {
  const accessoryId = useId();
  const [selection, setSelection] = useState<Selection>({ start: text.length, end: text.length });
  // The cursor is set only right after a completion or a replacement, so typing never fights it.
  const [placed, setPlaced] = useState<Selection>();
  const caret = selection.start === selection.end ? selection.start : undefined;
  const tag = caret === undefined ? null : activeHashtag(text, caret);
  const mention = caret === undefined || tag ? null : activeMention(text, caret);
  const apply = (next: { text: string; cursor: number } | null) => {
    if (!editable || !next || next.text.length > maxLength) return false;
    const cursor = { start: next.cursor, end: next.cursor };
    onChangeText(next.text);
    setSelection(cursor);
    setPlaced(cursor);
    return true;
  };
  const list = mention ? (
    <MentionSuggestions
      place={place}
      disabled={!editable}
      docked={docked}
      query={mention.query}
      canPick={(username) => completeMention(text, mention, username, maxLength) !== null}
      onPick={(username) => apply(completeMention(text, mention, username, maxLength))}
    />
  ) : (
    <HashtagSuggestions
      disabled={!editable}
      docked={docked}
      query={tag?.query || undefined}
      canPick={(value) => !!tag && completeHashtag(text, tag, value, maxLength) !== null}
      onPick={(value) => tag && apply(completeHashtag(text, tag, value, maxLength))}
    />
  );
  return {
    inputProps: {
      editable,
      maxLength,
      onChangeText,
      selection: placed,
      // Puts @ and # beside the space bar.
      keyboardType: "twitter" as const,
      ...(docked ? { inputAccessoryViewID: accessoryId } : {}),
      onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        setSelection(event.nativeEvent.selection);
        setPlaced(undefined);
      },
      // The test renderer, like the native field, only takes text inside Text children.
      children: richTextSegments(text).map(({ text: part, tag: isTag, mention: isMention }, index) => (
        <Text key={index} style={(isTag || isMention) && styles.link}>
          {part}
        </Text>
      )),
    },
    // Stays mounted while empty: the keyboard only picks up an accessory that exists when the field is focused.
    suggestions: docked ? (
      <InputAccessoryView nativeID={accessoryId} backgroundColor={Gallery.paper}>
        {list}
      </InputAccessoryView>
    ) : (
      list
    ),
    replace: (next: string) => apply({ text: next, cursor: next.length }),
  };
}

const styles = StyleSheet.create({
  link: { color: Gallery.accent },
});
