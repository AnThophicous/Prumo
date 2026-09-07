const BOM = "\uFEFF";

export function detectTomlFormat(text) {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  const eol = /\r\n/.test(body) ? "\r\n" : "\n";
  return { bom, eol, body };
}

function sectionRange(lines, section) {
  const headerPattern = new RegExp(`^\\s*\\[\\s*${section.split(".").map(part => `(?:${escapeRegExp(part)}|"${escapeRegExp(part)}")`).join("\\s*\\.\\s*")}\\s*\\]\\s*(#.*)?$`);
  const start = lines.findIndex(line => headerPattern.test(line));
  if (start === -1) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function keyPattern(key) {
  return new RegExp(`^\\s*(?:${escapeRegExp(key)}|"${escapeRegExp(key)}")\\s*=`);
}

export function upsertTomlValue(text, section, key, literal) {
  const format = detectTomlFormat(text);
  const lines = format.body.length === 0 ? [] : format.body.split(/\r?\n/);
  const assignment = `${key} = ${literal}`;
  const range = sectionRange(lines, section);
  if (!range) {
    while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(`[${section}]`, assignment, "");
    return assemble(lines, format);
  }
  const pattern = keyPattern(key);
  const existing = lines.slice(range.start + 1, range.end).findIndex(line => pattern.test(line));
  if (existing !== -1) {
    lines[range.start + 1 + existing] = assignment;
    return assemble(lines, format);
  }
  let insertAt = range.end;
  while (insertAt > range.start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  lines.splice(insertAt, 0, assignment);
  return assemble(lines, format);
}

export function readTomlValue(text, section, key) {
  const { body } = detectTomlFormat(text);
  const lines = body.split(/\r?\n/);
  const range = sectionRange(lines, section);
  if (!range) return undefined;
  const pattern = keyPattern(key);
  const line = lines.slice(range.start + 1, range.end).find(candidate => pattern.test(candidate));
  if (!line) return undefined;
  return line.slice(line.indexOf("=") + 1).replace(/\s+#.*$/, "").trim();
}

export function removeTomlKey(text, section, key, { removeEmptySection = true } = {}) {
  const format = detectTomlFormat(text);
  const lines = format.body.split(/\r?\n/);
  const range = sectionRange(lines, section);
  if (!range) return { text, removed: false };
  const pattern = keyPattern(key);
  const index = lines.slice(range.start + 1, range.end).findIndex(line => pattern.test(line));
  if (index === -1) return { text, removed: false };
  lines.splice(range.start + 1 + index, 1);
  const remaining = lines.slice(range.start + 1, range.end - 1).filter(line => line.trim().length > 0 && !line.trim().startsWith("#"));
  if (removeEmptySection && remaining.length === 0) {
    lines.splice(range.start, range.end - 1 - range.start);
  }
  return { text: assemble(collapseBlankRuns(lines), format), removed: true };
}

function collapseBlankRuns(lines) {
  const output = [];
  for (const line of lines) {
    if (line.trim() === "" && output.at(-1)?.trim() === "") continue;
    output.push(line);
  }
  return output;
}

function assemble(lines, format) {
  let output = lines.join(format.eol);
  if (!output.endsWith(format.eol)) output += format.eol;
  return (format.bom ? BOM : "") + output;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
