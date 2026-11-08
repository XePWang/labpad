import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { t } from '../i18n';

// Keep CodeMirror's native phrase keys and $ placeholders intact.
const phrases: Record<string, string> = {
  Find: 'Find',
  Replace: 'Replace',
  next: 'Next Match',
  previous: 'Previous Match',
  all: 'Select All Matches',
  'match case': 'Match Case',
  regexp: 'Use Regular Expression',
  'by word': 'Match Whole Word',
  replace: 'Replace Next',
  'replace all': 'Replace All',
  close: 'Close (Esc)',
  'current match': 'Current Match',
  'on line': 'On Line',
  'replaced $ matches': 'Replaced $ Matches',
  'replaced match on line $': 'Replaced Match on Line $',
  'Go to line': 'Go to Line',
  go: 'Go',
  Completions: 'Completions',
  'folded code': 'Folded Code',
  to: 'To',
  unfold: 'Unfold',
  'Control character': 'Control Character',
  'Selection deleted': 'Selection Deleted',
};

export function editorLocale() {
  return [
    EditorState.phrases.of(
      Object.fromEntries(Object.entries(phrases).map(([key, message]) => [key, t(message)])),
    ),
    EditorView.contentAttributes.of({ 'aria-label': t('Source Editor') }),
  ];
}
