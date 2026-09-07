This touches `src/auth/session.ts` and a user lookup, so the security chapter is active (PRU-210) and the PRU-219 gate applies to the diff even though the request is functional.

Change: `findUser(identifier)` now matches `username = $1 OR lower(email) = lower($1)` through the existing parameterised query helper; no string interpolation enters the SQL. E-mail comparison is case-insensitive, username stays case-sensitive as before.

Security gate (PRU-219/220):
- Input: identifier trimmed, length capped at 254, rejected if it contains control characters.
- Enumeration: the response for "unknown identifier" and "wrong password" is the same 401 body and roughly the same timing (password check still runs against a dummy hash).
- Session cookie unchanged: HttpOnly, Secure, SameSite=Lax.

Negative-path tests added in `test/auth/session.test.ts`:
- login with an e-mail that exists but a wrong password -> 401, no session cookie
- login with `' OR 1=1 --` as identifier -> 401, query executed with the literal as a bound parameter (asserted via the query spy)
- e-mail of a disabled account -> 403

Verified by execution: `npm test -- auth` -> 14 passed.
