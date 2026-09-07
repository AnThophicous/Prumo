Stop. Three attempts, no convergence, so I am discarding the current hypothesis ("the table is left over from a previous run") rather than trying a fourth variation of it.

Back to evidence before any patch:

1. `SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;` on the failing database. If 0042 is already recorded, the runner is re-applying an applied migration and the bug is in the migration history, not in the SQL.
2. `pg_dump --schema-only` of the failing database, diffed against a fresh database after 0041. This shows whether the relation was created by 0042 itself (partial apply without a transaction) or by something else.
3. The CI log of the first failing run, complete, not the tail.

Falsifiable expectation: if the history table lists 0042, expectation 1 explains everything and the fix is in the runner's version check. If it does not, and the dump shows the relation with 0042's exact columns, the migration ran outside a transaction once and the fix is to make 0042 idempotent by design, documented in the specification.

No further changes to the migration until one of these comes back.
