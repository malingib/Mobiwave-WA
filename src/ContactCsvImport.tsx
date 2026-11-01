import { useMemo, useState, type ChangeEvent } from "react";
import { supabase } from "./lib/supabase";

/* Minimal RFC-4180-style CSV parser: quoted cells, escaped quotes and CRLF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const phoneValue = (value: string) => {
  const cleaned = value.trim().replace(/[\s().-]/g, "");
  return cleaned.startsWith("00") ? "+" + cleaned.slice(2) : cleaned;
};

type PreparedRow = { phone: string; name: string; evidence: string; line: number };

export default function ContactCsvImport({ tenantId, onImported }: { tenantId: string; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [phoneCol, setPhoneCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [evidenceCol, setEvidenceCol] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const prepared = useMemo(() => {
    const seen = new Set<string>();
    let duplicates = 0;
    let invalid = 0;
    const valid = data.map((cells, index) => {
      const phone = phoneValue(cells[phoneCol] ?? "");
      if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) { invalid += 1; return null; }
      if (seen.has(phone)) { duplicates += 1; return null; }
      seen.add(phone);
      return {
        phone,
        name: nameCol >= 0 ? (cells[nameCol] ?? "").trim() : "",
        evidence: evidenceCol >= 0 ? (cells[evidenceCol] ?? "").trim() : "",
        line: index + 2,
      };
    }).filter(Boolean) as PreparedRow[];
    return { valid, duplicates, invalid };
  }, [data, phoneCol, nameCol, evidenceCol]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    setError("");
    setMessage("");
    if (nextFile.size > 5 * 1024 * 1024) {
      setError("CSV must be 5 MB or smaller.");
      return;
    }
    try {
      const parsed = parseCsv(await nextFile.text());
      if (parsed.length < 2) throw new Error("CSV needs a header and at least one data row.");
      const nextHeaders = parsed[0].map((value, index) => value.trim() || "Column " + (index + 1));
      const normalised = nextHeaders.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const phoneIndex = normalised.findIndex((value) => ["phone", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber"].includes(value));
      setPhoneCol(phoneIndex >= 0 ? phoneIndex : 0);
      setNameCol(normalised.findIndex((value) => ["name", "fullname", "displayname", "customername"].includes(value)));
      setEvidenceCol(normalised.findIndex((value) => ["consentsource", "optinsource", "consentevidence"].includes(value)));
      setHeaders(nextHeaders);
      setData(parsed.slice(1));
      setFile(nextFile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to parse CSV.");
    }
  }

  async function runImport() {
    if (!file || !tenantId || !prepared.valid.length) return;
    const client = supabase;
    if (!client) { setError("Workspace is not connected."); return; }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = prepared.valid.map((row) => ({
        tenant_id: tenantId,
        phone_e164: row.phone,
        display_name: row.name || null,
        consent_status: "unknown",
        consent_source: null,
        consent_at: null,
        metadata: {
          import_file: file.name,
          import_row: row.line,
          supplied_consent_evidence: row.evidence || null,
        },
      }));
      const { data: inserted, error: dbError } = await client
        .from("contacts")
        .upsert(payload, { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true })
        .select("id");
      if (dbError) throw dbError;
      setMessage(
        `Imported ${inserted?.length ?? 0} new contacts. ${prepared.duplicates} duplicate rows and ${prepared.invalid} invalid rows were skipped. ` +
        "Existing contacts were not changed; all imported contacts remain consent-unknown.",
      );
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel form-panel">
    <div className="section-header">
      <div>
        <h2>Import contacts from CSV</h2>
        <p>Map fields and review validation before importing. Import never grants marketing consent.</p>
      </div>
    </div>
    <div className="field">
      <label htmlFor="contacts-csv">CSV file · max 5 MB</label>
      <input id="contacts-csv" type="file" accept=".csv,text/csv" onChange={choose}/>
    </div>
    {headers.length > 0 && <>
      <p className="muted small">{file?.name} · {data.length} rows</p>
      <div className="form-grid">
        <div className="field">
          <label>Phone column</label>
          <select value={phoneCol} onChange={(event) => setPhoneCol(Number(event.target.value))}>
            {headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Name column</label>
          <select value={nameCol} onChange={(event) => setNameCol(Number(event.target.value))}>
            <option value={-1}>Not mapped</option>
            {headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Consent evidence column (stored for review only)</label>
          <select value={evidenceCol} onChange={(event) => setEvidenceCol(Number(event.target.value))}>
            <option value={-1}>Not mapped</option>
            {headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <span className="muted small">{prepared.valid.length} valid unique · {prepared.duplicates} duplicate · {prepared.invalid} invalid</span>
        <button className="primary-button" disabled={busy || !prepared.valid.length} onClick={() => void runImport()}>
          {busy ? "Importing…" : "Import valid contacts"}
        </button>
      </div>
      <div className="source-list">
        {prepared.valid.slice(0, 5).map((row) => (
          <div className="source-row" key={row.line}>
            <span>{row.name || "Unnamed contact"}</span>
            <span>{row.phone}</span>
            <span className="muted small">CSV row {row.line}</span>
          </div>
        ))}
      </div>
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
  </section>;
}
