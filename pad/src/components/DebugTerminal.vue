<script setup lang="ts">
import { fallbackTextStyle, type TextStyle } from '../typography';
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { terminalCommand } from '../../shared/terminal-keymap';
import { Readline } from '../../vendor/xterm-readline/src/readline';
import '@xterm/xterm/css/xterm.css';
const props = defineProps<{
  running: boolean;
  textStyle?: TextStyle;
  epoch: number;
  historyBytes: number;
  scrollback: number;
  theme: 'light' | 'dark';
  context?: string;
  synchronize?: () => Promise<{ scope: string; cwd: string }>;
  execute?: (
    text: string,
  ) => Promise<{ scope: string; cwd: string; output: string; clear?: boolean }>;
  interrupt?: () => Promise<unknown>;
}>();
const host = ref<HTMLDivElement>();
let terminal: Terminal | undefined,
  readline: Readline | undefined,
  fit: FitAddon,
  observer: ResizeObserver,
  generation = 0,
  executing = false,
  outputTail = Promise.resolve();
const cwd = ref('');
const interactive = () => props.running || !!props.execute;
const win = /^win/i.test(navigator.platform);
function colors() {
  return props.theme === 'light'
    ? {
        background: '#ffffff',
        foreground: '#1f1f1f',
        cursor: '#0067c0',
        selectionBackground: '#add6ff',
      }
    : {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
      };
}
function eof() {
  window.labpad.debugInput(win ? '\x1a\r' : '\x04');
}
async function readLoop(id: number) {
  while (interactive() && id === generation && readline) {
    try {
      const program = props.running,
        text = await readline.read(program ? '> ' : (cwd.value ? './' + cwd.value : './') + ' > ');
      if (id !== generation || !interactive()) return;
      if (program) {
        if (props.running) window.labpad.debugInput(text.replace(/\r?\n/g, '\r') + '\r');
      } else if (props.execute) {
        executing = true;
        try {
          const result = await props.execute(text);
          if (id !== generation || (props.context && result.scope !== props.context)) return;
          cwd.value = result.cwd;
          if (result.clear) readline.clearOutput();
          if (result.output) await write(result.output.replace(/\r?\n/g, '\r\n') + '\r\n');
        } catch (error) {
          if (id === generation)
            await write((error instanceof Error ? error.message : String(error)) + '\r\n');
        } finally {
          if (id === generation) executing = false;
        }
      }
    } catch {
      return;
    }
  }
}
async function begin(preserve = false) {
  const previous = preserve ? readline?.getLine() : '';
  const id = ++generation;
  executing = false;
  readline?.holdInput(false);
  readline?.abortRead();
  readline?.holdInput(true);
  if (terminal && interactive()) terminal.options.disableStdin = false;
  try {
    await outputTail;
    await nextTick();
    if (!props.running && props.synchronize) {
      const state = await props.synchronize();
      if (id !== generation || (props.context && state.scope !== props.context)) return;
      cwd.value = state.cwd;
    }
    if (!interactive() || id !== generation || !terminal) return;
    fit?.fit();
    terminal.options.cursorBlink = true;
    if (!preserve && host.value?.offsetWidth) terminal.focus();
    await new Promise<void>((done) => terminal!.write('', done));
    if (!interactive() || id !== generation) return;
    if (terminal.buffer.active.cursorX)
      await new Promise<void>((done) => terminal!.write('\r\n', done));
    if (id !== generation) return;
    void readLoop(id);
    if (previous) {
      await readline?.whenPromptReady();
      if (id === generation) readline?.updateLine(previous);
    }
  } catch (error) {
    if (id === generation) {
      if (terminal) terminal.options.disableStdin = true;
      await write((error instanceof Error ? error.message : String(error)) + '\r\n');
    }
  }
}
async function refreshDirectory() {
  if (props.running || executing || !props.synchronize) return;
  const scope = props.context,
    id = generation;
  const state = await props.synchronize();
  if (
    id !== generation ||
    scope !== props.context ||
    state.scope !== scope ||
    props.running ||
    executing
  )
    return;
  if (state.cwd !== cwd.value) {
    await readline?.whenPromptReady();
    if (id === generation) await begin(true);
  }
}

