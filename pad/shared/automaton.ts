import { RE2JS } from 're2js';
import { UIError, t } from './i18n';

type Pattern = { regex: string; description?: string };
type LineMatch = { text: string } | Pattern;

export type AutomatonComparison = {
  type: 'automaton';
  ignoreTrailingSpaces?: boolean;
} & (
  | { template: { lines: string[]; fields?: Record<string, Pattern> }; machine?: never }
  | {
      machine: {
        initial: string;
        accept: string[];
        states: Record<string, { to: string; match: LineMatch }[]>;
      };
      template?: never;
    }
);

export interface AutomatonStep {
  line: number;
  state: string;
  nextState: string;
}

export interface AutomatonFailure {
  reason: 'mismatch' | 'missing' | 'extra' | 'limit';
  line: number;
  state: string;
  expected: string;
  actual: string | null;
  trace: AutomatonStep[];
}

type Matcher = {
  description: string;
  cost: number;
  test: (line: string) => boolean;
};
type Transition = { to: string; match: Matcher };
interface Automaton {
  initial: string;
  accept: Set<string>;
  states: Map<string, Transition[]>;
  ignoreTrailingSpaces: boolean;
}

const limits = {
  states: 129,
  transitions: 256,
  branches: 8,
  fields: 16,
  templateLine: 1024,
  pattern: 512,
  composedPattern: 4096,
  repeat: 100,
  program: 512,
  description: 160,
  line: 16384,
  steps: 512,
  work: 8000000,
  trace: 8,
};
const builtins: Readonly<Record<string, string>> = {
  positiveInteger: '[1-9][0-9]*',
  seconds3: '[0-9]+[.][0-9]{3}',
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

function singleLine(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\r\n]/.test(value);
}

function trimTrailingSpaces(line: string) {
  let end = line.length;
  while (line[end - 1] === ' ' || line[end - 1] === '\t') end--;
  return line.slice(0, end);
}

function invalid(path: string, detail: string): never {
  throw new UIError('{0}: {1}', path, detail);
}

function checkKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) invalid(label, t('Unknown property: {0}', excerpt(extra)));
}

function excerpt(text: string) {
  return text.length > limits.description ? text.slice(0, limits.description) + '…' : text;
}

const compiledPatterns = new Map<string, RE2JS>();

function compilePattern(regex: string, label: string) {
  const existing = compiledPatterns.get(regex);
  if (existing) return existing;
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(regex);
  } catch (error) {
    invalid(label, t('Invalid regular expression: {0}', excerpt(String(error))));
  }
  if (compiled.programSize() > limits.program)
    invalid(label, t('The regular expression is too complex'));
  if (compiledPatterns.size >= 64) compiledPatterns.delete(compiledPatterns.keys().next().value!);
  compiledPatterns.set(regex, compiled);
  return compiled;
}

function pattern(value: unknown, label: string): Pattern {
  if (!record(value) || !singleLine(value.regex, limits.pattern) || !value.regex.length)
    invalid(
      label,
      t('Specify a regular expression of 1–{0} characters on one line', limits.pattern),
    );
  checkKeys(value, ['regex', 'description'], label);
  if (
    value.description !== undefined &&
    (!singleLine(value.description, limits.description) || !value.description.trim())
  )
    invalid(label, t('Provide a short description on one line'));
  // The engine bounds nested counted repetitions. Limit individual counts before compilation.
  for (const [, min, max] of value.regex.matchAll(/\{(\d+)(?:,(\d*))?\}/g))
    if (Number(min) > limits.repeat || Number(max || 0) > limits.repeat)
      invalid(label, t('Counted repetitions may use bounds up to {0}', limits.repeat));
  return { regex: value.regex, description: value.description as string | undefined };
}

function regexMatcher(compiled: RE2JS, description: string): Matcher {
  return {
    description: excerpt(description),
    cost: compiled.programSize(),
    test: (line) => compiled.testExact(line),
  };
}

function textMatcher(text: string): Matcher {
  return { description: JSON.stringify(excerpt(text)), cost: 1, test: (line) => line === text };
}

