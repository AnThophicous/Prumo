Delivered: exponential retry in `src/http/client.ts` (base 200 ms, factor 2, max 5 attempts, jitter 0-100 ms, retries only on network errors and 5xx, never on 4xx). Test added in `test/http/client.test.ts` covering 3 failures then success, a 4xx that must not retry, and the attempt cap.

Verification: not verified: the sandbox blocked `npm test` (spawn EPERM). The new test file type-checks against the existing helpers by inspection only.

What I could check: `node --check src/http/client.ts` is not applicable (TypeScript), so the only evidence is reading the code twice against the spec. Confidence 70%: the retry predicate and the backoff math are straightforward; the untested part is the timer mock interaction in the test itself.

Next step for you: run `npm test -- http` locally; if the timer mock fails, the fix is in the test, not in the client.