function key(event: KeyboardEvent) {
  if (event.type !== 'keydown' || event.isComposing) return true;
  if (event.key === 'Tab' && !props.running && props.execute) {
    event.preventDefault();
    const before = readline?.getLine() ?? '';
    void window.labpad.terminalComplete(before).then((values) => {
      if (readline?.getLine() !== before) return;
      if (values.length === 1) readline.updateLine(values[0]);
      else if (values.length) void write(values.join('  ') + '\r\n');
    });
    return false;
  }
  const selected = terminal?.getSelection() || '',
    command = terminalCommand(
      event,
      navigator.platform,
      !!selected,
      !readline?.getLine(),
      interactive(),
    );
  if (!command) return interactive() ? (readline?.handleKeyEvent(event) ?? true) : true;
  event.preventDefault();
  if (command === 'copy') void window.labpad.copyText(selected);
  if (command === 'interrupt') {
    if (props.running || executing) void (props.interrupt?.() ?? window.labpad.cancel());
    else {
      readline?.updateLine('');
      readline?.abortRead();
      void write('^C\r\n').then(() => begin());
    }
  }
  if (command === 'selectAll') terminal?.selectAll();
  if (command === 'home' || command === 'end')
    terminal?.input(command === 'home' ? '\x01' : '\x05', true);
  if (
    command === 'wordLeft' ||
    command === 'wordRight' ||
    command === 'deleteWordLeft' ||
    command === 'deleteWordRight'
  )
    readline?.moveWord(command.endsWith('Left'), command.startsWith('delete'));
  if (command === 'eof' && props.running) eof();
  return false;
}
onMounted(() => {
  terminal = new Terminal({
    allowProposedApi: true,
    screenReaderMode: false,
    cursorBlink: false,
    disableStdin: true,
    cursorInactiveStyle: 'none',
    scrollback: props.scrollback,
    fontSize: (props.textStyle ?? fallbackTextStyle).fontSize,
    lineHeight: (props.textStyle ?? fallbackTextStyle).lineHeight,
    letterSpacing: (props.textStyle ?? fallbackTextStyle).letterSpacing,
    fontFamily: (props.textStyle ?? fallbackTextStyle).family,
    theme: colors(),
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  readline = new Readline();
  terminal.loadAddon(readline);
  terminal.attachCustomKeyEventHandler(key);
  terminal.open(host.value!);
  terminal.textarea?.setAttribute('aria-label', '终端输入');
  observer = new ResizeObserver(() => {
    if (host.value?.offsetWidth) {
      fit.fit();
      window.labpad.debugResize(terminal!.cols, terminal!.rows);
    }
  });
  observer.observe(host.value!);
  if (interactive()) void begin();
});
watch(
  () => [props.running, props.context],
  () => {
    if (props.context !== lastContext) {
      readline?.resetHistory(props.historyBytes);
      lastContext = props.context;
    }
    if (interactive()) void begin();
    else {
      generation++;
      readline?.abortRead();
      if (terminal) {
        terminal.options.disableStdin = true;
        terminal.options.cursorBlink = false;
      }
    }
  },
);
let lastContext = props.context;
watch(
  () => props.epoch,
  () => readline?.resetHistory(props.historyBytes),
);
watch(
  () => props.historyBytes,
  (value) => readline?.setHistoryLimit(value),
);
watch(
  () => props.textStyle,
  (value) => {
    if (!terminal) return;
    const s = value ?? fallbackTextStyle;
    terminal.options.fontFamily = s.family;
    terminal.options.fontSize = s.fontSize;
    terminal.options.lineHeight = s.lineHeight;
    terminal.options.letterSpacing = s.letterSpacing;
    fit?.fit();
    window.labpad.debugResize(terminal.cols, terminal.rows);
  },
);
watch(
  () => props.theme,
  () => {
    if (terminal) terminal.options.theme = colors();
  },
);
watch(
  () => props.scrollback,
  (value) => {
    if (terminal) terminal.options.scrollback = value;
  },
);
onBeforeUnmount(() => {
  generation++;
  observer?.disconnect();
  readline?.abortRead();
  terminal?.dispose();
});
function write(data: string, done?: () => void) {
  outputTail = outputTail
    .catch(() => {})
    .then(() => readline?.writeAbove(data))
    .then(() => {
      done?.();
    });
  void outputTail.catch(() => done?.());
  return outputTail;
}
defineExpose({
  refreshDirectory,
  write,
  selection: () => terminal?.getSelection() || '',
  clear: () => readline?.clearOutput(),
  eof,
  focus: () => terminal?.focus(),
});
</script>
<template>
  <div class="debug-terminal" data-testid="terminal">
    <div ref="host" class="terminal-viewport"></div>
  </div>
</template>
<style>
.debug-terminal,
.terminal-viewport {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.terminal-viewport {
  padding: 6px 10px;
  box-sizing: border-box;
}
.debug-terminal .xterm {
  height: 100%;
}
</style>
