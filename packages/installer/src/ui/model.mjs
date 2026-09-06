import {
  Container,
  Divider,
  Gauge,
  KeyHint,
  Panel,
  Row,
  Stack,
  Text,
  signal
} from "@slate-terminal/react";
import { applyPlan, planInstall } from "../install.mjs";

export const THEME = {
  colors: {
    primary: "#7ecdf1",
    foreground: "#c9dcec",
    muted: "#58799d",
    surface: "#131f2f",
    heading: "#aae2f8",
    subheading: "#83b7e2",
    success: "#5fd2f2",
    danger: "#f2777a",
    divider: "#3a567a",
    badge: "#131f2f",
    badgeForeground: "#aae2f8"
  },
  border: "rounded"
};

const OPTION_ROWS = [
  { id: "statusline", label: "Configure the status line", hint: "custom badge in Claude and Grok; native Codex footer" },
  { id: "userProtocol", label: "Copy the protocol into the user config", hint: "adds CLAUDE.md or AGENTS.md at the agent home" },
  { id: "dryRun", label: "Dry run", hint: "show every step without touching a file" }
];

const HIGHLIGHT = "#16283d";
const BACKGROUND = "#0b131f";
const CONTROL_MODIFIER = 2;

export function createInstallerModel(targets, initialOptions = {}, hooks = {}) {
  const phase = signal("select");
  const cursor = signal(0);
  const selected = signal(targets.filter(target => target.installed).map(target => target.id));
  const options = signal({ statusline: true, userProtocol: false, dryRun: false, ...initialOptions });
  const results = signal([]);
  const total = signal(0);
  const rows = [
    ...targets.map(target => ({ kind: "target", id: target.id, target })),
    ...OPTION_ROWS.map(option => ({ kind: "option", id: option.id, option }))
  ];
  const selectable = rows.map((row, index) => ({ row, index })).filter(entry => entry.row.kind === "option" || entry.row.target.installed).map(entry => entry.index);
  if (selectable.length > 0) cursor.set(selectable[0]);

  const move = direction => {
    if (selectable.length === 0) return;
    const position = selectable.indexOf(cursor.peek());
    const next = position === -1 ? 0 : (position + direction + selectable.length) % selectable.length;
    cursor.set(selectable[next]);
  };

  const toggle = index => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "target") {
      if (!row.target.installed) return;
      const current = selected.peek();
      selected.set(current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id]);
      return;
    }
    const current = options.peek();
    options.set({ ...current, [row.id]: !current[row.id] });
  };

  const start = schedule => {
    if (phase.peek() !== "select" || selected.peek().length === 0) return;
    phase.set("running");
    const { plan } = planInstall(selected.peek(), options.peek(), hooks.env, hooks.home);
    const steps = plan.flatMap(group => group.steps.map(step => ({ group, step })));
    total.set(steps.length);
    let index = 0;
    const next = () => {
      if (index >= steps.length) {
        phase.set("done");
        hooks.onFinished?.(results.peek());
        return;
      }
      const { group, step } = steps[index];
      index += 1;
      const record = applyPlan([{ ...group, steps: [step] }], { dryRun: options.peek().dryRun })[0];
      results.set([...results.peek(), record]);
      schedule(next);
    };
    schedule(next);
  };

  const handleKey = (event, exit) => {
    if (event.kind !== "key") return "ignored";
    if (event.code === "c" && (event.modifiers & CONTROL_MODIFIER) !== 0) {
      exit?.();
      return "consumed";
    }
    if (event.code === "ArrowDown") {
      move(1);
      return "render";
    }
    if (event.code === "ArrowUp") {
      move(-1);
      return "render";
    }
    if (event.code === "Space") {
      toggle(cursor.peek());
      return "render";
    }
    if (event.code === "Enter") {
      if (phase.peek() === "done") {
        exit?.();
        return "consumed";
      }
      start(callback => setTimeout(callback, 24));
      return "render";
    }
    if (event.code === "q" || event.code === "Escape") {
      exit?.();
      return "consumed";
    }
    return "ignored";
  };

  const view = () => Container({
    id: "root",
    direction: "column",
    padding: 1,
    gap: 1,
    background: BACKGROUND,
    foreground: THEME.colors.foreground,
    children: [
      header(),
      phase.get() === "select" ? selection(rows, cursor, selected, options, toggle) : progress(results, total, phase),
      footer(phase)
    ]
  });

  return { view, phase, cursor, selected, options, results, total, rows, move, toggle, start, handleKey };
}

function header() {
  return Stack({
    id: "header",
    children: [
      Row({
        id: "title",
        spacing: 1,
        children: [
          Text({ id: "title:tag", text: " Prumo ", background: THEME.colors.badge, foreground: THEME.colors.badgeForeground, textStyle: { bold: true } }),
          Text({ id: "title:name", text: "installer", foreground: THEME.colors.heading, textStyle: { bold: true } })
        ]
      }),
      Text({ id: "subtitle", text: "One protocol, agent-native lifecycle hooks, verified delivery.", foreground: THEME.colors.muted }),
      Divider({ id: "header:divider", width: "100%" })
    ]
  });
}

