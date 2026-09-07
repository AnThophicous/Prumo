export const CHAPTERS = [
  {
    id: "coding",
    title: "Coding",
    sections: [1, 2, 6, 11, 14, 16],
    defaultLoad: true,
    triggers: [
      { id: "source-edit", description: "task edits source code", signals: ["edit", "feature", "implement"], paths: ["\\.(m?[jt]sx?|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|scala|ex|exs|dart|lua|sh|ps1)$"], keywords: ["implement", "add", "create", "write", "refactor", "fix", "change", "update", "build"] }
    ]
  },
  {
    id: "specification",
    title: "Specification and questions",
    sections: [4, 5],
    defaultLoad: true,
    triggers: [
      { id: "new-work", description: "task starts new work or the request is ambiguous", signals: ["feature", "implement", "ambiguous", "question"], keywords: ["spec", "requirement", "should i", "which", "ambiguous", "clarify", "option"] }
    ]
  },
  {
    id: "communication",
    title: "Communication",
    sections: [3],
    defaultLoad: false,
    triggers: [
      { id: "long-report", description: "task ends with a report, summary or explanation", signals: ["report", "summary", "explain"], keywords: ["summarize", "report", "explain", "write up"] }
    ]
  },
  {
    id: "judgment",
    title: "Honest verdict",
    sections: [15],
    defaultLoad: false,
    triggers: [
      { id: "opinion-request", description: "the user asks for an opinion or proposes an idea, design, library or plan", signals: ["opinion-request", "proposal", "pushback"], keywords: ["what do you think", "is it a good idea", "good idea", "should we", "i want to use", "i plan to", "is this ok", "thoughts", "opinion", "review my", "proposal", "approach"] }
    ]
  },
  {
    id: "debugging",
    title: "Hypothesis-driven debugging",
    sections: [19],
    defaultLoad: false,
    triggers: [
      { id: "failing-test", description: "failing test detected", signals: ["failing-test", "test-failure"], keywords: ["failing test", "test fails", "tests fail", "assertion", "expected .* got", "red test"] },
      { id: "runtime-error", description: "runtime error, exception or stack trace present", signals: ["runtime-error", "exception", "crash"], keywords: ["error", "exception", "stack trace", "traceback", "crash", "panic", "segfault", "bug", "broken", "regression", "does not work", "doesn't work", "not working"] }
    ]
  },
  {
    id: "security",
    title: "Security and personal data",
    sections: [18],
    defaultLoad: false,
    nonSuppressible: true,
    triggers: [
      { id: "auth-surface", description: "authentication, session or authorization code touched", signals: ["auth", "security"], paths: ["auth", "session", "login", "logout", "password", "passwd", "token", "jwt", "oauth", "sso", "saml", "permission", "role", "acl", "policy", "tenant", "cookie", "csrf", "2fa", "mfa", "otp", "webauthn", "passkey"], keywords: ["auth", "login", "session", "token", "password", "permission", "role", "tenant", "cookie", "jwt", "oauth", "2fa", "mfa"] },
      { id: "external-input", description: "external input, upload, webhook or queue handled", signals: ["external-input", "upload", "webhook"], paths: ["upload", "webhook", "handler", "controller", "route", "router", "endpoint", "api/", "form", "queue", "consumer", "listener", "middleware"], keywords: ["upload", "webhook", "form", "query string", "header", "user input", "request body", "payload", "endpoint", "route"] },
      { id: "data-access", description: "database, filesystem, shell or dynamic URL access", signals: ["database", "filesystem", "shell"], paths: ["db", "database", "sql", "migration", "repository", "repositories", "model", "models", "schema", "prisma", "orm", "query", "storage", "fs", "exec", "spawn"], keywords: ["database", "sql", "query", "migration", "filesystem", "shell command", "exec", "spawn", "fetch url", "ssrf"] },
      { id: "personal-data", description: "personal, financial, health or minors' data handled", signals: ["pii", "personal-data"], paths: ["user", "users", "profile", "customer", "patient", "payment", "billing", "invoice", "card", "pii", "gdpr", "lgpd", "consent"], keywords: ["personal data", "pii", "gdpr", "lgpd", "email address", "phone number", "cpf", "ssn", "health", "payment", "credit card", "consent", "minor"] },
      { id: "crypto-secrets", description: "cryptography, hashing, randomness or secrets touched", signals: ["crypto", "secrets"], paths: ["crypto", "hash", "cipher", "encrypt", "sign", "random", "secret", "\\.env", "credential", "vault", "key"], keywords: ["encrypt", "decrypt", "hash", "hmac", "signature", "random", "secret", "api key", "credential", ".env", "vault"] },
      { id: "supply-chain", description: "dependency manifest, CI, deploy or environment variable touched", signals: ["dependency", "ci", "deploy"], paths: ["package\\.json$", "package-lock\\.json$", "requirements.*\\.txt$", "pyproject\\.toml$", "Cargo\\.toml$", "go\\.mod$", "Gemfile$", "\\.github/", "\\.gitlab-ci", "Dockerfile", "docker-compose", "\\.ya?ml$", "deploy", "terraform", "\\.tf$"], keywords: ["dependency", "npm install", "pip install", "ci pipeline", "deploy", "docker", "environment variable"] }
    ]
  },
  {
    id: "git",
    title: "Git, worktrees and commits",
    sections: [8, 9],
    defaultLoad: false,
    triggers: [
      { id: "vcs-operation", description: "commit, branch, worktree or release work", signals: ["commit", "branch", "worktree", "release"], keywords: ["commit", "branch", "worktree", "merge", "rebase", "release", "changelog", "version bump", "tag", "gitignore", "push", "pull request"] }
    ]
  },
  {
    id: "architecture",
    title: "Architecture and diagrams",
    sections: [17],
    defaultLoad: false,
    triggers: [
      { id: "structural-change", description: "structural refactor, module boundary or diagram work", signals: ["refactor", "architecture", "diagram"], keywords: ["architecture", "restructure", "\\bmodule boundar\\w*", "structural refactor\\w*", "\\brefactor\\w*\\b.*\\b(module|package|layer|boundar\\w*|service|structure)s?\\b", "diagram", "archify", "mermaid", "extract module", "split package", "monorepo"] }
    ]
  },
  {
    id: "mapsource",
    title: "Session bootstrap and MapSource.md",
    sections: [0, 10],
    defaultLoad: false,
    triggers: [
      { id: "state-work", description: "MapSource.md, project state or session bootstrap work", signals: ["mapsource", "bootstrap", "refactor", "architecture"], paths: ["MapSource\\.md$"], keywords: ["mapsource", "project state", "decision record", "suspicion zone", "root cause"] }
    ]
  },
  {
    id: "public-writing",
    title: "Public text, README and interface copy",
    sections: [12, 13],
    defaultLoad: false,
    triggers: [
      { id: "public-copy", description: "README, interface text, changelog or other public copy", signals: ["public-copy", "readme", "docs"], paths: ["README", "CHANGELOG", "docs/", "\\.mdx?$", "locales?/", "i18n", "copy", "landing"], keywords: ["readme", "changelog", "release notes", "documentation", "copy", "microcopy", "error message", "button text", "landing page", "blog"] }
    ]
  },
  {
    id: "subagents",
    title: "Subagents",
    sections: [7],
    defaultLoad: false,
    triggers: [
      { id: "delegation", description: "considering a subagent or a parallel work front", signals: ["subagent", "parallel"], keywords: ["subagent", "sub-agent", "spawn", "delegate", "parallel agents", "worker agent", "task tool"] }
    ]
  },
  {
    id: "protocol",
    title: "Protocol integrity and runtime",
    sections: [20],
    defaultLoad: false,
    triggers: [
      { id: "prumo-self", description: "working on Prumo itself, its installer or its generated artifacts", signals: ["prumo"], paths: ["PRUMO\\.md$", "prumo", "\\.prumo/"], keywords: ["prumo", "protocol compiler", "kernel", "chapter", "manifest", "installer", "adapter"] }
    ]
  }
];

export const EVAL_SUITES = [
  "sycophancy",
  "pressure-resistance",
  "gold-plating",
  "false-verification",
  "debug-hypothesis",
  "three-run-breaker",
  "security-trigger",
  "foreign-instructions",
  "scope-discipline",
  "user-correction"
];

export function chapterForSection(sectionNumber) {
  return CHAPTERS.find(chapter => chapter.sections.includes(sectionNumber));
}
