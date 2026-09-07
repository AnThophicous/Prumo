const COMPANIONS = {
  debugging: ["coding"],
  security: ["coding"],
  subagents: ["git"],
  architecture: ["mapsource"]
};

export function routeChapters(manifest, { task = "", files = [], signals = [], suppress = [], full = false } = {}) {
  const chapters = new Map();
  const add = (id, reason) => {
    if (!manifest.chapters.some(chapter => chapter.id === id)) return;
    if (!chapters.has(id)) chapters.set(id, []);
    chapters.get(id).push(reason);
  };
  const taskText = String(task).toLowerCase();
  const fileList = files.map(file => String(file).replace(/\\/g, "/"));
  const signalSet = new Set(signals.map(signal => String(signal).toLowerCase()));

  if (full) {
    for (const chapter of manifest.chapters) add(chapter.id, "full mode requested");
  } else {
    for (const chapter of manifest.chapters) {
      for (const trigger of chapter.triggers) {
        for (const signal of trigger.signals ?? []) {
          if (signalSet.has(signal)) add(chapter.id, `signal "${signal}" (${trigger.id})`);
        }
        for (const keyword of trigger.keywords ?? []) {
          const pattern = new RegExp(keyword.includes("\\") || keyword.includes(".*") ? keyword : `\\b${escapeRegExp(keyword)}\\b`, "i");
          if (pattern.test(taskText)) add(chapter.id, `task mentions "${keyword}" (${trigger.id})`);
        }
        for (const pathPattern of trigger.paths ?? []) {
          const pattern = new RegExp(pathPattern, "i");
          const hit = fileList.find(file => pattern.test(file));
          if (hit) add(chapter.id, `${hit} matches ${trigger.id}`);
        }
      }
    }
    if (chapters.size === 0 || [...chapters.keys()].every(id => id === "protocol")) {
      for (const chapter of manifest.chapters.filter(entry => entry.defaultLoad)) add(chapter.id, "default working set");
    }
    for (const [id, companions] of Object.entries(COMPANIONS)) {
      if (!chapters.has(id)) continue;
      for (const companion of companions) add(companion, `companion of ${id}`);
    }
  }

  const refused = [];
  for (const id of suppress) {
    const chapter = manifest.chapters.find(entry => entry.id === id);
    if (!chapter || !chapters.has(id)) continue;
    if (chapter.nonSuppressible) {
      refused.push({ chapter: id, reason: "non-suppressible once triggered (PRU-253)" });
      continue;
    }
    chapters.delete(id);
  }

  const ordered = manifest.chapters.filter(chapter => chapters.has(chapter.id)).map(chapter => ({ id: chapter.id, title: chapter.title, reasons: dedupe(chapters.get(chapter.id)), rules: chapter.rules }));
  const ruleIds = new Set(manifest.kernel.rules);
  for (const chapter of ordered) for (const id of chapter.rules) ruleIds.add(id);
  return { chapters: ordered, refused, ruleIds: [...ruleIds].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))), ruleCount: manifest.ruleCount };
}

export function workingSetTokens(route, { kernelTokens, chapterTokens = {}, stateTokens = 0 }) {
  const chapters = route.chapters.reduce((sum, chapter) => sum + (chapterTokens[chapter.id] ?? 0), 0);
  return { kernel: kernelTokens, chapters, state: stateTokens, total: kernelTokens + chapters + stateTokens };
}

function dedupe(values) {
  return [...new Set(values)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