function selection(rows, cursor, selected, options, toggle) {
  const entries = rows.map((row, index) => ({ row, index }));
  return Stack({
    id: "selection",
    gap: 1,
    children: [
      Panel({
        id: "agents",
        title: "Agents on this machine",
        children: Stack({ id: "agents:list", children: entries.filter(entry => entry.row.kind === "target").map(entry => targetRow(entry, cursor, selected, toggle)) })
      }),
      Panel({
        id: "options",
        title: "Options",
        children: Stack({ id: "options:list", children: entries.filter(entry => entry.row.kind === "option").map(entry => optionRow(entry, cursor, options, toggle)) })
      })
    ]
  });
}

function targetRow(entry, cursor, selected, toggle) {
  const target = entry.row.target;
  const active = cursor.get() === entry.index;
  const checked = selected.get().includes(target.id);
  const capabilities = [
    target.capabilities.hooks ? "hooks" : undefined,
    target.capabilities.statusline === true ? "status line" : typeof target.capabilities.statusline === "string" ? `status line (${target.capabilities.statusline})` : undefined,
    target.capabilities.protocolFile
  ].filter(Boolean).join("  ");
  return Row({
    id: `agent:${target.id}`,
    spacing: 1,
    focusable: target.installed,
    background: active ? HIGHLIGHT : undefined,
    onMouse: event => {
      if (event.action !== "press") return "ignored";
      cursor.set(entry.index);
      toggle(entry.index);
      return "render";
    },
    children: [
      Text({ id: `agent:${target.id}:box`, text: target.installed ? (checked ? "●" : "○") : "·", foreground: target.installed ? THEME.colors.primary : THEME.colors.muted }),
      Text({ id: `agent:${target.id}:label`, text: target.label.padEnd(22), foreground: target.installed ? THEME.colors.foreground : THEME.colors.muted }),
      Text({ id: `agent:${target.id}:caps`, text: capabilities, foreground: THEME.colors.muted }),
      Text({ id: `agent:${target.id}:evidence`, text: target.evidence, foreground: target.installed ? THEME.colors.subheading : THEME.colors.muted })
    ]
  });
}

function optionRow(entry, cursor, options, toggle) {
  const option = entry.row.option;
  const active = cursor.get() === entry.index;
  const checked = Boolean(options.get()[option.id]);
  return Row({
    id: `option:${option.id}`,
    spacing: 1,
    focusable: true,
    background: active ? HIGHLIGHT : undefined,
    onMouse: event => {
      if (event.action !== "press") return "ignored";
      cursor.set(entry.index);
      toggle(entry.index);
      return "render";
    },
    children: [
      Text({ id: `option:${option.id}:box`, text: checked ? "●" : "○", foreground: THEME.colors.primary }),
      Text({ id: `option:${option.id}:label`, text: option.label.padEnd(38), foreground: THEME.colors.foreground }),
      Text({ id: `option:${option.id}:hint`, text: option.hint, foreground: THEME.colors.muted })
    ]
  });
}

function progress(results, total, phase) {
  const records = results.get();
  const count = total.get();
  const failed = records.filter(record => record.status === "failed");
  return Stack({
    id: "progress",
    gap: 1,
    children: [
      Gauge({ id: "progress:bar", label: phase.get() === "done" ? "Finished" : "Installing", value: count === 0 ? 0 : records.length / count, max: 1, size: 28 }),
      Panel({
        id: "progress:panel",
        title: `${records.length} of ${count} steps`,
        children: Stack({
          id: "progress:list",
          children: records.slice(-14).map((record, index) => Row({
            id: `step:${index}`,
            spacing: 1,
            children: [
              Text({ id: `step:${index}:status`, text: statusLabel(record.status), foreground: statusColor(record.status) }),
              Text({ id: `step:${index}:target`, text: record.label.padEnd(16), foreground: THEME.colors.subheading }),
              Text({ id: `step:${index}:title`, text: record.title, foreground: THEME.colors.foreground })
            ]
          }))
        })
      }),
      failed.length > 0
        ? Text({ id: "progress:failed", text: `${failed.length} step(s) failed: ${failed.map(record => record.error).join("; ")}`, foreground: THEME.colors.danger })
        : null
    ]
  });
}

function statusLabel(status) {
  if (status === "applied") return "done";
  if (status === "failed") return "fail";
  return "plan";
}

function statusColor(status) {
  if (status === "applied") return THEME.colors.success;
  if (status === "failed") return THEME.colors.danger;
  return THEME.colors.muted;
}

function footer(phase) {
  const hints = phase.get() === "select"
    ? [
      { key: "up down", label: "move" },
      { key: "space", label: "toggle" },
      { key: "click", label: "toggle" },
      { key: "enter", label: "install" },
      { key: "q", label: "quit" }
    ]
    : [
      { key: "enter", label: "close" },
      { key: "q", label: "quit" }
    ];
  return Stack({ id: "footer", children: [Divider({ id: "footer:divider", width: "100%" }), KeyHint({ id: "footer:hints", hints })] });
}
