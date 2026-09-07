import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrumoError } from "./errors.mjs";
import { appendManagedBlock, detectBridge, extractBlockFromArtifact, removeManagedBlock } from "./state.mjs";

export function seedBridge({ workspace, cli, protocol, seedingEnabled = true }) {
  const artifact = protocol.bridgeFor(cli);
  const block = extractBlockFromArtifact(artifact.text);
  const bridge = detectBridge({ workspace, cli, currentVersion: protocol.manifest.protocolVersion, currentHash: block.hash, seedingEnabled });
  if (bridge.state !== "ABSENT") return { ...bridge, action: "none" };
  if (!existsSync(workspace)) throw new PrumoError("PRUMO_E_WORKSPACE_INVALID", "workspace vanished before seeding");
  try {
    writeFileSync(bridge.path, artifact.text.replace(/\r\n?/g, "\n"), { flag: "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") return { ...detectBridge({ workspace, cli, currentVersion: protocol.manifest.protocolVersion, currentHash: block.hash, seedingEnabled }), action: "none" };
    throw new PrumoError("PRUMO_E_PERMISSION", `cannot write ${bridge.file} into the workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...bridge, state: "ACTIVE", reason: "bridge written by this hook", version: block.version, hash: block.hash, action: "seeded" };
}

export function planAttachManagedBlock({ workspace, cli, protocol }) {
  const artifact = protocol.bridgeFor(cli);
  const block = extractBlockFromArtifact(artifact.text);
  const bridge = detectBridge({ workspace, cli, currentVersion: protocol.manifest.protocolVersion, currentHash: block.hash });
  if (bridge.state === "ACTIVE" && !bridge.outdated) return { ...bridge, action: "none" };
  const before = existsSync(bridge.path) ? readFileSync(bridge.path, "utf8") : "";
  const stripped = removeManagedBlock(before).text;
  const next = bridge.state === "ABSENT" || bridge.state === "DISABLED" ? artifact.text : appendManagedBlock(stripped, block.text);
  const ownership = bridge.state === "FOREIGN" || (stripped.trim().length > 0) ? "managed-block" : "file";
  return { ...bridge, action: bridge.state === "FOREIGN" ? "block-appended" : "written", before, next, ownership, version: block.version, hash: block.hash };
}

export function planDetachManagedBlock({ workspace, cli }) {
  const bridge = detectBridge({ workspace, cli });
  if (bridge.state === "ABSENT" || bridge.state === "DISABLED" || bridge.state === "FOREIGN") return { ...bridge, action: "none" };
  const before = readFileSync(bridge.path, "utf8");
  const result = removeManagedBlock(before);
  if (!result.removed) return { ...bridge, action: "none" };
  return { ...bridge, action: result.empty ? "delete-file" : "block-removed", next: result.text, before };
}
