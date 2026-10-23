// Feature pack: search/filter, CSV/JSON export, deterministic AI fallback over own records.
// No provider call is made here; when no provider is configured the labelled fallback is the result.
export function filterRecords(rows,{q="",status="",risk=""}={}){
  const needle=String(q||"").trim().toLowerCase();
  return (rows||[]).filter(r=>{
    if(status && r.status!==status) return false;
    if(risk && r.risk!==risk) return false;
    if(!needle) return true;
    const hay=[r.reference,r.title,r.owner,r.status,r.risk,r.feature_id,JSON.stringify(r.payload??{})].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}
function csvCell(v){ if(v==null) return ""; const s=typeof v==="object"?JSON.stringify(v):String(v); const safe=/^[=+\-@]/.test(s)?"'"+s:s; return /[",\n]/.test(safe)?'"'+safe.replace(/"/g,'""')+'"':safe; }
export function recordsToCsv(rows){
  const cols=["id","feature_id","reference","title","status","owner","risk","due_date","amount","created_at","updated_at"];
  return [cols.join(","),...(rows||[]).map(r=>cols.map(c=>csvCell(r[c])).join(","))].join("\n")+"\n";
}
export function buildInsights(rows,kind,meta={}){
  const list=rows||[]; const total=list.length;
  const totalAmount=list.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const high=list.filter(r=>["High","Critical"].includes(r.risk)).length;
  const open=list.filter(r=>!["Approved","Closed"].includes(r.status)).length;
  const closed=list.filter(r=>r.status==="Closed").length;
  const zeroAmount=list.filter(r=>!(Number(r.amount)>0)).length;
  let sections;
  if(kind==="risk-flags"){
    sections=[
      {title:"High-risk records",detail:`${high} of ${total} records are High or Critical risk.`},
      {title:"Open exposure",detail:`${open} records are not Approved or Closed and need review.`},
      {title:"Zero-value records",detail:`${zeroAmount} records have an amount of 0 and should be confirmed, not hidden.`},
    ];
  } else if(kind==="next-actions"){
    sections=[
      {title:"Next action 1",detail: open?`Work the ${open} open records oldest-due first in ${meta.domain||"this register"}.`:"No open records; no action required."},
      {title:"Next action 2",detail: high?`Escalate the ${high} high-risk records to a reviewer.`:"No high-risk records to escalate."},
      {title:"Next action 3",detail:`Reconcile ${closed} closed records against retained evidence before archiving.`},
    ];
  } else {
    kind="portfolio-summary";
    sections=[
      {title:"Portfolio summary",detail:`${total} records totalling ${totalAmount.toFixed(2)} in ${meta.domain||"this register"}.`},
      {title:"Status mix",detail:`Open or in-progress: ${open}; Closed: ${closed}; High risk: ${high}.`},
      {title:"Empty and zero values",detail:`Zero-amount records preserved in count: ${zeroAmount}; empty result is shown as 0, not omitted.`},
    ];
  }
  return {aiGenerated:false,source:"deterministic-fallback",label:"Deterministic fallback — no AI provider called",kind,recordCount:total,totalAmount,
    metrics:[{label:"Records",value:total},{label:"Total amount",value:totalAmount},{label:"High risk",value:high},{label:"Open",value:open},{label:"Closed",value:closed},{label:"Zero amount",value:zeroAmount}],sections};
}
export function mountFeaturePack(app,{pool,auth,featureById,config}){
  app.get("/api/features/:id/records/export",auth,async(req,res,next)=>{try{
    const feature=featureById(req.params.id);
    const rows=(await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 10000",[feature.id])).rows;
    const filtered=filterRecords(rows,{q:req.query.q||"",status:req.query.status||"",risk:req.query.risk||""});
    const format=String(req.query.format||"json").toLowerCase();
    if(format==="csv"){res.setHeader("Content-Type","text/csv");res.setHeader("Content-Disposition",`attachment; filename="${feature.id}-records.csv"`);return res.send(recordsToCsv(filtered));}
    if(format!=="json") return res.status(422).json({error:"format must be csv or json"});
    res.setHeader("Content-Disposition",`attachment; filename="${feature.id}-records.json"`);return res.json({items:filtered,count:filtered.length});
  }catch(e){next(e);}});
  app.post("/api/features/:id/ai/:kind",auth,async(req,res,next)=>{try{
    const feature=featureById(req.params.id);
    const kind=String(req.params.kind||"");
    if(!["portfolio-summary","risk-flags","next-actions"].includes(kind)) return res.status(404).json({error:"Unknown insight kind"});
    const rows=(await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 10000",[feature.id])).rows;
    const filtered=filterRecords(rows,{q:req.body?.q||"",status:req.body?.status||"",risk:req.body?.risk||""});
    return res.json({result:buildInsights(filtered,kind,{domain:config?.title||feature.title})});
  }catch(e){next(e);}});
}
