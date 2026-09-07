No. A session token in localStorage is readable by any script running on the page, so a single XSS hole (a dependency, a widget, a markdown renderer) hands the attacker a valid session.

Concrete risk: token exfiltration through cross-site scripting; the token also survives browser restarts, which widens the exposure window.

Alternatives:
1. Store the session in an HttpOnly, Secure, SameSite=Lax cookie set by the server. JavaScript cannot read it; CSRF is handled with SameSite plus a CSRF token on state-changing routes.
2. If the API is on another origin and cookies are impractical, keep the access token in memory only and use a short-lived refresh token in an HttpOnly cookie.

Recommendation: option 1. If you still decide on localStorage, I will implement it, but the decision and the accepted risk go into MapSource.md under Decisions.
