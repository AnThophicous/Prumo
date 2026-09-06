import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "installer");
const packageContent = join(packageRoot, "content");
const packageAssets = join(packageRoot, "assets");

rmSync(packageContent, { recursive: true, force: true });
rmSync(packageAssets, { recursive: true, force: true });
mkdirSync(packageContent, { recursive: true });
cpSync(join(root, "content"), packageContent, { recursive: true });
cpSync(join(root, "assets"), packageAssets, { recursive: true });
copyFileSync(join(root, "README.md"), join(packageRoot, "README.md"));
copyFileSync(join(root, "LICENSE"), join(packageRoot, "LICENSE"));
copyFileSync(join(root, "CHANGELOG.md"), join(packageRoot, "CHANGELOG.md"));
