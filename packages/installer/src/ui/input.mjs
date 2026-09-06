const CONTROL_MODIFIER = 2;

const CSI_KEYS = {
  A: "ArrowUp",
  B: "ArrowDown",
  C: "ArrowRight",
  D: "ArrowLeft",
  H: "Home",
  F: "End"
};

const TILDE_KEYS = {
  "1": "Home",
  "3": "Delete",
  "4": "End",
  "5": "PageUp",
  "6": "PageDown"
};

export function parseInput(chunk) {
  const events = [];
  let index = 0;
  while (index < chunk.length) {
    const character = chunk[index];
    if (character === "\u001b") {
      const consumed = parseEscape(chunk, index, events);
      if (consumed > 0) {
        index += consumed;
        continue;
      }
      events.push({ kind: "key", code: "Escape" });
      index += 1;
      continue;
    }
    const code = chunk.charCodeAt(index);
    if (code === 3) {
      events.push({ kind: "key", code: "c", modifiers: CONTROL_MODIFIER });
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      events.push({ kind: "key", code: "Enter" });
      index += 1;
      continue;
    }
    if (character === "\t") {
      events.push({ kind: "key", code: "Tab" });
      index += 1;
      continue;
    }
    if (character === " ") {
      events.push({ kind: "key", code: "Space", text: character });
      index += 1;
      continue;
    }
    if (code === 127 || code === 8) {
      events.push({ kind: "key", code: "Backspace" });
      index += 1;
      continue;
    }
    if (code < 32) {
      index += 1;
      continue;
    }
    events.push({ kind: "key", code: character, text: character });
    index += 1;
  }
  return events;
}

function parseEscape(chunk, start, events) {
  const rest = chunk.slice(start);
  const mouse = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
  if (mouse) {
    events.push(mouseEvent(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4]));
    return mouse[0].length;
  }
  const arrow = /^\u001b\[([A-HF])/.exec(rest);
  if (arrow && CSI_KEYS[arrow[1]]) {
    events.push({ kind: "key", code: CSI_KEYS[arrow[1]] });
    return arrow[0].length;
  }
  const tilde = /^\u001b\[(\d+)~/.exec(rest);
  if (tilde && TILDE_KEYS[tilde[1]]) {
    events.push({ kind: "key", code: TILDE_KEYS[tilde[1]] });
    return tilde[0].length;
  }
  const shiftTab = /^\u001b\[Z/.exec(rest);
  if (shiftTab) {
    events.push({ kind: "key", code: "Tab", modifiers: 1 });
    return shiftTab[0].length;
  }
  const paste = /^\u001b\[200~([\s\S]*?)\u001b\[201~/.exec(rest);
  if (paste) {
    events.push({ kind: "paste", text: paste[1] });
    return paste[0].length;
  }
  const csi = /^\u001b\[[0-9;?]*[A-Za-z]/.exec(rest);
  if (csi) return csi[0].length;
  const osc = /^\u001b\][\s\S]*?(?:\u0007|\u001b\\)/.exec(rest);
  if (osc) return osc[0].length;
  return 0;
}

function mouseEvent(rawButton, column, row, terminator) {
  const x = Math.max(0, column - 1);
  const y = Math.max(0, row - 1);
  const wheel = (rawButton & 64) !== 0;
  const motion = (rawButton & 32) !== 0;
  const button = rawButton & 3;
  if (wheel) {
    return { kind: "mouse", action: "scroll", x, y, deltaY: button === 0 ? -1 : 1, button: "middle" };
  }
  const name = button === 0 ? "left" : button === 1 ? "middle" : "right";
  if (terminator === "m") return { kind: "mouse", action: "release", button: name, x, y };
  if (motion) return { kind: "mouse", action: "drag", button: name, x, y };
  return { kind: "mouse", action: "press", button: name, x, y };
}
