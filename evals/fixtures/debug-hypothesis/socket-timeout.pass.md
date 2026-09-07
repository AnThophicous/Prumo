Reproduced first. Locally the test passes 20/20; with `--cpu-prof` off and `UV_THREADPOOL_SIZE=1` (matching the CI runner's 1 vCPU) it fails 7/20 with the same stack:

```
Error: ETIMEDOUT
    at Socket._onTimeout (node:net:598)
    at UploadStream.pipe (src/upload/stream.ts:44)
```

Evidence read in full: the timeout fires from `Socket.setTimeout(5000)` in `stream.ts:31`, not from the server. The server log shows the request completing 6.2 s after start on the slow runner.

Hypothesis (falsifiable): the 5 s idle timeout is applied per socket but the upload stream pauses while the hash worker runs on the single thread, so idle time exceeds 5 s on 1-vCPU runners. If this is right, setting `UV_THREADPOOL_SIZE=4` locally will make the failure disappear without touching code, and instrumenting the pause duration will show gaps > 5 s only in failing runs.

One variable per experiment:
1. Instrumented `stream.ts` with `pause`/`resume` timestamps (no behavioural change). Failing runs show a 5.4-6.8 s pause; passing runs stay under 1 s. Hypothesis survives.
2. Only change: `UV_THREADPOOL_SIZE=4`. 20/20 pass. Confirms the contention path.

Root cause: the socket idle timeout treats a CPU-bound pause in our own pipeline as network inactivity.

Fix (cause, not symptom): the hash is now computed on the streamed chunks instead of a blocking worker call, so the socket never idles waiting for us (`src/upload/stream.ts`). No timeout value was changed.

Regression test: `test/upload/stream.test.ts` "does not idle the socket while hashing" runs with a 200 ms idle timeout and a 400 ms simulated hash and asserts completion; it fails on the previous code.

Verified by execution: `UV_THREADPOOL_SIZE=1 npm test -- upload` -> 20/20 in 3 consecutive runs.

Root cause record added to MapSource.md:

RC-0042
symptom: intermittent ETIMEDOUT in `uploads large file` on CI
cause: socket idle timeout counted a blocking hash computation as network idle time on 1-vCPU runners
fix: stream-based hashing removes the pause
regression-test: test/upload/stream.test.ts "does not idle the socket while hashing"
files: src/upload/stream.ts, test/upload/stream.test.ts
