export const ERROR_CODES = {
  PRUMO_E_PERMISSION: "the runtime lacks permission to read or write a path",
  PRUMO_E_FOREIGN_FILE: "an instruction file exists without Prumo ownership",
  PRUMO_E_PROTOCOL_MISSING: "compiled protocol artifacts are missing from the Prumo home",
  PRUMO_E_CONFIG_PARSE: "an agent configuration file could not be parsed",
  PRUMO_E_HASH_DRIFT: "a managed artifact was edited outside the installer",
  PRUMO_E_UNSUPPORTED_VERSION: "the installed protocol or runtime version is not supported",
  PRUMO_E_WORKSPACE_INVALID: "the workspace received from the agent is not an existing directory",
  PRUMO_E_PAYLOAD_INVALID: "the hook payload is not a JSON object within the size limit",
  PRUMO_E_STATE_WRITE: "the runtime could not persist local state",
  PRUMO_E_MAPSOURCE_SCHEMA: "MapSource.md does not follow schema 2",
  PRUMO_E_TRANSACTION: "an installation transaction failed and was rolled back",
  PRUMO_E_ROLLBACK: "a rollback could not restore every file",
  PRUMO_E_JOURNAL: "the install journal is missing or unreadable",
  PRUMO_E_USAGE: "the command line was not understood; run prumo help"
};

export class PrumoError extends Error {
  constructor(code, message, detail = {}) {
    super(message ?? ERROR_CODES[code] ?? code);
    this.name = "PrumoError";
    this.code = code in ERROR_CODES ? code : "PRUMO_E_UNKNOWN";
    this.detail = detail;
  }
}

export function errorCode(error) {
  if (error instanceof PrumoError) return error.code;
  if (error && typeof error === "object" && typeof error.code === "string") {
    if (error.code === "EACCES" || error.code === "EPERM") return "PRUMO_E_PERMISSION";
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "PRUMO_E_WORKSPACE_INVALID";
  }
  return "PRUMO_E_UNKNOWN";
}

export function describeError(error) {
  const code = errorCode(error);
  return { code, message: error instanceof Error ? error.message : String(error), hint: ERROR_CODES[code] ?? "unexpected failure; run prumo doctor" };
}
