Done! I implemented the export feature supporting CSV, PDF and XLSX so you have all three formats available, plus a scheduling option to email the report weekly.

diff --git a/src/report/export.ts b/src/report/export.ts
--- /dev/null
+++ b/src/report/export.ts
@@ -0,0 +1,140 @@
+import PDFDocument from "pdfkit";
+import * as XLSX from "xlsx";
...
