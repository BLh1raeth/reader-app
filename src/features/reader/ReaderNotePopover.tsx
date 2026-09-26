import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { uiText } from '../../localization';
import type { ReaderNotePopoverState } from './hooks/useReaderSelection';
import type { FootnoteAnchorRect } from './reader-types';

// Same anchoring geometry as the footnote popover: 76% viewport width,
// above the anchor preferred, below as fallback, safe-area clamped.
const NOTE_POPOVER_WIDTH_RATIO = 0.76;
const NOTE_POPOVER_MAX_HEIGHT_RATIO = 0.42;
const NOTE_POPOVER_EDGE_GAP = 12;
const NOTE_POPOVER_ANCHOR_GAP = 8;
const NOTE_POPOVER_MIN_HEIGHT = 96;

type NotePopoverLayout = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ top: number } | { bottom: number });

function computeLayout(
  anchor: FootnoteAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
  insetTop: number,
  insetBottom: number,
): NotePopoverLayout {
  const width = Math.round(viewportWidth * NOTE_POPOVER_WIDTH_RATIO);
  const cappedMaxHeight = Math.round(viewportHeight * NOTE_POPOVER_MAX_HEIGHT_RATIO);
  const anchorCenterX = anchor.x + anchor.width / 2;
  const left = Math.min(
    viewportWidth - width - NOTE_POPOVER_EDGE_GAP,
    Math.max(NOTE_POPOVER_EDGE_GAP, anchorCenterX - width / 2),
  );
  const spaceAbove = anchor.y - insetTop - NOTE_POPOVER_ANCHOR_GAP;
  const spaceBelow = viewportHeight - insetBottom - (anchor.y + anchor.height) - NOTE_POPOVER_ANCHOR_GAP;
  // Prefer above the anchor; fall back below when space is tight. Anchoring
  // by the bottom edge lets short popovers shrink toward the anchor without
  // measuring content height.
  const placeAbove = spaceAbove >= NOTE_POPOVER_MIN_HEIGHT || spaceAbove >= spaceBelow;
  if (placeAbove) {
    return {
      left,
      width,
      bottom: viewportHeight - anchor.y + NOTE_POPOVER_ANCHOR_GAP,
      maxHeight: Math.max(NOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceAbove)),
    };
  }
  return {
    left,
    width,
    top: anchor.y + anchor.height + NOTE_POPOVER_ANCHOR_GAP,
    maxHeight: Math.max(NOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceBelow)),
  };
}

