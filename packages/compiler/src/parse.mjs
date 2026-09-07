import { normalizeNewlines } from "./hash.mjs";

const VERSION_MARKER = /<!--\s*prumo-protocol:\s*version=([0-9]+\.[0-9]+\.[0-9]+)\s*-->/;
const RULE_LINE = /^\*\*PRU-(\d+)\.(.*?)\*\*\s*(.*)$/;
const RULE_MARKER = /\s*<!--\s*prumo:\s*([^]*?)\s*-->/g;
const SECTION_HEADING = /^## (?:Section (\d+)|Appendix ([A-Z]))\s+—\s+(.+)$/;
const SUBSECTION_HEADING = /^### (\d+\.\d+)\s+(.+)$/;
const CONTENTS_ENTRY = /^- (?:Section (\d+)|Appendix ([A-Z]))\s+—\s+(.+)$/;
const RULE_REFERENCE = /PRU-(\d+)/g;

export const ENFORCEMENT = {
  enforced: "ENFORCED",
  "deterministic-test": "DETERMINISTICALLY_TESTED",
  "behavior-eval": "BEHAVIOR_EVAL",
  documentary: "DOCUMENTARY",
  manual: "MANUAL"
};

export function parseProtocol(markdown) {
  const text = normalizeNewlines(markdown);
  const lines = text.split("\n");
  const version = text.match(VERSION_MARKER)?.[1];
  const contents = [];
  const sections = [];
  const rules = [];
  const problems = [];
  let introEnd = lines.length;
  let current;
  let subsection;
  let openRule;
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (/^```/.test(line)) inCodeBlock = !inCodeBlock;
    if (inCodeBlock) {
      current?.lines.push(line);
      openRule?.bodyLines.push(line);
      continue;
    }
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      if (!current) introEnd = index;
      current = {
        number: heading[1] === undefined ? undefined : Number(heading[1]),
        appendix: heading[2],
        key: heading[1] === undefined ? `appendix-${heading[2]}` : `section-${heading[1]}`,
        title: heading[3].trim(),
        line: lineNumber,
        lines: [line],
        subsections: [],
        ruleIds: []
      };
      subsection = undefined;
      openRule = undefined;
      sections.push(current);
      continue;
    }
    if (!current) {
      const entry = line.match(CONTENTS_ENTRY);
      if (entry) contents.push({ number: entry[1] === undefined ? undefined : Number(entry[1]), appendix: entry[2], title: entry[3].trim(), line: lineNumber });
      continue;
    }
    current.lines.push(line);
    const sub = line.match(SUBSECTION_HEADING);
    if (sub) {
      subsection = { id: sub[1], title: sub[2].trim(), line: lineNumber };
      current.subsections.push(subsection);
      openRule = undefined;
      continue;
    }
    if (/^---\s*$/.test(line)) {
      openRule = undefined;
      continue;
    }
    const ruleMatch = line.match(RULE_LINE);
    if (ruleMatch) {
      const rule = buildRule(ruleMatch, line, lineNumber, current, subsection, problems);
      current.ruleIds.push(rule.id);
      rules.push(rule);
      openRule = rule;
      continue;
    }
    openRule?.bodyLines.push(line);
  }

  for (const rule of rules) {
    trimRuleBody(rule);
    rule.references = collectReferences(rule);
  }

  return {
    version,
    intro: lines.slice(0, introEnd),
    contents,
    sections,
    rules,
    problems,
    lines
  };
}

function buildRule(match, line, lineNumber, section, subsection, problems) {
  const number = Number(match[1]);
  const id = `PRU-${match[1]}`;
  const rawTitle = match[2].trim().replace(/\.$/, "");
  const { text: firstLine, markers } = extractMarkers(match[3], id, problems);
  return {
    id,
    number,
    title: rawTitle.length > 0 ? rawTitle : undefined,
    section: section.key,
    sectionNumber: section.number,
    subsection: subsection?.id,
    line: lineNumber,
    headLine: stripMarkers(line),
    firstLine,
    bodyLines: [],
    kernel: markers.flags.has("kernel"),
    reminder: markers.flags.has("reminder"),
    critical: markers.flags.has("critical"),
    summary: markers.values.summary,
    enforcementKey: markers.values.enforcement ?? "manual",
    enforcement: ENFORCEMENT[markers.values.enforcement ?? "manual"],
    evalSuite: markers.values.eval,
    references: []
  };
}

function extractMarkers(text, ruleId, problems) {
  const flags = new Set();
  const values = {};
  const stripped = text.replace(RULE_MARKER, (_whole, body) => {
    for (const token of tokenizeMarker(body)) {
      const equals = token.indexOf("=");
      if (equals === -1) {
        flags.add(token);
        continue;
      }
      const key = token.slice(0, equals);
      const value = unquote(token.slice(equals + 1));
      if (key === "enforcement" && !(value in ENFORCEMENT)) {
        problems.push({ code: "unknown-enforcement", rule: ruleId, message: `${ruleId} declares unknown enforcement "${value}"` });
      }
      values[key] = value;
    }
    return "";
  });
  return { text: stripped.trim(), markers: { flags, values } };
}

function tokenizeMarker(body) {
  const tokens = [];
  const pattern = /(\w[\w-]*=(?:"(?:[^"\\]|\\.)*"|\S+))|(\w[\w-]*)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) tokens.push(match[1] ?? match[2]);
  return tokens;
}

function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"');
  return value;
}

export function stripMarkers(text) {
  return text.replace(RULE_MARKER, "").replace(/[ \t]+$/gm, "");
}

function trimRuleBody(rule) {
  while (rule.bodyLines.length > 0 && rule.bodyLines.at(-1).trim() === "") rule.bodyLines.pop();
  while (rule.bodyLines.length > 0 && rule.bodyLines[0].trim() === "") rule.bodyLines.shift();
}

function collectReferences(rule) {
  const text = [rule.firstLine, ...rule.bodyLines].join("\n");
  const found = new Set();
  let match;
  while ((match = RULE_REFERENCE.exec(text)) !== null) {
    const id = `PRU-${match[1]}`;
    if (id !== rule.id) found.add(id);
  }
  return [...found].sort(compareRuleIds);
}

export function compareRuleIds(a, b) {
  return Number(a.slice(4)) - Number(b.slice(4));
}

export function ruleText(rule) {
  return [rule.firstLine, ...rule.bodyLines].join("\n").trim();
}

export function ruleMarkdown(rule) {
  const head = rule.title ? `**${rule.id}. ${rule.title}.** ${rule.firstLine}` : `**${rule.id}.** ${rule.firstLine}`;
  return [head, ...rule.bodyLines].join("\n").trimEnd();
}

export function sectionMarkdown(section) {
  return stripMarkers(section.lines.join("\n")).trimEnd();
}

export function kernelText(rule) {
  if (rule.summary) return rule.summary;
  const paragraph = rule.firstLine.trim();
  if (paragraph.length <= 320) return paragraph;
  const sentence = paragraph.match(/^[^.!?]*[.!?](?=\s|$)/);
  return sentence ? sentence[0].trim() : paragraph;
}
