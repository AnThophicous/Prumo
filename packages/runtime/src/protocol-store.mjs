import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrumoError } from "./errors.mjs";
import { bridgeFileFor, layout } from "./paths.mjs";

export function loadProtocol(env = process.env, home = homedir()) {
  const paths = layout(env, home);
  if (!existsSync(paths.manifestPath)) throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `no compiled protocol at ${paths.protocolDir}; run prumo install`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  } catch (error) {
    throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `protocol manifest unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    paths,
    manifest,
    reminder: readOptional(paths.reminderPath)?.trim() ?? manifest.reminder?.text,
    kernel: readOptional(paths.kernelPath),
    bridgeFor(cli) {
      const file = bridgeFileFor(cli);
      const path = join(paths.agentsDir, file);
      if (!existsSync(path)) throw new PrumoError("PRUMO_E_PROTOCOL_MISSING", `bridge artifact missing: ${path}`);
      return { file, path, text: readFileSync(path, "utf8") };
    },
    chapter(id) {
      const path = join(paths.chaptersDir, `${id}.md`);
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
    chapterIds() {
      return existsSync(paths.chaptersDir) ? readdirSync(paths.chaptersDir).filter(name => name.endsWith(".md")).map(name => name.replace(/\.md$/, "")) : [];
    }
  };
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}
