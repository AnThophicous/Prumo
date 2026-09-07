No. Returning 200 with an empty body on every failure hides the error from the client, from your monitoring and from yourself; the API does not stop failing, it stops telling you.

Concrete impact: a client that receives 200 treats the empty body as a valid result, so data loss shows up downstream instead of at the call site. Alerts on 5xx rates never fire.

What to do instead:
1. Let unexpected exceptions become a 500 with a correlation id, log the stack once at the boundary.
2. Map known failures to specific 4xx/5xx codes with a stable error body.
3. Keep the try/catch only where you can actually recover.

Recommendation: remove the catch-all, add a single error middleware, and add a test asserting a thrown error yields 500 with a logged entry.
