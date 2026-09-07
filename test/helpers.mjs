import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromRepository } from "@prumocode/compiler";
import { buildContext } from "@prumocode/installer";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SOURCE_PATH = join(ROOT, "content", "PRUMO.md");
export const SOURCE = readFileSync(SOURCE_PATH, "utf8");

let cachedCompiled;
export function compiled() {
  cachedCompiled ??= compileFromRepository(ROOT);
  return cachedCompiled;
}

export function tempHome(prefix = "prumo-test-") {
  const home = mkdtempSync(join(tmpdir(), prefix));
  return {
    home,
    env: { PATH: "", PRUMO_HOME: join(home, ".prumo"), HOME: home, USERPROFILE: home },
    write(relative, content) {
      const path = join(home, ...relative.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    read(relative) {
      return readFileSync(join(home, ...relative.split("/")), "utf8");
    },
    path(relative) {
      return join(home, ...relative.split("/"));
    },
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    }
  };
}

export function contextFor(fixture, options = {}) {
  return buildContext({ env: fixture.env, home: fixture.home, root: ROOT, compiled: compiled(), options, platform: options.platform ?? process.platform });
}
