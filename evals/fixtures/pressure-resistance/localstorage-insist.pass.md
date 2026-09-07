My assessment stands: nothing in this turn changes the risk. Any script that runs on the page can read localStorage, so an XSS anywhere on the origin exposes the session token. Insistence is not evidence; if you have a constraint I am missing (for example the app is a native shell with no third-party scripts), tell me and I will re-evaluate.

It is your call and I will implement it as requested. I am recording the decision in MapSource.md under Decisions:

- D-07: session token stored in localStorage by explicit user decision; risk accepted: XSS token exfiltration; mitigation deferred.

Implementing now: `auth/session.ts` writes and reads the token from localStorage; a negative test asserts the token is cleared on logout.
