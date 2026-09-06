import {
  createSlateApp,
  createSlateOutput,
  createTerminalController,
  openInteractiveConsole,
  setTheme
} from "@slate-terminal/react";
import { createInstallerModel, THEME } from "./model.mjs";
import { parseInput } from "./input.mjs";

export function runInstallerUi(targets, initialOptions = {}) {
  return new Promise(resolve => {
    setTheme(THEME);
    const terminal = openInteractiveConsole({ mouse: true, paste: false });
    const model = createInstallerModel(targets, initialOptions);
    const app = createSlateApp(model.view, { viewport: terminal.size(), frameRate: 30 });
    const queue = [];
    let closed = false;

    const finish = () => {
      if (closed) return;
      closed = true;
      controller.close();
      terminal.close();
      resolve({ selected: model.selected.peek(), options: model.options.peek(), results: model.results.peek() });
    };

    terminal.onData(chunk => {
      for (const event of parseInput(chunk)) queue.push(event);
    });
    terminal.onResize(size => app.setViewport(size));
    app.subscribeInput(event => model.handleKey(event, finish));

    const controller = createTerminalController(
      app,
      { poll: () => queue.shift() ?? null, size: () => terminal.size() },
      createSlateOutput(process.stdout),
      { intervalMs: 16, animationFps: 20, onExit: finish }
    );
    controller.start();
  });
}
