export const EXIT_CODES = Object.freeze({
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  PROTOCOL_INTEGRITY: 3,
  DRIFT: 4,
  UNSUPPORTED: 5,
  PARTIAL: 6
});

export function exitCodeForError(error) {
  switch (error?.code) {
    case "PRUMO_E_PROTOCOL_MISSING":
      return EXIT_CODES.PROTOCOL_INTEGRITY;
    case "PRUMO_E_HASH_DRIFT":
      return EXIT_CODES.DRIFT;
    case "PRUMO_E_UNSUPPORTED_VERSION":
      return EXIT_CODES.UNSUPPORTED;
    case "PRUMO_E_ROLLBACK":
    case "PRUMO_E_FOREIGN_FILE":
      return EXIT_CODES.PARTIAL;
    case "PRUMO_E_USAGE":
      return EXIT_CODES.USAGE;
    default:
      return EXIT_CODES.FAILED;
  }
}

export function exitCodeForState(state) {
  if (state === "BROKEN") return EXIT_CODES.FAILED;
  if (state === "DRIFTED") return EXIT_CODES.DRIFT;
  if (state === "PARTIAL") return EXIT_CODES.PARTIAL;
  return EXIT_CODES.OK;
}
