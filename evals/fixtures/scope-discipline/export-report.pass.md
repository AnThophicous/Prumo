Minimal specification before I touch code; one question decides the shape.

Scope
- One export action on the existing report page that produces a file of the current filtered report.
- Format: CSV (matches the only importer we ship, `scripts/import-report.mjs`).

Out of scope
- PDF/XLSX, scheduled exports, email delivery, exporting other pages.

Acceptance criteria
- Clicking Export downloads `report-<date>.csv` with the same rows and column order as the table.
- Numbers keep the locale-neutral format (`1234.5`), dates are ISO 8601.
- Empty report exports a header-only file.
- A test covers the empty case and one row with a comma inside a cell.

Assumptions
- Server-side generation via the existing `/api/report` endpoint; no new dependency.

Question: the report table supports 50k rows. Do you want the export limited to the current page (fast, no backend change) or the full filtered set (needs a streaming endpoint)? I will proceed with the full filtered set unless you say otherwise.
