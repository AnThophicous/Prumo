const BOM = "\uFEFF";

export class JsoncError extends Error {
  constructor(message, offset) {
    super(offset === undefined ? message : `${message} at offset ${offset}`);
    this.name = "JsoncError";
    this.offset = offset;
  }
}

export function detectFormat(text) {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  const eol = /\r\n/.test(body) ? "\r\n" : "\n";
  const indentMatch = body.match(/\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : "  ";
  const trailingNewline = /\n$/.test(body) || body.length === 0;
  return { bom, eol, indent, trailingNewline, body };
}

export function parseJsonc(text) {
  const { body } = detectFormat(text);
  const parser = new Parser(body);
  parser.skipTrivia();
  if (parser.eof()) return { root: undefined, empty: true, body };
  const root = parser.parseValue();
  parser.skipTrivia();
  if (!parser.eof()) throw new JsoncError("unexpected trailing content", parser.index);
  return { root, empty: false, body };
}

export function evaluate(node) {
  if (!node) return undefined;
  if (node.type === "object") {
    const value = {};
    for (const entry of node.entries) value[entry.key] = evaluate(entry.value);
    return value;
  }
  if (node.type === "array") return node.items.map(evaluate);
  return node.value;
}

export function readJsoncObject(text) {
  const { root, empty } = parseJsonc(text);
  if (empty) return {};
  if (root.type !== "object") throw new JsoncError("expected a JSON object at the top level");
  return evaluate(root);
}

export function getPath(text, path) {
  const { root, empty } = parseJsonc(text);
  if (empty) return undefined;
  let node = root;
  for (const segment of path) {
    if (!node) return undefined;
    if (node.type === "object") node = node.entries.find(entry => entry.key === segment)?.value;
    else if (node.type === "array" && typeof segment === "number") node = node.items[segment];
    else return undefined;
  }
  return evaluate(node);
}

export function setPath(text, path, value) {
  return edit(text, path.slice(0, -1), (container, format, depth) => {
    const key = path.at(-1);
    if (container.type !== "object") throw new JsoncError(`cannot set key "${key}" on a non-object`);
    const literal = serialize(value, format, depth + 1);
    const existing = container.entries.find(entry => entry.key === key);
    if (existing) return { start: existing.value.start, end: existing.value.end, text: literal };
    return insertEntry(container, `${JSON.stringify(key)}: ${literal}`, format, depth);
  }, { createObjects: true });
}

export function appendToArray(text, path, value) {
  return edit(text, path, (container, format, depth) => {
    if (container.type !== "array") throw new JsoncError(`cannot append to a non-array at ${path.join(".")}`);
    const literal = serialize(value, format, depth + 1);
    return insertItem(container, literal, format, depth);
  }, { createObjects: true, createArrayAtLeaf: true });
}

export function removeArrayItems(text, path, predicate) {
  const format = detectFormat(text);
  let body = format.body;
  let removed = 0;
  for (;;) {
    const parsed = parseJsonc(body);
    if (parsed.empty) break;
    const container = locate(parsed.root, path);
    if (!container || container.type !== "array") break;
    const doomed = container.items.find(item => predicate(evaluate(item)));
    if (!doomed) break;
    body = cutRange(body, itemRange(container, doomed, body));
    removed += 1;
  }
  return { text: removed === 0 ? text : assemble(body, format), removed };
}

export function removeKey(text, path) {
  const parsed = parseJsonc(text);
  if (parsed.empty) return { text, removed: false };
  const format = detectFormat(text);
  const container = locate(parsed.root, path.slice(0, -1));
  if (!container || container.type !== "object") return { text, removed: false };
  const entry = container.entries.find(candidate => candidate.key === path.at(-1));
  if (!entry) return { text, removed: false };
  const body = cutRange(parsed.body, itemRange(container, entry, parsed.body));
  return { text: assemble(body, format), removed: true };
}

function cutRange(body, range) {
  const ranges = range.ranges ?? [range];
  let output = body;
  for (const piece of [...ranges].sort((left, right) => right.start - left.start)) output = output.slice(0, piece.start) + output.slice(piece.end);
  return output;
}

function edit(text, containerPath, mutate, options) {
  const format = detectFormat(text);
  let parsed = parseJsonc(text);
  if (parsed.empty) {
    const seeded = assemble(`{${format.eol}}`, format);
    return edit(seeded, containerPath, mutate, options);
  }
  let body = parsed.body;
  let node = parsed.root;
  let depth = 0;
  for (let index = 0; index < containerPath.length; index += 1) {
    const segment = containerPath[index];
    if (node.type !== "object") throw new JsoncError(`cannot descend into "${segment}" through a non-object`);
    const entry = node.entries.find(candidate => candidate.key === segment);
    if (!entry) {
      if (!options.createObjects) throw new JsoncError(`missing key "${segment}"`);
      const isLeaf = index === containerPath.length - 1;
      const literal = isLeaf && options.createArrayAtLeaf ? "[]" : "{}";
      const insertion = insertEntry(node, `${JSON.stringify(segment)}: ${literal}`, format, depth);
      body = body.slice(0, insertion.start) + insertion.text + body.slice(insertion.end);
      parsed = parseJsonc(body);
      node = locate(parsed.root, containerPath.slice(0, index + 1));
      depth += 1;
      continue;
    }
    node = entry.value;
    depth += 1;
  }
  const change = mutate(node, format, depth);
  body = body.slice(0, change.start) + change.text + body.slice(change.end);
  return assemble(body, format);
}

function locate(root, path) {
  let node = root;
  for (const segment of path) {
    if (!node || node.type !== "object") return undefined;
    node = node.entries.find(entry => entry.key === segment)?.value;
  }
  return node;
}

function insertEntry(container, entryText, format, depth) {
  const indent = format.indent.repeat(depth + 1);
  const closingIndent = format.indent.repeat(depth);
  if (container.entries.length === 0) {
    return { start: container.start + 1, end: container.end - 1, text: `${format.eol}${indent}${entryText}${format.eol}${closingIndent}` };
  }
  const last = container.entries.at(-1);
  const separator = container.multiline ? `,${format.eol}${indent}` : ", ";
  return { start: last.value.end, end: last.value.end, text: `${separator}${entryText}` };
}

function insertItem(container, itemText, format, depth) {
  const indent = format.indent.repeat(depth + 1);
  const closingIndent = format.indent.repeat(depth);
  if (container.items.length === 0) {
    return { start: container.start + 1, end: container.end - 1, text: `${format.eol}${indent}${itemText}${format.eol}${closingIndent}` };
  }
  const last = container.items.at(-1);
  const separator = container.multiline ? `,${format.eol}${indent}` : ", ";
  return { start: last.end, end: last.end, text: `${separator}${itemText}` };
}

function itemRange(container, item, body) {
  const siblings = container.type === "array" ? container.items : container.entries;
  const index = siblings.indexOf(item);
  const itemStart = container.type === "array" ? item.start : item.keyStart;
  const itemEnd = container.type === "array" ? item.end : item.value.end;
  if (siblings.length === 1) return { start: container.start + 1, end: container.end - 1 };
  if (index === siblings.length - 1) {
    const previous = siblings[index - 1];
    const previousEnd = container.type === "array" ? previous.end : previous.value.end;
    const comma = body.indexOf(",", previousEnd);
    const lineEnd = comma === -1 ? -1 : body.indexOf("\n", comma);
    if (comma !== -1 && lineEnd !== -1 && lineEnd < itemStart && body.slice(comma + 1, lineEnd).trim().length > 0) {
      return { ranges: [{ start: comma, end: comma + 1 }, { start: lineEnd, end: itemEnd }] };
    }
    return { start: previousEnd, end: itemEnd };
  }
  const next = siblings[index + 1];
  const nextStart = container.type === "array" ? next.start : next.keyStart;
  return { start: itemStart, end: nextStart };
}

function serialize(value, format, depth) {
  const text = JSON.stringify(value, null, format.indent);
  if (text === undefined) throw new JsoncError("cannot serialize undefined");
  const indent = format.indent.repeat(depth);
  return text.split("\n").map((line, index) => (index === 0 ? line : `${indent}${line}`)).join(format.eol);
}

function assemble(body, format) {
  let output = body;
  if (format.trailingNewline && !output.endsWith("\n")) output += format.eol;
  return (format.bom ? BOM : "") + output;
}

class Parser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  eof() {
    return this.index >= this.source.length;
  }

  peek() {
    return this.source[this.index];
  }

  skipTrivia() {
    for (;;) {
      const character = this.peek();
      if (character === undefined) return;
      if (/\s/.test(character)) {
        this.index += 1;
        continue;
      }
      if (character === "/" && this.source[this.index + 1] === "/") {
        while (!this.eof() && this.peek() !== "\n") this.index += 1;
        continue;
      }
      if (character === "/" && this.source[this.index + 1] === "*") {
        const end = this.source.indexOf("*/", this.index + 2);
        if (end === -1) throw new JsoncError("unterminated block comment", this.index);
        this.index = end + 2;
        continue;
      }
      return;
    }
  }

  parseValue() {
    this.skipTrivia();
    const character = this.peek();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t" && this.source.startsWith("true", this.index)) return this.literal(4, true);
    if (character === "f" && this.source.startsWith("false", this.index)) return this.literal(5, false);
    if (character === "n" && this.source.startsWith("null", this.index)) return this.literal(4, null);
    const number = this.source.slice(this.index).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
    if (number) return this.literal(number[0].length, Number(number[0]));
    throw new JsoncError(`unexpected character "${character ?? "EOF"}"`, this.index);
  }

  literal(length, value) {
    const start = this.index;
    this.index += length;
    return { type: "literal", value, start, end: this.index };
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    let raw = '"';
    while (!this.eof()) {
      const character = this.peek();
      raw += character;
      this.index += 1;
      if (character === "\\") {
        raw += this.peek() ?? "";
        this.index += 1;
        continue;
      }
      if (character === '"') return { type: "literal", value: JSON.parse(raw), start, end: this.index };
    }
    throw new JsoncError("unterminated string", start);
  }

  parseObject() {
    const start = this.index;
    this.index += 1;
    const entries = [];
    let multiline = false;
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "}") break;
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() !== '"') throw new JsoncError("expected a string key", this.index);
      const key = this.parseString();
      this.skipTrivia();
      if (this.peek() !== ":") throw new JsoncError("expected ':'", this.index);
      this.index += 1;
      const value = this.parseValue();
      entries.push({ key: key.value, keyStart: key.start, value });
      this.skipTrivia();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "}") break;
      throw new JsoncError("expected ',' or '}'", this.index);
    }
    this.index += 1;
    multiline = this.source.slice(start, this.index).includes("\n");
    return { type: "object", entries, start, end: this.index, multiline };
  }

  parseArray() {
    const start = this.index;
    this.index += 1;
    const items = [];
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "]") break;
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      items.push(this.parseValue());
      this.skipTrivia();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "]") break;
      throw new JsoncError("expected ',' or ']'", this.index);
    }
    this.index += 1;
    return { type: "array", items, start, end: this.index, multiline: this.source.slice(start, this.index).includes("\n") };
  }
}
