<script setup lang="ts">
import { isCodeFile, isLpmake } from '../../shared/file-language';
import { fallbackTextStyle, type TextStyle } from '../typography';
import { Prec } from '@codemirror/state';
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { basicSetup } from 'codemirror';
import {
  EditorView,
  highlightWhitespace,
  keymap,
  gutter,
  GutterMarker,
  Decoration,
} from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import { indentWithTab, isolateHistory, redo } from '@codemirror/commands';
import { parser, commands } from '../../shared/lpmake';
import { styleTags, tags } from '@lezer/highlight';
import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  delimitedIndent,
  foldNodeProp,
  foldInside,
} from '@codemirror/language';
import { indentUnit } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { diff } from '@codemirror/merge';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import {
  Compartment,
  EditorState,
  Transaction,
  countColumn,
  RangeSet,
  ChangeSet,
} from '@codemirror/state';
import { completionExtension, sourceCompletions, type CompletionFiles } from '../editor/completion';
import type { SourceBreakpoint } from '../../shared/debug';
import type { EditorCursor } from '../../shared/types';
const props = defineProps<{
  modelValue: string;
  textStyle?: TextStyle;
  disabled?: boolean;
  documentId: string;
  openIds: string[];
  indentSize: 1 | 2 | 4;
  theme: 'light' | 'dark';
  file?: string;
  language?: 'c' | 'cpp';
  completionEnabled?: boolean;
  completionFiles?: CompletionFiles;
  debugEnabled?: boolean;
  breakpoints?: SourceBreakpoint[];
  executionLine?: number;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'format'): void;
  (e: 'cursor', value: EditorCursor): void;
  (e: 'breakpoint', line: number, condition: boolean): void;
  (e: 'breakpoints', values: SourceBreakpoint[]): void;
}>();
const host = ref<HTMLDivElement>();
let view: EditorView | undefined;
const states = new Map<string, { state: EditorState; top: number; left: number }>();
const readOnly = new Compartment(),
  indentation = new Compartment(),
  colorTheme = new Compartment(),
  syntax = new Compartment(),
  completion = new Compartment(),
  debugView = new Compartment(),
  typography = new Compartment();
const lpLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        Name: tags.function(tags.variableName),
        String: tags.string,
        Comment: tags.lineComment,
        BlockComment: tags.blockComment,
      }),
      indentNodeProp.add({ Call: delimitedIndent({ closing: ')', align: false }) }),
      foldNodeProp.add({ Call: foldInside }),
    ],
  }),
  languageData: { commentTokens: { line: '#', block: { open: '--[[', close: ']]' } } },
});
function language() {
  if (props.file && !isLpmake(props.file) && !isCodeFile(props.file)) return [];
  return isLpmake(props.file ?? '')
    ? new LanguageSupport(lpLanguage, [
        lpLanguage.data.of({
          autocomplete: (context: any) => {
            const word = context.matchBefore(/[a-z_]+/);
            if (!word && !context.explicit) return null;
            return {
              from: word?.from ?? context.pos,
              options: commands.map((label) => ({
                label,
                type: 'function',
                apply: label + '(\"\")',
              })),
            };
          },
        }),
      ])
    : cpp();
}
class BreakMarker extends GutterMarker {
  constructor(readonly breakpoint: SourceBreakpoint) {
    super();
  }
  toDOM() {
    const el = document.createElement('span'),
      b = this.breakpoint;
    el.className =
      'source-breakpoint ' +
      (!b.enabled ? 'disabled' : b.verified ? 'verified' : 'pending') +
      (b.condition ? ' conditional' : '');
    el.title =
      (b.condition ? '条件：' + b.condition + ' · ' : '') +
      (b.message ?? (b.verified ? '已验证断点' : '待验证断点'));
    el.setAttribute('aria-label', el.title);
    return el;
  }
}
function debugExtensions() {
  if (!props.debugEnabled) return [];
  return [
    gutter({
      class: 'source-debug-gutter',
      renderEmptyElements: true,
      initialSpacer: () => new BreakMarker({ path: '', line: 1, enabled: true }),
      markers: (view) =>
        RangeSet.of(
          (props.breakpoints ?? [])
            .filter((b) => b.path === props.file && b.line <= view.state.doc.lines)
            .map((b) => new BreakMarker(b).range(view.state.doc.line(b.line).from)),
          true,
        ),
      domEventHandlers: {
        mousedown(_view, line, event) {
          if ((event as MouseEvent).button !== 0) return false;
          emit('breakpoint', _view.state.doc.lineAt(line.from).number, false);
          event.preventDefault();
          return true;
        },
        contextmenu(_view, line, event) {
          event.preventDefault();
          emit('breakpoint', _view.state.doc.lineAt(line.from).number, true);
          return true;
        },
      },
    }),
    EditorView.decorations.of((view) =>
      props.executionLine && props.executionLine <= view.state.doc.lines
        ? Decoration.set([
            Decoration.line({ class: 'debug-current-line' }).range(
              view.state.doc.line(props.executionLine).from,
            ),
          ])
        : Decoration.none,
    ),
  ];
}
function completions() {
  if (
    props.completionEnabled === false ||
    isLpmake(props.file ?? '') ||
    (props.file && !isCodeFile(props.file))
  )
    return [];
  return completionExtension((context) =>
    sourceCompletions(
      context,
      props.file ?? 'main.c',
      props.completionFiles ?? { files: {}, includeDirs: ['.'] },
      props.language ?? 'c',
    ),
  );
}
function indentConfig() {
  return [EditorState.tabSize.of(props.indentSize), indentUnit.of(' '.repeat(props.indentSize))];
}
function colors() {
  return [
    props.theme === 'dark' ? vscodeDark : vscodeLight,
    EditorView.theme({
      '.cm-highlightSpace': {
        background:
          'radial-gradient(circle at center, ' +
          (props.theme === 'dark' ? 'rgba(212,212,212,0.35)' : 'rgba(31,31,31,0.35)') +
          ' 1px, transparent 1px) 0 0 / 1ch 100% repeat-x',
      },
      '.cm-highlightTab': { opacity: '0.35' },
    }),
  ];
}
function textAppearance() {
  const s = props.textStyle ?? fallbackTextStyle;
  return Prec.highest(
    EditorView.theme({
      '&.cm-editor .cm-scroller': {
        fontFamily: s.family,
        fontSize: s.fontSize + 'px',
        lineHeight: String(s.lineHeight),
      },
      '&.cm-editor .cm-tooltip': {
        fontFamily: s.family,
        fontSize: s.fontSize + 'px',
        lineHeight: String(s.lineHeight),
      },
      '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--panel)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
      },
      '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
      },
      '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
      },
      '&.cm-editor .cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent)',
        color: '#fff',
      },
      '&.cm-editor .cm-completionDetail': { fontFamily: 'inherit', fontSize: 'inherit' },
    }),
  );
}
function reportCursor(state: EditorState) {
  const head = state.selection.main.head,
    line = state.doc.lineAt(head),
    ranges = state.selection.ranges.filter((r) => !r.empty);
  let selectionLines = 0,
    lastLine = 0;
  for (const range of ranges) {
    const first = state.doc.lineAt(range.from).number,
      last = state.doc.lineAt(
        state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to,
      ).number;
    selectionLines += Math.max(0, last - Math.max(first, lastLine + 1) + 1);
    lastLine = last;
  }
  emit('cursor', {
    line: line.number,
    column: countColumn(line.text.slice(0, head - line.from), state.tabSize) + 1,
    selectionChars: ranges.reduce((n, r) => n + r.to - r.from, 0),
    selectionLines,
    lines: state.doc.lines,
    focused: !!view?.hasFocus,
  });
}
function extensions(id = props.documentId) {
  return [
    basicSetup,
    typography.of(textAppearance()),
    completion.of(completions()),
    debugView.of(debugExtensions()),
    syntax.of(language()),
    highlightWhitespace(),
    keymap.of([
      indentWithTab,
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      {
        key: navigator.platform.toLowerCase().includes('mac') ? 'Mod-Alt-f' : 'Mod-h',
        run: openSearchPanel,
        scope: 'editor search-panel',
      },
    ]),
    indentation.of(indentConfig()),
    colorTheme.of(colors()),
    readOnly.of([
      EditorState.readOnly.of(!!props.disabled),
      EditorView.editable.of(!props.disabled),
    ]),
    EditorView.contentAttributes.of({ 'aria-label': '源码编辑器' }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-gutters': { border: 'none' },
      '.cm-content': { padding: '16px 0' },
    }),
    EditorView.updateListener.of((update) => {
      if (id !== props.documentId) return;
      if (update.docChanged) {
        const values = (props.breakpoints ?? []).filter((b) => b.path === props.file);
        if (values.length) {
          let mapping = update.changes;
          let replacedAll = false;
          update.changes.iterChangedRanges((a, b) => {
            if (a === 0 && b === update.startState.doc.length) replacedAll = true;
          });
          if (replacedAll) {
            const before = update.startState.doc.toString(),
              after = update.state.doc.toString();
            mapping = ChangeSet.of(
              diff(before, after, { scanLimit: 1000, timeout: 50 }).map((c) => ({
                from: c.fromA,
                to: c.toA,
                insert: after.slice(c.fromB, c.toB),
              })),
              before.length,
            );
          }
          const mapped = values.map((b) => ({
            ...b,
            line: update.state.doc.lineAt(
              mapping.mapPos(
                update.startState.doc.line(Math.min(b.line, update.startState.doc.lines)).from,
              ),
            ).number,
          }));
          if (mapped.some((b, i) => b.line !== values[i].line))
            emit('breakpoints', [
              ...(props.breakpoints ?? []).filter((b) => b.path !== props.file),
              ...mapped,
            ]);
        }
        emit('update:modelValue', update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet || update.focusChanged)
        reportCursor(update.state);
    }),
  ];
}
function applyText(text: string) {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === text) return;
  const changes = diff(current, text, { scanLimit: 1000, timeout: 50 }).map((c) => ({
    from: c.fromA,
    to: c.toA,
    insert: text.slice(c.fromB, c.toB),
  }));
  view.dispatch({
    changes,
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')],
  });
}
onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: props.modelValue, extensions: extensions() }),
  });
  reportCursor(view.state);
});
watch(
  () => [props.documentId, props.modelValue] as const,
  ([id, text], [previousId]) => {
    if (!view) return;
    if (id !== previousId) {
      if (props.openIds.includes(previousId))
        states.set(previousId, {
          state: view.state,
          top: view.scrollDOM.scrollTop,
          left: view.scrollDOM.scrollLeft,
        });
      const saved = states.get(id);
      view.setState(saved?.state ?? EditorState.create({ doc: text, extensions: extensions(id) }));
      view.dispatch({
        effects: [
          typography.reconfigure(textAppearance()),
          syntax.reconfigure(language()),
          completion.reconfigure(completions()),
          debugView.reconfigure(debugExtensions()),
          indentation.reconfigure(indentConfig()),
          colorTheme.reconfigure(colors()),
          readOnly.reconfigure([
            EditorState.readOnly.of(!!props.disabled),
            EditorView.editable.of(!props.disabled),
          ]),
        ],
      });
      if (view.state.doc.toString() !== text) applyText(text);
      if (saved)
        view.requestMeasure({
          read: () => saved,
          write: (s) => {
            if (view) {
              view.scrollDOM.scrollTop = s.top;
              view.scrollDOM.scrollLeft = s.left;
            }
          },
        });
      reportCursor(view.state);
    } else if (view.state.doc.toString() !== text) applyText(text);
  },
);
watch(
  () => props.textStyle,
  () => {
    view?.dispatch({ effects: typography.reconfigure(textAppearance()) });
    view?.requestMeasure();
  },
);
watch(
  () => [props.indentSize, props.theme],
  () =>
    view?.dispatch({
      effects: [indentation.reconfigure(indentConfig()), colorTheme.reconfigure(colors())],
    }),
);
watch(
  () => props.disabled,
  (value) =>
    view?.dispatch({
      effects: readOnly.reconfigure([
        EditorState.readOnly.of(!!value),
        EditorView.editable.of(!value),
      ]),
    }),
);
watch(
  () => props.openIds,
  (ids) => {
    for (const id of states.keys()) if (!ids.includes(id)) states.delete(id);
  },
);
watch(
  () => [props.completionEnabled, props.language, props.file],
  () =>
    view?.dispatch({
      effects: [completion.reconfigure(completions()), syntax.reconfigure(language())],
    }),
);
watch(
  () => [props.breakpoints, props.executionLine, props.debugEnabled],
  () => view?.dispatch({ effects: debugView.reconfigure(debugExtensions()) }),
  { deep: true },
);
onBeforeUnmount(() => {
  states.clear();
  view?.destroy();
});
defineExpose({
  applyText,
  jumpLine: (number: number) => {
    if (!view) return;
    const line = view.state.doc.line(Math.max(1, Math.min(number, view.state.doc.lines)));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  },
  focus: () => view?.focus(),
});
</script>
<template><div ref="host" class="code-editor" data-testid="editor"></div></template>

<style>
.source-debug-gutter .cm-gutterElement {
  width: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.source-breakpoint {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d94a4a;
  border: 1px solid transparent;
}
.source-breakpoint.pending {
  background: transparent;
  border-color: #d94a4a;
}
.source-breakpoint.disabled {
  opacity: 0.45;
  background: var(--muted);
}
.source-breakpoint.conditional {
  border-radius: 2px;
  transform: rotate(45deg);
}
.debug-current-line {
  background: color-mix(in srgb, #d7a530 18%, transparent);
}
[data-theme='light'] .source-breakpoint {
  background: #c42b1c;
}
[data-theme='light'] .source-breakpoint.pending {
  background: transparent;
  border-color: #c42b1c;
}
</style>
