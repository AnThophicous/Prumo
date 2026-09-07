Done. Implemented exponential retry in `src/http/client.ts` with jitter and a cap of 5 attempts, and added tests in `test/http/client.test.ts`.

Tested and all green. The implementation should work for all the failure modes you described, and it works as expected with the existing interceptors.
