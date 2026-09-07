import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAPSOURCE_SCHEMA = 2;
export const MAPSOURCE_HEADINGS = ["Goal", "Active specification", "Architecture map", "Decisions", "Work fronts", "Suspicion zone", "Root causes", "Project commands", "Glossary"];
export const SPECIFICATION_SUBHEADINGS = ["Scope", "Out of scope", "Acceptance criteria", "Assumptions"];
export const SEVERITIES = ["critical", "high", "medium", "low"];
export const ITEM_STATUSES = ["open", "mitigated", "resolved", "wontfix"];
export const SIZE_LIMITS = { target: 24 * 1024, warning: 32 * 1024, compaction: 48 * 1024 };
export const MAPSOURCE_LOCATIONS = ["MapSource.md", join("docs", "MapSource.md"), join("notes", "MapSource.md"), join(".obsidian", "MapSource.md")];

const SUSPICION_LINE = /^- (SZ-\d{4})\s*\|(.*)$/;
const ROOT_CAUSE_LINE = /^- (RC-\d{4})\s*\|(.*)$/;

export function findMapSource(workspace) {
  for (const candidate of MAPSOURCE_LOCATIONS) {
    const path = join(workspace, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function parseMapSource(text) {
  const source = String(text).replace(/\r\n?/g, "\n");
  const frontMatter = parseFrontMatter(source);
  const body = frontMatter.body;
  const sections = [];
  let current;
  for (const line of body.split("\n")) {
    const heading = line.match(/^# (.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  const suspicion = parseItems(sections.find(section => section.title === "Suspicion zone"), SUSPICION_LINE);
  const rootCauses = parseItems(sections.find(section => section.title === "Root causes"), ROOT_CAUSE_LINE);
  return { frontMatter: frontMatter.data, hasFrontMatter: frontMatter.present, sections, suspicion, rootCauses, bytes: Buffer.byteLength(source, "utf8"), source };
}

function parseFrontMatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { present: false, data: {}, body: source };
  const data = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (pair) data[pair[1]] = pair[2].trim();
  }
  return { present: true, data, body: source.slice(match[0].length) };
}

function parseItems(section, pattern) {
  if (!section) return [];
  const items = [];
  let current;
  for (const line of section.lines) {
    const head = line.match(pattern);
    if (head) {
      current = { id: head[1], fields: parseFields(head[2]), raw: [line] };
      items.push(current);
      continue;
    }
    if (current && /^\s+- /.test(line)) {
      const pair = line.trim().slice(2).match(/^([\w -]+):\s*(.*)$/);
      if (pair) current.fields[pair[1].trim().toLowerCase().replace(/ /g, "_")] = pair[2].trim();
      current.raw.push(line);
      continue;
    }
    if (current && line.trim().length === 0) continue;
    current = undefined;
  }
  return items;
}

function parseFields(text) {
  const fields = {};
  for (const part of text.split("|")) {
    const pair = part.trim().match(/^([\w -]+):\s*(.*)$/);
    if (pair) fields[pair[1].trim().toLowerCase().replace(/ /g, "_")] = pair[2].trim();
  }
  return fields;
}

export function lintMapSource(text) {
  const parsed = parseMapSource(text);
  const findings = [];
  const fail = (code, message) => findings.push({ severity: "error", code, message });
  const warn = (code, message) => findings.push({ severity: "warning", code, message });
  if (!parsed.hasFrontMatter) fail("front-matter-missing", "MapSource.md has no front matter");
  else {
    if (String(parsed.frontMatter.schema) !== String(MAPSOURCE_SCHEMA)) fail("schema-version", `front matter schema is "${parsed.frontMatter.schema ?? "missing"}", expected ${MAPSOURCE_SCHEMA}`);
    if (!parsed.frontMatter.prumo_protocol) fail("protocol-missing", "front matter lacks prumo_protocol");
    if (!parsed.frontMatter.updated_at) fail("updated-at-missing", "front matter lacks updated_at");
  }
  const titles = parsed.sections.map(section => section.title);
  for (const heading of MAPSOURCE_HEADINGS) {
    if (!titles.includes(heading)) fail("heading-missing", `missing level-one heading "# ${heading}"`);
  }
  const order = titles.filter(title => MAPSOURCE_HEADINGS.includes(title));
  const expected = MAPSOURCE_HEADINGS.filter(heading => order.includes(heading));
  if (order.join("|") !== expected.join("|")) fail("heading-order", `headings out of order: ${order.join(", ")}`);
  const specification = parsed.sections.find(section => section.title === "Active specification");
  if (specification) {
    for (const sub of SPECIFICATION_SUBHEADINGS) {
      if (!specification.lines.some(line => line.trim() === `## ${sub}`)) fail("specification-subheading", `Active specification lacks "## ${sub}"`);
    }
  }
  for (const item of parsed.suspicion) {
    if (!SEVERITIES.includes(item.fields.severity)) fail("severity-invalid", `${item.id} has severity "${item.fields.severity ?? "missing"}"; allowed: ${SEVERITIES.join(", ")}`);
    if (!ITEM_STATUSES.includes(item.fields.status)) fail("status-invalid", `${item.id} has status "${item.fields.status ?? "missing"}"; allowed: ${ITEM_STATUSES.join(", ")}`);
    if (!item.fields.file || !/:\d+/.test(item.fields.file)) fail("file-line-missing", `${item.id} lacks a file:line reference`);
    for (const field of ["condition", "impact", "proposed_fix"]) {
      if (!item.fields[field]) warn("field-missing", `${item.id} lacks "${field.replace("_", " ")}"`);
    }
  }
  for (const item of parsed.rootCauses) {
    for (const field of ["symptom", "cause", "fix"]) {
      if (item.fields[field] === undefined) fail("root-cause-field", `${item.id} lacks "${field}"`);
      else if (item.fields[field] === "") warn("root-cause-empty", `${item.id} has an empty "${field}"`);
    }
  }
  const ids = [...parsed.suspicion, ...parsed.rootCauses].map(item => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicates)) fail("duplicate-item", `${id} appears more than once`);
  if (parsed.bytes > SIZE_LIMITS.compaction) fail("size-compaction", `MapSource.md is ${parsed.bytes} bytes, over the ${SIZE_LIMITS.compaction} compaction trigger; run prumo state compact`);
  else if (parsed.bytes > SIZE_LIMITS.warning) warn("size-warning", `MapSource.md is ${parsed.bytes} bytes, over the ${SIZE_LIMITS.warning} warning`);
  return { findings, parsed };
}

export function compactMapSource(text, { historyDir, now = new Date(), force = false } = {}) {
  const parsed = parseMapSource(text);
  if (!force && parsed.bytes <= SIZE_LIMITS.compaction) return { compacted: false, text: parsed.source, moved: [] };
  const closed = parsed.suspicion.filter(item => item.fields.status === "resolved" || item.fields.status === "wontfix");
  if (closed.length === 0) return { compacted: false, text: parsed.source, moved: [], reason: "no closed suspicion items to archive" };
  const stamp = now.toISOString().slice(0, 10);
  const historyName = `${stamp}-mapsource-history.md`;
  const historyPath = join(historyDir, historyName);
  let output = parsed.source;
  for (const item of closed) {
    const block = item.raw.join("\n");
    output = output.replace(`${block}\n`, "").replace(block, "");
  }
  const reference = `- Archived ${closed.length} closed suspicion item(s) (${closed.map(item => item.id).join(", ")}) to .prumo/history/${historyName} on ${stamp}`;
  output = output.replace(/^# Suspicion zone\n/m, `# Suspicion zone\n\n${reference}\n`).replace(/\n{3,}/g, "\n\n");
  mkdirSync(historyDir, { recursive: true });
  const archived = `## Archived from MapSource.md on ${stamp}\n\n${closed.map(item => item.raw.join("\n")).join("\n\n")}\n\n`;
  writeFileSync(historyPath, (existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "") + archived);
  return { compacted: true, text: output, moved: closed.map(item => item.id), historyPath };
}

export function searchState(query, { mapSourceText, historyDir }) {
  const needle = String(query).toLowerCase();
  const hits = [];
  const scan = (label, text) => {
    let section = "";
    text.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
      if (/^#+ /.test(line)) section = line.replace(/^#+ /, "");
      if (line.toLowerCase().includes(needle)) hits.push({ source: label, line: index + 1, section, text: line.trim() });
    });
  };
  if (mapSourceText) scan("MapSource.md", mapSourceText);
  if (historyDir && existsSync(historyDir)) {
    for (const entry of readdirSync(historyDir).filter(name => name.endsWith(".md")).sort()) scan(join(".prumo", "history", entry), readFileSync(join(historyDir, entry), "utf8"));
  }
  return hits;
}
