import { useMemo, useState, type ChangeEvent } from "react";
import { supabase } from "./lib/supabase";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i=0;i<text.length;i++) { const ch=text[i];
    if (quoted) { if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(ch==='"') quoted=false; else cell+=ch; }
    else if(ch==='"'&&cell==="") quoted=true;
    else if(ch===","){row.push(cell);cell="";}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);cell="";if(row.some(v=>v.trim()))rows.push(row);row=[];}
    else cell+=ch;
  }
  if(quoted) throw new Error("CSV has an unterminated quoted field.");
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
const phoneValue=(v:string)=>{const s=v.trim().replace(/[\s().-]/g,"");return s.startsWith("00")?"+"+s.slice(2):s;};
export default function ContactCsvImport({tenantId,onImported}:{tenantId:string;onImported:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[headers,setHeaders]=useState<string[]>([]),[data,setData]=useState<string[][]>([]);
  const [phoneCol,setPhoneCol]=useState(0),[nameCol,setNameCol]=useState(-1),[evidenceCol,setEvidenceCol]=useState(-1);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const prepared=useMemo(()=>{const seen=new Set<string>();let duplicates=0,invalid=0;const valid=data.map((cells,i)=>{const phone=phoneValue(cells[phoneCol]??"");if(!/^\+[1-9][0-9]{7,14}$/.test(phone)){invalid++;return null;}if(seen.has(phone)){duplicates++;return null;}seen.add(phone);return {phone,name:nameCol>=0?(cells[nameCol]??"").trim(): "",evidence:evidenceCol>=0?(cells[evidenceCol]??"").trim(): "",line:i+2};}).filter(Boolean) as {phone:string;name:string;evidence:string;line:number}[];return {valid,duplicates,invalid};},[data,phoneCol,nameCol,evidenceCol]);
  async function choose(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");if(f.size>5*1024*1024){setError("CSV must be 5 MB or smaller.");return;}try{const parsed=parseCsv(await f.text());if(parsed.length<2)throw new Error("CSV needs a header and at least one data row.");const h=parsed[0].map((v,i)=>v.trim()||"Column "+(i+1));const norm=h.map(v=>v.toLowerCase().replace(/[^a-z0-9]/g,""));const p=norm.findIndex(v=>["phone","phonenumber","mobile","mobilenumber","whatsapp","whatsappnumber"].includes(v));setPhoneCol(p>=0?p:0);setNameCol(norm.findIndex(v=>["name","fullname","displayname","customername"].includes(v)));setEvidenceCol(norm.findIndex(v=>["consentsource","optinsource","consentevidence"].includes(v)));setHeaders(h);setData(parsed.slice(1));setFile(f);}catch(err){setError(err instanceof Error?err.message:"Unable to parse CSV.");}}
  async function runImport(){if(!file||!tenantId||!prepared.valid.length)return;setBusy(true);setError("");setMessage("");try{const payload=prepared.valid.map(r=>({tenant_id:tenantId,phone_e164:r.phone,display_name:r.name||null,consent_status:"unknown",consent_source:null,consent_at:null,metadata:{import_file:file.name,import_row:r.line,supplied_consent_evidence:r.evidence||null}}));const {data:inserted,error:dbError}=await supabase.from("contacts").upsert(payload,{onConflict:"tenant_id,phone_e164",ignoreDuplicates:true}).select("id");if(dbError)throw dbError;setMessage(`Imported ${inserted?.length??0} new contacts. ${prepared.duplicates} duplicate rows and ${prepared.invalid} invalid rows were skipped. Existing contacts were not changed; all imported contacts remain consent-unknown.`);onImported();}catch(err){setError(err instanceof Error?err.message:"Import failed.");}finally{setBusy(false);}}
  return <section className="panel form-panel"><div className="section-header"><div><h2>Import contacts from CSV</h2><p>Map fields and review validation before importing. Import never grants marketing consent.</p></div></div>
    <div className="field"><label htmlFor="contacts-csv">CSV file · max 5 MB</label><input id="contacts-csv" type="file" accept=".csv,text/csv" onChange={choose}/></div>
    {headers.length>0&&<><p className="muted small">{file?.name} · {data.length} rows</p><div className="form-grid">
      <div className="field"><label>Phone column</label><select value={phoneCol} onChange={e=>setPhoneCol(Number(e.target.value))}>{headers.map((h,i)=><option key={i} value={i}>{h}</option>)}</select></div>
      <div className="field"><label>Name column</label><select value={nameCol} onChange={e=>setNameCol(Number(e.target.value))}><option value={-1}>Not mapped</option>{headers.map((h,i)=><option key={i} value={i}>{h}</option>)}</select></div>
      <div className="field"><label>Consent evidence column (stored for review only)</label><select value={evidenceCol} onChange={e=>setEvidenceCol(Number(e.target.value))}><option value={-1}>Not mapped</option>{headers.map((h,i)=><option key={i} value={i}>{h}</option>)}</select></div>
    </div><div className="form-actions"><span className="muted small">{prepared.valid.length} valid unique · {prepared.duplicates} duplicate · {prepared.invalid} invalid</span><button className="primary-button" disabled={busy||!prepared.valid.length} onClick={()=>void runImport()}>{busy?"Importing…":"Import valid contacts"}</button></div>
    <div className="source-list">{prepared.valid.slice(0,5).map(r=><div className="source-row" key={r.line}><span>{r.name||"Unnamed contact"}</span><span>{r.phone}</span><span className="muted small">CSV row {r.line}</span></div>)}</div></>}
    {error&&<p className="notice error" role="alert">{error}</p>}{message&&<p className="notice success" role="status">{message}</p>}
  </section>;
}