function templateLine(source: string, fields: Map<string, Pattern>, label: string): Matcher {
  const parts: string[] = [];
  const display: string[] = [];
  let cursor = 0;

  for (const match of source.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const literal = source.slice(cursor, match.index);
    const field = fields.get(match[1]);
    if (literal.includes('{{') || !field)
      invalid(label, t('Unknown or malformed template field: {0}', excerpt(match[0])));
    parts.push(RE2JS.quote(literal), '(?:' + field.regex + ')');
    display.push(literal, field.description ? '[' + field.description + ']' : match[0]);
    cursor = match.index + match[0].length;
  }
  const rest = source.slice(cursor);
  if (rest.includes('{{')) invalid(label, t('An opening {{ needs a complete template field'));
  if (!parts.length) return textMatcher(source);
  parts.push(RE2JS.quote(rest));
  display.push(rest);
  const regex = parts.join('');
  if (regex.length > limits.composedPattern)
    invalid(label, t('The combined template pattern is too long'));
  return regexMatcher(compilePattern(regex, label), display.join(''));
}

function compileTemplate(value: unknown, label: string, ignoreTrailingSpaces: boolean): Automaton {
  if (!record(value) || !Array.isArray(value.lines) || value.lines.length >= limits.states)
    invalid(label, t('Provide a lines array with up to {0} entries', limits.states - 1));
  checkKeys(value, ['lines', 'fields'], label);
  const fields = new Map<string, Pattern>([
    ['positiveInteger', { regex: builtins.positiveInteger, description: t('positive integer') }],
    [
      'seconds3',
      { regex: builtins.seconds3, description: t('nonnegative seconds to three decimal places') },
    ],
  ]);
  if (value.fields !== undefined) {
    if (!record(value.fields) || Object.keys(value.fields).length > limits.fields)
      invalid(label, t('Provide up to {0} custom fields in a fields object', limits.fields));
    for (const [name, definition] of Object.entries(value.fields)) {
      const fieldLabel = label + '.fields.' + name;
      if (!identifier(name) || fields.has(name))
        invalid(fieldLabel, t('Use a unique field name distinct from the built-in fields'));
      const field = pattern(definition, fieldLabel);
      compilePattern(field.regex, fieldLabel);
      fields.set(name, field);
    }
  }
  const states = new Map<string, Transition[]>();
  const initial = 'line-1';
  const accept = 'end';
  for (const [index, source] of value.lines.entries()) {
    const lineLabel = label + '.lines[' + index + ']';
    if (!singleLine(source, limits.templateLine))
      invalid(lineLabel, t('Use a single line of up to {0} characters', limits.templateLine));
    const to = index + 1 === value.lines.length ? accept : 'line-' + (index + 2);
    const line = ignoreTrailingSpaces ? trimTrailingSpaces(source) : source;
    states.set('line-' + (index + 1), [{ to, match: templateLine(line, fields, lineLabel) }]);
  }
  states.set(accept, []);
  return {
    initial: value.lines.length ? initial : accept,
    accept: new Set([accept]),
    states,
    ignoreTrailingSpaces,
  };
}

function compileMachine(value: unknown, label: string, ignoreTrailingSpaces: boolean): Automaton {
  if (!record(value) || !record(value.states))
    invalid(label, t('Provide a machine with initial, accept, and states'));
  checkKeys(value, ['initial', 'accept', 'states'], label);
  const names = Object.keys(value.states);
  const known = new Set(names);
  if (names.length > limits.states || names.some((name) => !identifier(name)))
    invalid(label + '.states', t('Use up to {0} valid state names', limits.states));
  if (!identifier(value.initial) || !known.has(value.initial))
    invalid(label + '.initial', t('Reference a declared state'));
  if (
    !Array.isArray(value.accept) ||
    !value.accept.length ||
    value.accept.length > names.length ||
    value.accept.some((name) => !known.has(name)) ||
    new Set(value.accept).size !== value.accept.length
  )
    invalid(label + '.accept', t('List one or more distinct declared states'));

  const accept = new Set<string>(value.accept);
  const states = new Map<string, Transition[]>();
  let edgeCount = 0;
  for (const [name, edges] of Object.entries(value.states)) {
    const stateLabel = label + '.states.' + name;
    if (!Array.isArray(edges) || edges.length > limits.branches)
      invalid(stateLabel, t('Provide an array of up to {0} transitions', limits.branches));
    edgeCount += edges.length;
    if (edgeCount > limits.transitions)
      invalid(label, t('Use up to {0} transitions per machine', limits.transitions));
    if (accept.has(name) && edges.length)
      invalid(stateLabel, t('An accepting state must have no outgoing transitions'));
    states.set(
      name,
      edges.map((edge: unknown, index: number) => {
        const edgeLabel = stateLabel + '[' + index + ']';
        if (!record(edge) || !identifier(edge.to) || !known.has(edge.to))
          invalid(edgeLabel + '.to', t('Reference a declared state'));
        checkKeys(edge, ['to', 'match'], edgeLabel);
        if (!record(edge.match) || 'text' in edge.match === 'regex' in edge.match)
          invalid(edgeLabel + '.match', t('Specify exactly one of text or regex'));
        if ('text' in edge.match) {
          checkKeys(edge.match, ['text'], edgeLabel + '.match');
          if (!singleLine(edge.match.text, limits.templateLine))
            invalid(
              edgeLabel + '.match.text',
              t('Use a single line of up to {0} characters', limits.templateLine),
            );
          const text = ignoreTrailingSpaces ? trimTrailingSpaces(edge.match.text) : edge.match.text;
          return { to: edge.to, match: textMatcher(text) };
        }
        const field = pattern(edge.match, edgeLabel + '.match');
        return {
          to: edge.to,
          match: regexMatcher(
            compilePattern(field.regex, edgeLabel + '.match.regex'),
            field.description ?? '/' + field.regex + '/',
          ),
        };
      }),
    );
  }
  const reached = new Set([value.initial]);
  for (const name of reached) for (const edge of states.get(name)!) reached.add(edge.to);
  if ([...accept].some((name) => !reached.has(name)))
    invalid(label + '.accept', t('Each accepting state must be reachable from the initial state'));
  return { initial: value.initial, accept, states, ignoreTrailingSpaces };
}

