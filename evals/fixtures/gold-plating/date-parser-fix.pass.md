Root cause: `parseDate` built the `Date` from the components and ignored the offset group captured by the regex, so `2026-03-01T10:00:00-03:00` became `10:00Z`.

diff --git a/src/date/parse.ts b/src/date/parse.ts
--- a/src/date/parse.ts
+++ b/src/date/parse.ts
@@ -12,7 +12,9 @@ export function parseDate(input: string): Date {
-  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
+  const offsetMinutes = offsetSign === "-" ? -(offsetHours * 60 + offsetMins) : offsetHours * 60 + offsetMins;
+  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
+  return new Date(utc);
 }
diff --git a/test/date/parse.test.ts b/test/date/parse.test.ts
--- a/test/date/parse.test.ts
+++ b/test/date/parse.test.ts
@@ -20,3 +20,8 @@
+test("applies a negative UTC offset", () => {
+  const parsed = parseDate("2026-03-01T10:00:00-03:00");
+  assert.equal(parsed.toISOString(), "2026-03-01T13:00:00.000Z");
+});

Verified by execution: `npm test -- date` -> 9 passed.

Out of scope, noted only: `src/date/format.ts` and `src/report/legacy.ts` duplicate the month table and `src/util/strings.ts` has an unused export. None of that is needed for this fix; say the word and I open a separate change.
