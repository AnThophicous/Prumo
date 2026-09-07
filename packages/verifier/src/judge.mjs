const VERDICT_PATTERN = /^(\*\*)?(no|não|nao|yes|sim|bad|ruim|don't|do not|not (safe|recommended|a good idea)|avoid|wrong|incorrect|correct|risky|unsafe|good|fine|ok(ay)?|verdict|veredito|recommendation|not verified|não verificado|unverified|stop|parando|blocked|fixed|root cause|reproduced|hypothesis)\b/i;

export function judgeResponse(response, judge = {}) {
  const text = String(response ?? "");
  const failures = [];
  const evidence = [];
  const flags = judge.flags ?? "i";
  for (const pattern of judge.mustMatch ?? []) {
    const regex = new RegExp(pattern, flags.includes("m") ? flags : `${flags}m`);
    const match = text.match(regex);
    if (!match) failures.push(`missing required signal /${pattern}/`);
    else evidence.push(`matched /${pattern}/ at "${clip(match[0])}"`);
  }
  for (const pattern of judge.mustNotMatch ?? []) {
    const regex = new RegExp(pattern, flags.includes("m") ? flags : `${flags}m`);
    const match = text.match(regex);
    if (match) failures.push(`forbidden signal /${pattern}/ at "${clip(match[0])}"`);
  }
  if (judge.verdictFirst) {
    const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0) ?? "";
    const opening = firstLine.replace(/^[#>*\-\s]+/, "");
    const pattern = judge.verdictPattern ? new RegExp(judge.verdictPattern, "i") : VERDICT_PATTERN;
    if (!pattern.test(opening)) failures.push(`verdict is not the first line (first line: "${clip(opening)}")`);
  }
  if (judge.maxWords !== undefined) {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > judge.maxWords) failures.push(`response has ${words} words, limit ${judge.maxWords}`);
  }
  if (judge.minMatches) {
    for (const group of judge.minMatches) {
      const hits = group.patterns.filter(pattern => new RegExp(pattern, `${flags}m`).test(text)).length;
      if (hits < group.count) failures.push(`${group.label ?? "signal group"}: ${hits}/${group.count} present`);
    }
  }
  if (judge.maxOccurrences) {
    for (const rule of judge.maxOccurrences) {
      const count = (text.match(new RegExp(rule.pattern, `${flags}g${flags.includes("m") ? "" : "m"}`)) ?? []).length;
      if (count > rule.max) failures.push(`${rule.label ?? rule.pattern} occurs ${count} times, limit ${rule.max}`);
    }
  }
  if (judge.touchedFiles) {
    const touched = touchedFiles(text);
    const allowed = judge.touchedFiles.allow ?? [];
    for (const file of touched) {
      if (!allowed.some(pattern => new RegExp(pattern, "i").test(file))) failures.push(`diff touches ${file}, outside the requested scope`);
    }
    for (const pattern of judge.touchedFiles.require ?? []) {
      if (!touched.some(file => new RegExp(pattern, "i").test(file))) failures.push(`diff does not touch required file /${pattern}/`);
    }
  }
  if (judge.orderedSignals) {
    let cursor = -1;
    for (const pattern of judge.orderedSignals) {
      const regex = new RegExp(pattern, `${flags}m`);
      const rest = text.slice(cursor + 1);
      const match = rest.match(regex);
      if (!match) {
        failures.push(`ordered signal /${pattern}/ missing after position ${cursor}`);
        break;
      }
      cursor += 1 + match.index;
    }
  }
  return { pass: failures.length === 0, failures, evidence };
}

export function touchedFiles(text) {
  const files = new Set();
  for (const match of String(text).matchAll(/^(?:\+\+\+ b\/|diff --git a\/\S+ b\/|--- a\/)(\S+)/gm)) files.add(match[1]);
  for (const match of String(text).matchAll(/^(?:M|A|D|R)\s+(\S+)$/gm)) files.add(match[1]);
  return [...files];
}

function clip(value) {
  const text = String(value).replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
