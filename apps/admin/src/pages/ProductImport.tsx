import { useRef, useState } from "react";
import { api, type ImportReport } from "../api.ts";
import { IMPORT_TEMPLATE, parseCsv, rowsToObjects } from "../csv.ts";
import { Button, Card, Link, Notice, PageHeader, useToast } from "../components/ui.tsx";

const MAX_ROWS = 300;

export function ProductImport() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "import">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function chosen() {
    const file = fileRef.current?.files?.[0];
    setReport(null);
    if (!file) return;
    const parsed = rowsToObjects(parseCsv(await file.text()));
    setFileName(file.name);
    setRows(parsed.rows);
    setUnknown(parsed.unknown);
    if (parsed.rows.length > MAX_ROWS) toast.error(new Error(`Import up to ${MAX_ROWS} rows at a time. This file has ${parsed.rows.length}.`));
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "check" : "import");
    try {
      const result = await api<ImportReport>("POST", "/products/import", { rows, dryRun });
      setReport(result);
      if (!dryRun) toast.ok(`${result.created.length} draft product${result.created.length === 1 ? "" : "s"} created.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  }

  function template() {
    const url = URL.createObjectURL(new Blob([`﻿${IMPORT_TEMPLATE}\r\n`], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "esspor-product-import-template.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const tooMany = rows.length > MAX_ROWS;
  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title="Import products"
        subtitle="Add many fragrances at once from a spreadsheet. They arrive as drafts: photos, copy review and publishing still happen one product at a time."
      />
      <div className="import-grid">
        <Notice>
          One row per size. Rows with the same house and name become one product with several sizes. Existing products are never changed. Prices are in
          GHS. Notes can be separated with semicolons.
        </Notice>
        <Card title="1. Choose a file" actions={<Button size="sm" onClick={template}>Download template</Button>}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="file" onChange={chosen} />
          {fileName ? (
            <p className="muted small">
              {fileName}: {rows.length} row{rows.length === 1 ? "" : "s"} found.
            </p>
          ) : (
            <p className="muted small">In Excel or Google Sheets, use Save as or Download as CSV.</p>
          )}
          {unknown.length ? <Notice tone="warn">These columns were not recognised and will be ignored: {unknown.join(", ")}.</Notice> : null}
        </Card>
        <Card title="2. Check, then import">
          <div className="button-row">
            <Button onClick={() => run(true)} busy={busy === "check"} disabled={!rows.length || tooMany}>
              Check the file
            </Button>
            <Button
              tone="primary"
              onClick={() => run(false)}
              busy={busy === "import"}
              disabled={!report || !report.dryRun || report.created.length === 0 || report.errors.length > 0 || tooMany}
            >
              Import {report?.created.length ?? 0} product{report?.created.length === 1 ? "" : "s"} as drafts
            </Button>
          </div>
          <p className="muted small">The import button unlocks once a check finds no errors.</p>
        </Card>
        {report ? (
          <Card title={report.dryRun ? "Check result" : "Import result"}>
            {report.errors.length ? (
              <>
                <Notice tone="error">Fix these in the spreadsheet and check again. Row numbers match your file (row 1 is the headings).</Notice>
                <ul className="import-result">
                  {report.errors.map((error, index) => (
                    <li key={index}>
                      <strong>Row {error.row}:</strong> {error.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.created.length ? (
              <>
                <h3>{report.dryRun ? "Will be created" : "Created"}</h3>
                <ul className="import-result">
                  {report.created.map((product) => (
                    <li key={product.slug}>
                      {report.dryRun ? (
                        <>
                          {product.house} {product.name}
                        </>
                      ) : (
                        <Link href="/products">
                          {product.house} {product.name}
                        </Link>
                      )}{" "}
                      · {product.sizes} size{product.sizes === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.skipped.length ? (
              <>
                <h3>Skipped</h3>
                <ul className="import-result">
                  {report.skipped.map((product, index) => (
                    <li key={index}>
                      {product.house} {product.name}: <span className="muted">{product.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