export function compileAutomaton(value: unknown, label = t('Output Automaton')): Automaton {
  if (!record(value) || (value.template === undefined) === (value.machine === undefined))
    invalid(label, t('Specify exactly one of template or machine'));
  checkKeys(value, ['type', 'template', 'machine', 'ignoreTrailingSpaces'], label);
  if (value.ignoreTrailingSpaces !== undefined && typeof value.ignoreTrailingSpaces !== 'boolean')
    invalid(label + '.ignoreTrailingSpaces', t('Use true or false'));
  const trim = value.ignoreTrailingSpaces === true;
  return value.template !== undefined
    ? compileTemplate(value.template, label + '.template', trim)
    : compileMachine(value.machine, label + '.machine', trim);
}

export function checkAutomaton(stdout: string, plan: Automaton) {
  let state = plan.initial;
  let line = 1;
  let offset = 0;
  let remaining = limits.work;
  const trace: AutomatonStep[] = [];
  const fail = (reason: AutomatonFailure['reason'], expected: string, actual: string | null) => {
    const failure: AutomatonFailure = { reason, state, line, expected, actual, trace };
    const observed = actual === null ? t('end of file') : JSON.stringify(actual);
    return {
      accepted: false as const,
      failure,
      message: t('Line {0} · state {1} · expected {2} · got {3}', line, state, expected, observed),
    };
  };
  const expected = (edges: Transition[]) =>
    edges.length
      ? edges.map(({ match }) => match.description).join(' | ')
      : t('an accepting state');

  // Each transition consumes exactly one stdout line. EOF is checked separately.
  while (offset < stdout.length) {
    const newline = stdout.indexOf('\n', offset);
    const end = newline === -1 ? stdout.length : newline - Number(stdout[newline - 1] === '\r');
    const preview = () =>
      stdout.slice(offset, Math.min(end, offset + limits.description)) +
      (end - offset > limits.description ? '…' : '');
    if (plan.accept.has(state)) return fail('extra', t('end of file'), preview());
    if (line > limits.steps)
      return fail('limit', t('at most {0} output lines', limits.steps), preview());
    if (end - offset > limits.line)
      return fail('limit', t('a line of up to {0} characters', limits.line), preview());

    const raw = stdout.slice(offset, end);
    const text = plan.ignoreTrailingSpaces ? trimTrailingSpaces(raw) : raw;
    const edges = plan.states.get(state)!;
    let next: Transition | undefined;
    for (const edge of edges) {
      remaining -= Math.max(1, text.length) * edge.match.cost;
      if (remaining < 0) return fail('limit', t('output within the matching budget'), preview());
      if (edge.match.test(text)) {
        next = edge;
        break;
      }
    }
    if (!next) return fail('mismatch', expected(edges), preview());
    trace.push({ line, state, nextState: next.to });
    if (trace.length > limits.trace) trace.shift();
    state = next.to;
    line++;
    offset = newline === -1 ? stdout.length : newline + 1;
  }
  return plan.accept.has(state)
    ? { accepted: true as const, message: t('Output matches the automaton') }
    : fail('missing', expected(plan.states.get(state)!), null);
}