export function ReaderNotePopover({
  state,
  viewportWidth,
  viewportHeight,
  insetTop,
  insetBottom,
  colorScheme,
  textColor,
  secondaryColor,
  placeholderColor,
  destructiveColor,
  accentColor,
  fallbackColor,
  onDismiss,
  onSave,
  onEdit,
  onDelete,
}: {
  state: ReaderNotePopoverState;
  viewportWidth: number;
  viewportHeight: number;
  insetTop: number;
  insetBottom: number;
  colorScheme: 'light' | 'dark';
  textColor: string;
  secondaryColor: string;
  placeholderColor: string;
  destructiveColor: string;
  accentColor: string;
  fallbackColor: string;
  onDismiss: () => void;
  onSave: (text: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const editable = state.mode === 'create' || state.mode === 'edit';
  const [draft, setDraft] = useState(state.mode === 'edit' ? state.note : '');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // Reset the draft whenever the popover switches modes or targets.
  useEffect(() => {
    setDraft(state.mode === 'edit' ? state.note : '');
  }, [state]);

  // While editing, the keyboard shrinks the usable viewport: treat the
  // keyboard top as the viewport bottom so the popover (and its TextInput)
  // is never covered. Will-events fire before the keyboard animation.
  useEffect(() => {
    if (!editable) return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [editable]);

  const anchor: FootnoteAnchorRect = useMemo(() => {
    if (state.mode === 'create') {
      const rect = state.payload.rect;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return state.anchor;
  }, [state]);

  const effectiveViewportHeight = viewportHeight - (editable ? keyboardHeight : 0);
  const layout = useMemo(
    () => computeLayout(anchor, viewportWidth, effectiveViewportHeight, insetTop, insetBottom),
    [anchor, viewportWidth, effectiveViewportHeight, insetTop, insetBottom],
  );

  const positionStyle = 'top' in layout
    ? { bottom: undefined, left: layout.left, top: layout.top, width: layout.width }
    : { bottom: layout.bottom, left: layout.left, top: undefined, width: layout.width };

  // Outside tap: while editing it only dismisses the keyboard (never
  // discards the draft); in view mode it dismisses the popover.
  const handleBackdropPress = () => {
    if (editable) {
      inputRef.current?.blur();
    } else {
      onDismiss();
    }
  };

  const body = editable ? (
    <View style={styles.editorContainer}>
      {state.mode === 'create' ? (
        <Text numberOfLines={3} style={[styles.quoteText, { color: secondaryColor }]}>
          {state.payload.text}
        </Text>
      ) : null}
      <TextInput
        ref={inputRef}
        autoFocus
        multiline
        onChangeText={setDraft}
        placeholder={uiText.reader.notePlaceholder}
        placeholderTextColor={placeholderColor}
        returnKeyType="default"
        style={[styles.input, { color: textColor }]}
        value={draft}
      />
      <View style={styles.buttonRow}>
        <Pressable
          accessibilityLabel={uiText.reader.noteCancel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDismiss}
        >
          <Text style={[styles.buttonText, { color: secondaryColor }]}>{uiText.reader.noteCancel}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={uiText.reader.noteSave}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onSave(draft)}
        >
          <Text style={[styles.buttonText, styles.buttonTextBold, { color: accentColor }]}>
            {uiText.reader.noteSave}
          </Text>
        </Pressable>
      </View>
    </View>
  ) : (
    <View style={styles.viewerContainer}>
      <ScrollView
        scrollIndicatorInsets={{ right: 1 }}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.max(64, layout.maxHeight - 72) }}
      >
        <Text style={[styles.noteText, { color: textColor }]}>
          {state.mode === 'view' ? state.note : ''}
        </Text>
      </ScrollView>
      <View style={styles.buttonRow}>
        <Pressable
          accessibilityLabel={uiText.reader.noteDelete}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDelete}
        >
          <Text style={[styles.buttonText, { color: destructiveColor }]}>{uiText.reader.noteDelete}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={uiText.reader.noteEdit}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onEdit}
        >
          <Text style={[styles.buttonText, styles.buttonTextBold, { color: accentColor }]}>
            {uiText.reader.noteEdit}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Outside tap: dismisses only; the pressable covers the WebView so the
          tap never reaches the reader (no page turn, no chrome toggle). */}
      <Pressable
        accessibilityHint={uiText.reader.dismissNoteHint}
        accessibilityLabel={uiText.reader.dismissNote}
        accessibilityRole="button"
        onPress={handleBackdropPress}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.popoverPosition, positionStyle]}>
        {isGlassEffectAPIAvailable() ? (
          <GlassView colorScheme={colorScheme} glassEffectStyle="regular" isInteractive style={styles.popoverGlass}>
            {body}
          </GlassView>
        ) : (
          <View style={[styles.popoverFallback, { backgroundColor: fallbackColor }]}>{body}</View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  popoverPosition: {
    position: 'absolute',
  },
  popoverGlass: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  popoverFallback: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  editorContainer: {
    minHeight: 140,
  },
  viewerContainer: {
    minHeight: 96,
  },
  quoteText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  input: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  noteText: {
    fontSize: 15,
    lineHeight: 21,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 20,
    marginTop: 10,
    paddingTop: 8,
  },
  buttonText: {
    fontSize: 15,
  },
  buttonTextBold: {
    fontWeight: '600',
  },
});
