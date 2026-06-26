import { useState, useEffect } from "react";

// ══════════════════════════════════════════════════════════════
//  ربط Google Sheets
// ══════════════════════════════════════════════════════════════
const GS_URL = "https://script.google.com/macros/s/AKfycbylkHKK64ITAv49uej6YiKKPDhuuuxOWxG-7zqCCfjV10p2FD1gk91H_Yh7iiU2Z4tI/exec";

async function gsSaveAttendance(emp, record) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "saveAttendance",
        record: {
          empId: emp.id,
          name: emp.name,
          dept: emp.department,
          position: emp.position,
          checkIn: record.checkIn,
          checkOut: record.checkOut || "",
          status: record.status,
          deduction: record.deduction || 0,
        },
      }),
    });
  } catch (e) { console.warn("GS save attendance failed", e); }
}

async function gsSaveExcuse(emp, excuse) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "saveExcuse",
        excuse: {
          empId: emp.id,
          name: emp.name,
          type: excuse.type,
          excuseKind: excuse.excuseKind || "",
          reason: excuse.reason,
          excuseStart: excuse.excuseStart || "",
          leaveDate: excuse.leaveDate || "",
          status: excuse.status,
          monthKey: excuse.monthKey,
          date: excuse.date,
        },
      }),
    });
  } catch (e) { console.warn("GS save excuse failed", e); }
}

async function gsUpdateExcuseStatus(empId, excuseDate, status) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateExcuseStatus", empId, excuseDate, status }),
    });
  } catch (e) { console.warn("GS update status failed", e); }
}

function gsGetEmployees() {
  return new Promise(async (resolve) => {
    try {
      const response = await fetch(`${GS_URL}?action=getEmployees`, {
        method: "GET",
      });
      const data = await response.json();
      resolve(data.employees || []);
    } catch (e) {
      console.warn("gsGetEmployees failed", e);
      resolve([]);
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  الإعدادات الرئيسية
// ══════════════════════════════════════════════════════════════
const OFFICE = { lat: 33.256019, lng: 44.389411, radius: 5000000 };

// قواعد الوقت
const RULES = {
  checkIn:    { from: { h:0,  m:0 }, to: { h:8,  m:0 } },    // 12:00 ص - 8:00 ص طبيعي
  late:       { from: { h:8,  m:1 }, to: { h:11, m:59 } },   // 8:01 ص - 11:59 ص تأخير دخول مع خصم
  earlyLeave: { from: { h:12, m:0 }, to: { h:13, m:59 } },   // 12:00 م - 1:59 م خروج مبكر مع خصم
  checkOut:   { from: { h:14, m:0 }, to: { h:23, m:59 } },   // 2:00 م - 11:59 م
  lateDeduction: 10000, // دينار
  excuseHours: 3, // مدة تغطية الزمنية بالساعات
};

// الحدود الشهرية
const MONTHLY_LIMITS = { excuses: 2, leaves: 1 };

// الموظفون يُجلبون من Google Sheets ديناميكياً عند تسجيل الدخول
const EMPLOYEES = []; // لا تعديل هنا — البيانات من Sheets
const ADMIN = { id:"ADMIN", name:"المدير العام", pin:"0000", isAdmin:true };

// ══════════════════════════════════════════════════════════════
//  أدوات مساعدة
// ══════════════════════════════════════════════════════════════
function getDistance(lat1,lng1,lat2,lng2) {
  const R=6371000, φ1=(lat1*Math.PI)/180, φ2=(lat2*Math.PI)/180;
  const Δφ=((lat2-lat1)*Math.PI)/180, Δλ=((lng2-lng1)*Math.PI)/180;
  const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function toMin(h,m){ return h*60+m; }
function nowMin(){ const n=new Date(); return n.getHours()*60+n.getMinutes(); }

function checkInStatus(isoTime) {
  const d = new Date(isoTime);
  const m = d.getHours()*60 + d.getMinutes();
  const from = toMin(RULES.checkIn.from.h, RULES.checkIn.from.m);
  const to   = toMin(RULES.checkIn.to.h,   RULES.checkIn.to.m);
  const lTo  = toMin(RULES.late.to.h,      RULES.late.to.m);
  if (m >= from && m <= to)  return "onTime";
  if (m > to    && m <= lTo) return "late";
  return "invalid";
}

function canCheckIn()  {
  const m = nowMin();
  return m >= toMin(RULES.checkIn.from.h,RULES.checkIn.from.m) && m <= toMin(RULES.late.to.h,RULES.late.to.m);
}
function canCheckOut() {
  const m = nowMin();
  return m >= toMin(RULES.earlyLeave.from.h,RULES.earlyLeave.from.m) && m <= toMin(RULES.checkOut.to.h,RULES.checkOut.to.m);
}

// هل وقت معيّن (بالدقائق من منتصف الليل) يقع ضمن فترة الخروج المبكر؟
function isEarlyLeaveTime(m){
  return m >= toMin(RULES.earlyLeave.from.h,RULES.earlyLeave.from.m) && m <= toMin(RULES.earlyLeave.to.h,RULES.earlyLeave.to.m);
}

function fmtTime(iso){ if(!iso) return "—"; return new Date(iso).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(iso){ return new Date(iso).toLocaleDateString("ar-SA",{weekday:"long",year:"numeric",month:"long",day:"numeric"}); }
function fmtDateShort(iso){ return new Date(iso).toLocaleDateString("ar-SA",{year:"numeric",month:"2-digit",day:"2-digit"}); }
function dayName(iso){ return new Date(iso).toLocaleDateString("ar-SA",{weekday:"long"}); }
function duration(inIso,outIso){ if(!outIso) return null; return ((new Date(outIso)-new Date(inIso))/3600000).toFixed(1); }
function monthKey(){ const n=new Date(); return `${n.getFullYear()}-${n.getMonth()}`; }

function getEmpData(empId){ try{ return JSON.parse(localStorage.getItem(`att_${empId}`)||"[]"); }catch{ return []; } }
function saveEmpData(empId,data){ localStorage.setItem(`att_${empId}`,JSON.stringify(data)); }

function getExcuses(empId){ try{ return JSON.parse(localStorage.getItem(`exc_${empId}`)||"[]"); }catch{ return []; } }
function saveExcuses(empId,data){ localStorage.setItem(`exc_${empId}`,JSON.stringify(data)); }

// مفتاح اليوم بصيغة YYYY-MM-DD لمقارنة الزمنيات بنفس اليوم
function dateKey(iso){ const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

// هل يوجد طلب زمنية (من أي نوع) بنفس اليوم لهذا الموظف؟ (لمنع زمنيتين بنفس اليوم)
function hasExcuseOnDate(empId, dateIso, excludeId){
  const dk = dateKey(dateIso);
  return getExcuses(empId).some(e => e.type==="excuse" && e.id!==excludeId && dateKey(e.excuseStart||e.date)===dk);
}

// إيجاد الزمنية المعتمدة التي تغطي لحظة زمنية معيّنة (إن وجدت) لهذا الموظف
function findCoveringExcuse(empId, isoTime){
  const t = new Date(isoTime).getTime();
  return getExcuses(empId).find(e=>{
    if(e.type!=="excuse" || e.status!=="approved") return false;
    const start = new Date(e.excuseStart).getTime();
    const end   = start + RULES.excuseHours*3600000;
    return t>=start && t<=end;
  });
}

function monthExcuses(empId){
  const mk = monthKey();
  return getExcuses(empId).filter(e => e.monthKey === mk && e.type === "excuse" && e.status !== "rejected").length;
}
function monthLeaves(empId){
  const mk = monthKey();
  return getExcuses(empId).filter(e => e.monthKey === mk && e.type === "leave" && e.status !== "rejected").length;
}

function getAllRecords(){
  const all=[];
  EMPLOYEES.forEach(emp=>{
    getEmpData(emp.id).forEach(r=>all.push({...r,emp}));
  });
  return all.sort((a,b)=>new Date(b.checkIn)-new Date(a.checkIn));
}

function exportCSV(records){
  const header="الرقم الوظيفي,الاسم,القسم,المنصب,اليوم,التاريخ,وقت الحضور,حالة الحضور,وقت الانصراف,مدة الدوام,خصم التأخير\n";
  const rows=records.map(r=>{
    const dur=duration(r.checkIn,r.checkOut);
    const status=r.status==="late"?"متأخر":"في الوقت";
    const ded=r.deduction?`${r.deduction.toLocaleString()} دينار`:"—";
    return [r.emp.id,r.emp.name,r.emp.department,r.emp.position,
      dayName(r.checkIn),fmtDateShort(r.checkIn),fmtTime(r.checkIn),status,fmtTime(r.checkOut),dur||"—",ded].join(",");
  });
  const csv="\uFEFF"+header+rows.join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="تقرير_الحضور.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════
//  ساعة حية
// ══════════════════════════════════════════════════════════════
function LiveClock(){
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); },[]);
  const day = now.toLocaleDateString("ar-SA",{weekday:"long"});
  const date = now.toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"});
  return(
    <div style={S.clockBox}>
      <p style={S.clockDay}>{day}</p>
      <p style={S.clockTime}>{now.toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</p>
      <p style={S.clockDate}>{date}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  نافذة تأكيد الانصراف
// ══════════════════════════════════════════════════════════════
function CheckoutModal({employee,checkInTime,onConfirm,onCancel}){
  const dur=((new Date()-new Date(checkInTime))/3600000).toFixed(1);
  const nowT=new Date().toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"});
  return(
    <div style={M.overlay}>
      <div style={M.sheet}>
        <div style={M.handle}/>
        <div style={{textAlign:"center",marginBottom:8}}><span style={{fontSize:48}}>🚪</span></div>
        <h2 style={M.title}>تأكيد الانصراف</h2>
        <p style={M.sub}>هل أنت متأكد من تسجيل انصرافك؟</p>
        <div style={M.infoBox}>
          {[
            {icon:"👤",label:"الموظف",val:employee.name,color:null},
            {icon:"🕐",label:"وقت الحضور",val:fmtTime(checkInTime),color:null},
            {icon:"⏱",label:"مدة الدوام",val:`${dur} ساعة`,color:"#6366f1"},
            {icon:"🕓",label:"وقت الانصراف",val:nowT,color:"#ef4444"},
          ].map((item,i,arr)=>(
            <div key={item.label}>
              <div style={M.infoRow}>
                <span style={{fontSize:22}}>{item.icon}</span>
                <div>
                  <p style={M.infoLabel}>{item.label}</p>
                  <p style={{...M.infoVal,...(item.color?{color:item.color}:{})}}>{item.val}</p>
                </div>
              </div>
              {i<arr.length-1&&<div style={M.divider}/>}
            </div>
          ))}
        </div>
        <div style={M.btnRow}>
          <button style={M.cancelBtn} onClick={onCancel}>إلغاء</button>
          <button style={M.confirmBtn} onClick={onConfirm}>تأكيد الانصراف</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  نافذة طلب زمنية / إجازة
// ══════════════════════════════════════════════════════════════
function ExcuseModal({employee,onClose}){
  const [type,setType]=useState("excuse"); // excuse | leave
  const [excuseKind,setExcuseKind]=useState("late"); // late (تأخير دخول) | early (خروج مبكر)
  const [excuseDate,setExcuseDate]=useState(()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; });
  const [excuseHour,setExcuseHour]=useState(excuseKind==="late"?8:12);
  const [leaveDate,setLeaveDate]=useState(()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; });
  const [reason,setReason]=useState("");
  const [submitted,setSubmitted]=useState(false);
  const [dupError,setDupError]=useState("");

  const excLeft  = MONTHLY_LIMITS.excuses - monthExcuses(employee.id);
  const leaveLeft= MONTHLY_LIMITS.leaves  - monthLeaves(employee.id);

  // وقت بداية الزمنية الكامل (ISO) بناءً على التاريخ المختار + الساعة المختارة
  function buildExcuseStartIso(){
    const [y,mo,da] = excuseDate.split("-").map(Number);
    const d = new Date(y, mo-1, da, excuseHour, 0, 0, 0);
    return d.toISOString();
  }

  // تاريخ الإجازة الكامل (ISO) — يُستخدم منتصف اليوم كقيمة مرجعية
  function buildLeaveDateIso(){
    const [y,mo,da] = leaveDate.split("-").map(Number);
    const d = new Date(y, mo-1, da, 12, 0, 0, 0);
    return d.toISOString();
  }

  function submit(){
    if(!reason.trim()) return;
    const canAdd = type==="excuse" ? excLeft>0 : leaveLeft>0;
    if(!canAdd) return;

    if(type==="excuse"){
      const startIso = buildExcuseStartIso();
      if(hasExcuseOnDate(employee.id, startIso)){
        setDupError("⚠️ لديك زمنية مسجّلة مسبقاً بنفس هذا اليوم — لا يمكن طلب أكثر من زمنية واحدة في اليوم.");
        return;
      }
      setDupError("");
      const excuses = getExcuses(employee.id);
      const newExcuse = {
        id:Date.now(), type, excuseKind, reason,
        excuseStart:startIso,
        date:new Date().toISOString(), monthKey:monthKey(), status:"pending"
      };
      excuses.push(newExcuse);
      saveExcuses(employee.id, excuses);
      gsSaveExcuse(employee, newExcuse); // حفظ في Google Sheets
    } else {
      const leaveDateIso = buildLeaveDateIso();
      const excuses = getExcuses(employee.id);
      const newExcuse = {
        id:Date.now(), type, reason,
        leaveDate:leaveDateIso,
        date:new Date().toISOString(), monthKey:monthKey(), status:"pending"
      };
      excuses.push(newExcuse);
      saveExcuses(employee.id, excuses);
      gsSaveExcuse(employee, newExcuse); // حفظ في Google Sheets
    }
    setSubmitted(true);
  }

  const hourOptions = Array.from({length:24},(_,h)=>h);

  return(
    <div style={M.overlay}>
      <div style={M.sheet}>
        <div style={M.handle}/>
        {submitted ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <span style={{fontSize:56}}>✅</span>
            <h2 style={{...M.title,marginTop:12}}>تم إرسال الطلب</h2>
            <p style={{color:"#64748b",fontSize:14}}>سيتم مراجعته من قِبل المدير</p>
            <button style={{...M.confirmBtn,marginTop:20,flex:"none",width:"100%"}} onClick={onClose}>حسناً</button>
          </div>
        ):(
          <>
            <h2 style={M.title}>طلب زمنية / إجازة</h2>
            {/* نوع الطلب */}
            <div style={{display:"flex",gap:10,marginBottom:16}}>
              {[
                {k:"excuse",label:`زمنية (متبقي: ${excLeft}/2)`},
                {k:"leave", label:`إجازة (متبقي: ${leaveLeft}/1)`},
              ].map(({k,label})=>(
                <button key={k} onClick={()=>{setType(k);setDupError("");}}
                  style={{flex:1,padding:"10px 6px",borderRadius:12,border:"2px solid",cursor:"pointer",fontSize:13,fontWeight:700,
                    borderColor:type===k?"#6366f1":"#e2e8f0",
                    background:type===k?"#ede9fe":"#f8fafc",
                    color:type===k?"#4f46e5":"#64748b"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* تحذير النفاذ */}
            {((type==="excuse"&&excLeft<=0)||(type==="leave"&&leaveLeft<=0))&&(
              <div style={{background:"#fee2e2",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,color:"#991b1b",fontWeight:600}}>
                ⚠️ استنفدت حد {type==="excuse"?"الزمنيات":"الإجازات"} هذا الشهر ({type==="excuse"?2:1} كحد أقصى)
              </div>
            )}

            {/* تفاصيل الزمنية: النوع (تأخير/خروج) + التاريخ + ساعة البداية */}
            {type==="excuse" && (
              <>
                <label style={{color:"#475569",fontSize:13,fontWeight:600}}>نوع الزمنية</label>
                <div style={{display:"flex",gap:10,margin:"6px 0 14px"}}>
                  {[
                    {k:"late", label:"تأخير دخول"},
                    {k:"early",label:"خروج مبكر"},
                  ].map(({k,label})=>(
                    <button key={k} onClick={()=>{setExcuseKind(k);setExcuseHour(k==="late"?8:12);setDupError("");}}
                      style={{flex:1,padding:"9px 6px",borderRadius:10,border:"2px solid",cursor:"pointer",fontSize:13,fontWeight:700,
                        borderColor:excuseKind===k?"#6366f1":"#e2e8f0",
                        background:excuseKind===k?"#ede9fe":"#f8fafc",
                        color:excuseKind===k?"#4f46e5":"#64748b"}}>
                      {label}
                    </button>
                  ))}
                </div>

                <div style={{display:"flex",gap:10,marginBottom:14}}>
                  <div style={{flex:1.4}}>
                    <label style={{color:"#475569",fontSize:13,fontWeight:600}}>تاريخ الزمنية</label>
                    <input type="date" value={excuseDate}
                      onChange={e=>{setExcuseDate(e.target.value);setDupError("");}}
                      style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:"10px 14px",fontSize:14,outline:"none",textAlign:"right",direction:"rtl",marginTop:6,width:"100%",color:"#0f172a",boxSizing:"border-box"}}/>
                  </div>
                  <div style={{flex:1}}>
                    <label style={{color:"#475569",fontSize:13,fontWeight:600}}>ساعة البداية</label>
                    <select value={excuseHour} onChange={e=>{setExcuseHour(Number(e.target.value));setDupError("");}}
                      style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:"10px 14px",fontSize:14,outline:"none",textAlign:"right",direction:"rtl",marginTop:6,width:"100%",color:"#0f172a",boxSizing:"border-box"}}>
                      {hourOptions.map(h=>(
                        <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"8px 14px",marginBottom:14,fontSize:12,color:"#075985"}}>
                  ℹ️ الزمنية تغطي {RULES.excuseHours} ساعات تلقائياً من {String(excuseHour).padStart(2,"0")}:00 حتى {String((excuseHour+RULES.excuseHours)%24).padStart(2,"0")}:00
                </div>

                {dupError && (
                  <div style={{background:"#fee2e2",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#991b1b",fontWeight:600}}>
                    {dupError}
                  </div>
                )}
              </>
            )}

            {/* تاريخ الإجازة */}
            {type==="leave" && (
              <>
                <label style={{color:"#475569",fontSize:13,fontWeight:600}}>تاريخ الإجازة</label>
                <input type="date" value={leaveDate}
                  onChange={e=>setLeaveDate(e.target.value)}
                  style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:"10px 14px",fontSize:14,outline:"none",textAlign:"right",direction:"rtl",marginTop:6,marginBottom:14,width:"100%",color:"#0f172a",boxSizing:"border-box"}}/>
              </>
            )}

            <label style={{color:"#475569",fontSize:13,fontWeight:600}}>سبب الطلب</label>
            <textarea
              style={{...S.textarea,marginTop:6}}
              placeholder={type==="excuse"?"مثال: ظرف طارئ يستدعي تأخير أو خروج مبكر...":"مثال: إجازة يوم الأحد بسبب..."}
              value={reason} onChange={e=>setReason(e.target.value)} rows={3}
            />

            <div style={M.btnRow}>
              <button style={M.cancelBtn} onClick={onClose}>إلغاء</button>
              <button style={{...M.confirmBtn,opacity:(reason.trim()&&((type==="excuse"&&excLeft>0)||(type==="leave"&&leaveLeft>0)))?1:0.4}}
                onClick={submit} disabled={!reason.trim()||((type==="excuse"&&excLeft<=0)||(type==="leave"&&leaveLeft<=0))}>
                إرسال الطلب
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  شاشة تسجيل الدخول
// ══════════════════════════════════════════════════════════════
function LoginScreen({onLogin}){
  const [empId,setEmpId]=useState("");
  const [pin,setPin]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [gsStatus,setGsStatus]=useState("idle"); // idle | loading | ok | fail
  const [employees,setEmployees]=useState([]);

  // جلب الموظفين من Google Sheets عند فتح الشاشة
  useEffect(()=>{
    setGsStatus("loading");
    gsGetEmployees().then(list=>{
      if(list.length>0){ setEmployees(list); setGsStatus("ok"); }
      else { setGsStatus("fail"); }
    });
  },[]);

  function handleLogin(){
    if(gsStatus==="loading"){ setError("جارٍ تحميل بيانات الموظفين..."); return; }
    setError(""); setLoading(true);
    setTimeout(()=>{
      const id = empId.trim();
      // تحقق من المدير الثابت
      if(id===ADMIN.id && pin===ADMIN.pin){ onLogin(ADMIN); setLoading(false); return; }
      // تحقق من الموظفين من Sheets
      const emp = employees.find(e =>
        String(e.id).trim().toLowerCase() === id.toLowerCase() &&
        String(e.pin).trim() === pin.trim()
      );
      if(emp){
        // إذا كان عمود الصلاحية = "مدير" يدخل كمدير
        if(emp.isAdmin) onLogin({...emp, isAdmin:true});
        else onLogin({...emp, isAdmin:false});
      } else {
        setError("رقم المستخدم أو كلمة المرور غير صحيحة");
      }
      setLoading(false);
    },400);
  }

  return(
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.logoCircle}><span style={{fontSize:36}}>👆</span></div>
        <h1 style={S.loginTitle}>نظام الحضور والانصراف</h1>
        <p style={S.loginSub}>سجّل دخولك برقم المستخدم وكلمة المرور</p>

        {/* حالة الاتصال بـ Google Sheets */}
        <div style={{
          borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:600, textAlign:"center",
          background: gsStatus==="ok"?"rgba(34,197,94,0.15)": gsStatus==="fail"?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.08)",
          color: gsStatus==="ok"?"#4ade80": gsStatus==="fail"?"#f87171":"#94a3b8",
          border: `1px solid ${gsStatus==="ok"?"rgba(34,197,94,0.3)": gsStatus==="fail"?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.1)"}`,
        }}>
          {gsStatus==="loading" && "⏳ جارٍ تحميل بيانات الموظفين..."}
          {gsStatus==="ok"     && `✅ تم التحميل — ${employees.length} موظف`}
          {gsStatus==="fail"   && "⚠️ تعذّر الاتصال بـ Google Sheets"}
          {gsStatus==="idle"   && "جارٍ الاتصال..."}
        </div>

        <label style={S.label}>رقم المستخدم</label>
        <input style={S.input} placeholder="مثال: A1025" value={empId}
          onChange={e=>setEmpId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
        <label style={S.label}>كلمة المرور (PIN)</label>
        <input style={S.input} type="password" placeholder="••••" maxLength={6} value={pin}
          onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
        {error&&<p style={S.errorMsg}>{error}</p>}
        <button style={{...S.btn,opacity:(loading||gsStatus==="loading")?0.7:1}}
          onClick={handleLogin} disabled={loading||gsStatus==="loading"}>
          {loading?"جارٍ التحقق...":"دخول"}
        </button>
        <div style={S.demoHint}>
          <p style={{margin:0,fontSize:11,color:"#94a3b8",fontWeight:600,marginBottom:4}}>المدير:</p>
          <p style={{margin:0,fontSize:11,color:"#a78bfa"}}>ADMIN / 0000</p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  لوحة المدير
// ══════════════════════════════════════════════════════════════
function AdminPanel({onLogout}){
  const [filter,setFilter]=useState("today");
  const [search,setSearch]=useState("");
  const [tab,setTab]=useState("records"); // records | requests | deductions | employees
  const [deduction,setDeduction]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("lateDeduction")||JSON.stringify(RULES.lateDeduction));}catch{return RULES.lateDeduction;}
  });
  const [deductionInput,setDeductionInput]=useState(String(deduction));
  // فلتر التاريخ المخصص
  const today=new Date(); 
  const todayISO=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [dateFrom,setDateFrom]=useState(todayISO);
  const [dateTo,setDateTo]=useState(todayISO);
  const [selectedEmp,setSelectedEmp]=useState(null);

  function saveDeduction(val){
    const n=Number(val);
    if(!isNaN(n)&&n>=0){ setDeduction(n); localStorage.setItem("lateDeduction",JSON.stringify(n)); }
  }

  const allRecords=getAllRecords();
  const todayStr=new Date().toDateString();
  const filtered=allRecords.filter(r=>{
    if(filter==="today") return new Date(r.checkIn).toDateString()===todayStr;
    if(filter==="week"){ const d=new Date(); d.setDate(d.getDate()-7); return new Date(r.checkIn)>=d; }
    if(filter==="range"){
      const from=new Date(dateFrom+"T00:00:00");
      const to=new Date(dateTo+"T23:59:59");
      const d=new Date(r.checkIn);
      return d>=from && d<=to;
    }
    return true;
  }).filter(r=>r.emp.name.includes(search)||r.emp.id.includes(search)||r.emp.department.includes(search));

  const todayPresent=new Set(allRecords.filter(r=>new Date(r.checkIn).toDateString()===todayStr).map(r=>r.emp.id)).size;
  const checkedInNow=allRecords.filter(r=>new Date(r.checkIn).toDateString()===todayStr&&!r.checkOut).length;
  const lateToday=allRecords.filter(r=>new Date(r.checkIn).toDateString()===todayStr&&r.status==="late").length;
  const totalDeductions=allRecords.filter(r=>r.deduction).reduce((a,r)=>a+(r.deduction||0),0);

  // كل الطلبات
  const allRequests=[];
  EMPLOYEES.forEach(emp=>{
    getExcuses(emp.id).forEach(ex=>allRequests.push({...ex,emp}));
  });
  const pendingReqs=allRequests.filter(r=>r.status==="pending");

  function approveRequest(empId,id,approve){
    const excuses=getExcuses(empId);
    const req = excuses.find(e=>e.id===id);
    const updated=excuses.map(e=>e.id===id?{...e,status:approve?"approved":"rejected",decisionDate:new Date().toISOString()}:e);
    saveExcuses(empId,updated);
    // تحديث الحالة في Google Sheets
    if(req) gsUpdateExcuseStatus(empId, req.date, approve?"approved":"rejected");
    // force re-render
    setFilter(f=>f);
  }

  return(
    <div style={S.appWrap}>
      <div style={{...S.header,background:"linear-gradient(135deg,#1e1b4b,#4c1d95)"}}>
        <button style={S.logoutBtn} onClick={onLogout}>خروج</button>
        <span style={S.headerTitle}>🛡️ لوحة المدير</span>
        <div style={{width:60}}/>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #e2e8f0",background:"#fff",flexShrink:0,overflowX:"auto"}}>
        {[["records","السجلات"],["requests","الطلبات"+(pendingReqs.length?` (${pendingReqs.length})`:"")],["deductions","الخصومات"],["employees","الموظفون"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{flex:1,padding:"11px 4px",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,
              background:"none",color:tab===k?"#6366f1":"#94a3b8",
              borderBottom:tab===k?"2px solid #6366f1":"2px solid transparent"}}>
            {l}
          </button>
        ))}
      </div>

      <div style={S.scrollArea}>

        {/* ── السجلات ── */}
        {tab==="records"&&<>
          <div style={{...S.statsRow,margin:"16px 16px 0"}}>
            <div style={{...S.statBox,borderTop:"3px solid #6366f1"}}>
              <p style={S.statNum}>{EMPLOYEES.length}</p><p style={S.statLabel}>إجمالي</p>
            </div>
            <div style={{...S.statBox,borderTop:"3px solid #22c55e"}}>
              <p style={{...S.statNum,color:"#22c55e"}}>{todayPresent}</p><p style={S.statLabel}>حضروا</p>
            </div>
            <div style={{...S.statBox,borderTop:"3px solid #f59e0b"}}>
              <p style={{...S.statNum,color:"#f59e0b"}}>{checkedInNow}</p><p style={S.statLabel}>في الدوام</p>
            </div>
            <div style={{...S.statBox,borderTop:"3px solid #ef4444"}}>
              <p style={{...S.statNum,color:"#ef4444"}}>{lateToday}</p><p style={S.statLabel}>متأخر</p>
            </div>
          </div>

          <div style={{padding:"12px 16px 0",display:"flex",gap:8,flexWrap:"wrap"}}>
            {[["today","اليوم"],["week","الأسبوع"],["all","الكل"],["range","من/إلى"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFilter(k)}
                style={{flex:1,padding:"8px 4px",borderRadius:10,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:50,
                  background:filter===k?"#6366f1":"#f1f5f9",color:filter===k?"#fff":"#64748b"}}>
                {l}
              </button>
            ))}
            <button onClick={()=>exportCSV(filtered)}
              style={{padding:"8px 14px",borderRadius:10,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:"#0f172a",color:"#fff",whiteSpace:"nowrap"}}>
              ⬇ CSV
            </button>
          </div>

          {filter==="range"&&(
            <div style={{padding:"10px 16px 0",display:"flex",gap:8,alignItems:"center"}}>
              <div style={{flex:1}}>
                <p style={{margin:"0 0 4px",fontSize:11,color:"#64748b",fontWeight:600}}>من</p>
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                  style={{width:"100%",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",color:"#0f172a",boxSizing:"border-box"}}/>
              </div>
              <div style={{flex:1}}>
                <p style={{margin:"0 0 4px",fontSize:11,color:"#64748b",fontWeight:600}}>إلى</p>
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                  style={{width:"100%",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",color:"#0f172a",boxSizing:"border-box"}}/>
              </div>
            </div>
          )}

          <div style={{padding:"10px 16px 0"}}>
            <input style={S.searchInput} placeholder="🔍  ابحث باسم أو رقم أو قسم..."
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>

          <div style={{padding:"12px 16px 90px"}}>
            {filtered.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📋</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد سجلات</p></div>
              :filtered.map((r,i)=>{
                const dur=duration(r.checkIn,r.checkOut);
                const isLate=r.status==="late";
                return(
                  <div key={i} style={S.recordCard}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{...S.avatar,width:38,height:38,fontSize:14}}>
                          {r.emp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                        </div>
                        <div>
                          <p style={{margin:0,fontWeight:700,color:"#0f172a",fontSize:14}}>{r.emp.name}</p>
                          <p style={{margin:0,fontSize:11,color:"#64748b"}}>{r.emp.position} · {r.emp.department}</p>
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                        <span style={{...S.badge,background:r.checkOut?"#dcfce7":"#fef9c3",color:r.checkOut?"#166534":"#854d0e"}}>
                          {r.checkOut?"مكتمل":"في الدوام"}
                        </span>
                        {isLate&&<span style={{...S.badge,background:"#fee2e2",color:"#991b1b"}}>⚠️ متأخر</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{fontSize:12,color:"#475569"}}>📅 {dayName(r.checkIn)} {fmtDateShort(r.checkIn)}</span>
                      <span style={{fontSize:12,color:"#22c55e",fontWeight:600}}>↓ {fmtTime(r.checkIn)}</span>
                      <span style={{fontSize:12,color:"#ef4444",fontWeight:600}}>↑ {fmtTime(r.checkOut)}</span>
                      {dur&&<span style={{fontSize:12,color:"#6366f1",fontWeight:600}}>⏱ {dur}h</span>}
                      {r.deduction&&<span style={{fontSize:12,color:"#dc2626",fontWeight:700}}>💸 {r.deduction.toLocaleString()} دينار</span>}
                    </div>
                  </div>
                );
              })
            }
          </div>
        </>}

        {/* ── الطلبات ── */}
        {tab==="requests"&&(
          <div style={{padding:"16px 16px 90px"}}>
            <h2 style={{...S.sectionTitle,paddingTop:0}}>طلبات الزمنيات والإجازات</h2>
            {allRequests.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📭</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد طلبات</p></div>
              :allRequests.sort((a,b)=>b.id-a.id).map(req=>{
                const excuseEndIso = req.type==="excuse" && req.excuseStart
                  ? new Date(new Date(req.excuseStart).getTime()+RULES.excuseHours*3600000).toISOString()
                  : null;
                return(
                <div key={req.id} style={{...S.recordCard,borderRight:`4px solid ${req.status==="pending"?"#f59e0b":req.status==="approved"?"#22c55e":"#ef4444"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <p style={{margin:0,fontWeight:700,fontSize:14,color:"#0f172a"}}>{req.emp.name}</p>
                      <p style={{margin:0,fontSize:11,color:"#64748b"}}>
                        {req.emp.id} · {req.type==="excuse"&&req.excuseStart?fmtDateShort(req.excuseStart):req.type==="leave"&&req.leaveDate?fmtDateShort(req.leaveDate):fmtDateShort(req.date)}
                      </p>
                    </div>
                    <span style={{...S.badge,
                      background:req.type==="excuse"?"#ede9fe":"#fef3c7",
                      color:req.type==="excuse"?"#5b21b6":"#92400e"}}>
                      {req.type==="excuse"?(req.excuseKind==="early"?"زمنية — خروج مبكر":"زمنية — تأخير دخول"):"إجازة"}
                    </span>
                  </div>
                  {req.type==="excuse"&&req.excuseStart&&(
                    <p style={{margin:"0 0 6px",fontSize:12,color:"#5b21b6",fontWeight:600}}>
                      ⏱ تغطي من {fmtTime(req.excuseStart)} إلى {fmtTime(excuseEndIso)}
                    </p>
                  )}
                  {req.type==="leave"&&req.leaveDate&&(
                    <p style={{margin:"0 0 6px",fontSize:12,color:"#92400e",fontWeight:600}}>
                      📅 يوم الإجازة: {fmtDate(req.leaveDate)}
                    </p>
                  )}
                  <p style={{margin:"0 0 10px",fontSize:13,color:"#334155"}}>{req.reason}</p>
                  {req.status==="pending"?(
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>approveRequest(req.emp.id,req.id,true)}
                        style={{flex:1,background:"#22c55e",color:"#fff",border:"none",borderRadius:10,padding:"8px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                        ✓ موافقة
                      </button>
                      <button onClick={()=>approveRequest(req.emp.id,req.id,false)}
                        style={{flex:1,background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"8px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                        ✗ رفض
                      </button>
                    </div>
                  ):(
                    <div>
                      <span style={{fontSize:13,fontWeight:700,color:req.status==="approved"?"#166534":"#991b1b"}}>
                        {req.status==="approved"?"✓ تمت الموافقة":"✗ مرفوض"}
                      </span>
                      {req.decisionDate&&(
                        <p style={{margin:"4px 0 0",fontSize:11,color:"#94a3b8"}}>{fmtDate(req.decisionDate)} — {fmtTime(req.decisionDate)}</p>
                      )}
                    </div>
                  )}
                </div>
                );
              })
            }
          </div>
        )}

        {/* ── الخصومات ── */}
        {tab==="deductions"&&(
          <div style={{padding:"16px 16px 90px"}}>
            <h2 style={{...S.sectionTitle,paddingTop:0}}>إعدادات الخصومات</h2>

            <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #e2e8f0",marginBottom:16}}>
              <p style={{margin:"0 0 6px",fontSize:13,color:"#64748b",fontWeight:600}}>مبلغ خصم التأخير (دينار)</p>
              <p style={{margin:"0 0 12px",fontSize:11,color:"#94a3b8"}}>يُطبَّق عند التسجيل بعد الساعة 8:00 صباحاً</p>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <input
                  style={{...S.searchInput,flex:1,background:"#f8fafc",fontSize:18,fontWeight:700,textAlign:"center",direction:"ltr"}}
                  type="number" value={deductionInput}
                  onChange={e=>setDeductionInput(e.target.value)}
                />
                <button onClick={()=>saveDeduction(deductionInput)}
                  style={{background:"#6366f1",color:"#fff",border:"none",borderRadius:12,padding:"10px 20px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                  حفظ
                </button>
              </div>
              <div style={{background:"#ede9fe",borderRadius:10,padding:"10px 14px",marginTop:12}}>
                <p style={{margin:0,fontSize:13,color:"#5b21b6",fontWeight:700}}>
                  الخصم الحالي: {deduction.toLocaleString()} دينار
                </p>
              </div>
            </div>

            <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #e2e8f0",marginBottom:16}}>
              <p style={{margin:"0 0 4px",fontSize:13,color:"#64748b",fontWeight:600}}>إجمالي الخصومات المسجلة</p>
              <p style={{margin:0,fontSize:32,fontWeight:800,color:"#dc2626"}}>{totalDeductions.toLocaleString()} <span style={{fontSize:16}}>دينار</span></p>
            </div>

            <h3 style={{fontSize:15,fontWeight:700,color:"#0f172a",margin:"20px 0 12px"}}>سجل الخصومات</h3>
            {allRecords.filter(r=>r.deduction).length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>💸</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد خصومات</p></div>
              :allRecords.filter(r=>r.deduction).map((r,i)=>(
                <div key={i} style={{...S.recordCard,borderRight:"4px solid #ef4444"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <p style={{margin:0,fontWeight:700,fontSize:14}}>{r.emp.name}</p>
                      <p style={{margin:0,fontSize:11,color:"#64748b"}}>{dayName(r.checkIn)} {fmtDateShort(r.checkIn)} · حضور {fmtTime(r.checkIn)}</p>
                    </div>
                    <p style={{margin:0,fontSize:18,fontWeight:800,color:"#dc2626"}}>{r.deduction.toLocaleString()}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── الموظفون ── */}
        {tab==="employees"&&(
          <div style={{padding:"16px 16px 90px"}}>
            <h2 style={{...S.sectionTitle,paddingTop:0}}>قائمة الموظفين</h2>
            {selectedEmp ? (
              <>
                <button onClick={()=>setSelectedEmp(null)}
                  style={{background:"#f1f5f9",border:"none",borderRadius:10,padding:"8px 16px",fontSize:13,fontWeight:700,color:"#475569",cursor:"pointer",marginBottom:16}}>
                  ← رجوع للقائمة
                </button>
                {/* بطاقة تفاصيل الموظف */}
                <div style={{background:"linear-gradient(135deg,#1e1b4b,#4c1d95)",borderRadius:20,padding:24,marginBottom:16,textAlign:"center"}}>
                  <div style={{...S.avatar,width:72,height:72,fontSize:26,margin:"0 auto 14px",background:"rgba(255,255,255,0.15)"}}>
                    {selectedEmp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                  </div>
                  <p style={{color:"#fff",fontWeight:800,fontSize:18,margin:"0 0 4px"}}>{selectedEmp.name}</p>
                  <p style={{color:"#a5b4fc",fontSize:13,margin:0}}>{selectedEmp.position}</p>
                </div>
                {[
                  {icon:"🪪",label:"الرقم الوظيفي",val:selectedEmp.id},
                  {icon:"🏢",label:"القسم",val:selectedEmp.department},
                  {icon:"💼",label:"المنصب",val:selectedEmp.position},
                  {icon:"📅",label:"أيام الحضور",val:`${getEmpData(selectedEmp.id).filter(r=>r.checkOut).length} يوم مكتمل`},
                  {icon:"⏱",label:"إجمالي ساعات الدوام",val:`${getEmpData(selectedEmp.id).reduce((a,r)=>r.checkOut?a+((new Date(r.checkOut)-new Date(r.checkIn))/3600000):a,0).toFixed(1)} ساعة`},
                  {icon:"⚠️",label:"أيام التأخير",val:`${getEmpData(selectedEmp.id).filter(r=>r.status==="late").length} يوم`},
                  {icon:"💸",label:"إجمالي الخصومات",val:`${getEmpData(selectedEmp.id).reduce((a,r)=>a+(r.deduction||0),0).toLocaleString()} دينار`},
                  {icon:"🟡",label:"زمنيات هذا الشهر",val:`${monthExcuses(selectedEmp.id)} / ${MONTHLY_LIMITS.excuses}`},
                  {icon:"🌴",label:"إجازات هذا الشهر",val:`${monthLeaves(selectedEmp.id)} / ${MONTHLY_LIMITS.leaves}`},
                ].map(item=>(
                  <div key={item.label} style={{...S.infoRow,marginBottom:8}}>
                    <span style={{fontSize:20}}>{item.icon}</span>
                    <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <p style={{margin:0,fontSize:13,color:"#64748b"}}>{item.label}</p>
                      <p style={{margin:0,fontSize:14,fontWeight:700,color:"#0f172a"}}>{item.val}</p>
                    </div>
                  </div>
                ))}
                {/* سجل الحضور الخاص بهذا الموظف */}
                <h3 style={{fontSize:14,fontWeight:700,color:"#0f172a",margin:"20px 0 10px"}}>📋 سجل حضوره</h3>
                {getEmpData(selectedEmp.id).length===0
                  ?<div style={S.empty}><span style={{fontSize:40}}>📭</span><p style={{color:"#94a3b8",marginTop:8,fontSize:13}}>لا يوجد سجل بعد</p></div>
                  :getEmpData(selectedEmp.id).slice().reverse().map((r,i)=>{
                    const dur=duration(r.checkIn,r.checkOut);
                    return(
                      <div key={i} style={{...S.recordCard,borderRight:`4px solid ${r.status==="late"?"#f59e0b":"#22c55e"}`,marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <p style={{margin:0,fontSize:13,fontWeight:700,color:"#334155"}}>{dayName(r.checkIn)} — {fmtDateShort(r.checkIn)}</p>
                          <div style={{display:"flex",gap:4}}>
                            <span style={{...S.badge,background:r.checkOut?"#dcfce7":"#fef9c3",color:r.checkOut?"#166534":"#854d0e",fontSize:10}}>
                              {r.checkOut?"مكتمل":"في الدوام"}
                            </span>
                            {r.status==="late"&&<span style={{...S.badge,background:"#fee2e2",color:"#991b1b",fontSize:10}}>متأخر</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                          <span style={{fontSize:12,color:"#22c55e",fontWeight:600}}>↓ {fmtTime(r.checkIn)}</span>
                          <span style={{fontSize:12,color:"#ef4444",fontWeight:600}}>↑ {fmtTime(r.checkOut)}</span>
                          {dur&&<span style={{fontSize:12,color:"#6366f1",fontWeight:600}}>⏱ {dur}h</span>}
                          {r.deduction&&<span style={{fontSize:12,color:"#dc2626",fontWeight:700}}>💸 {r.deduction.toLocaleString()} دينار</span>}
                        </div>
                      </div>
                    );
                  })
                }
              </>
            ):(
              EMPLOYEES.map(emp=>{
                const empRecords=getEmpData(emp.id);
                const empDed=empRecords.reduce((a,r)=>a+(r.deduction||0),0);
                const empHours=empRecords.reduce((a,r)=>r.checkOut?a+((new Date(r.checkOut)-new Date(r.checkIn))/3600000):a,0);
                const isHereNow=empRecords.some(r=>new Date(r.checkIn).toDateString()===todayStr&&!r.checkOut);
                const todayRec=empRecords.find(r=>new Date(r.checkIn).toDateString()===todayStr);
                return(
                  <div key={emp.id} onClick={()=>setSelectedEmp(emp)}
                    style={{...S.recordCard,cursor:"pointer",marginBottom:10,borderRight:`4px solid ${isHereNow?"#22c55e":todayRec?"#6366f1":"#e2e8f0"}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <div style={{...S.avatar,width:46,height:46,fontSize:16,flexShrink:0}}>
                        {emp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                      </div>
                      <div style={{flex:1}}>
                        <p style={{margin:0,fontWeight:700,color:"#0f172a",fontSize:15}}>{emp.name}</p>
                        <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{emp.position} · {emp.department}</p>
                        <p style={{margin:"1px 0 0",fontSize:11,color:"#94a3b8",fontFamily:"monospace"}}>{emp.id}</p>
                      </div>
                      <span style={{...S.badge,fontSize:11,
                        background:isHereNow?"#dcfce7":todayRec?"#ede9fe":"#f1f5f9",
                        color:isHereNow?"#166534":todayRec?"#5b21b6":"#64748b"}}>
                        {isHereNow?"🟢 في الدوام":todayRec?"✓ حضر":"⭕ غائب"}
                      </span>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <span style={{background:"#f0fdf4",color:"#166534",borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:600}}>
                        📅 {empRecords.filter(r=>r.checkOut).length} يوم
                      </span>
                      <span style={{background:"#eff6ff",color:"#1d4ed8",borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:600}}>
                        ⏱ {empHours.toFixed(1)}h
                      </span>
                      {empDed>0&&<span style={{background:"#fef2f2",color:"#dc2626",borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:700}}>
                        💸 {empDed.toLocaleString()} د
                      </span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  شاشة الموظف الرئيسية
// ══════════════════════════════════════════════════════════════
function HomeScreen({employee,onLogout}){
  const [records,setRecords]=useState(()=>getEmpData(employee.id));
  const [gpsState,setGpsState]=useState(null);
  const [gpsMsg,setGpsMsg]=useState("");
  const [showCheckout,setShowCheckout]=useState(false);
  const [showExcuse,setShowExcuse]=useState(false);
  const [activeTab,setActiveTab]=useState("home");
  const [historySubTab,setHistorySubTab]=useState("attendance"); // attendance | requests
  const [simulated,setSimulated]=useState(false);
  const [,forceUpdate]=useState(0);

  // قراءة مبلغ الخصم الحالي
  function currentDeduction(){ try{ return JSON.parse(localStorage.getItem("lateDeduction")||JSON.stringify(RULES.lateDeduction)); }catch{ return RULES.lateDeduction; } }

  const todayKey=new Date().toDateString();
  const todayRec=records.find(r=>new Date(r.checkIn).toDateString()===todayKey);
  const isCheckedIn=todayRec&&!todayRec.checkOut;

  const weekRecs=records.slice(-14).reverse();
  const totalHours=records.reduce((a,r)=>r.checkOut?a+(new Date(r.checkOut)-new Date(r.checkIn))/3600000:a,0);
  const totalDeductions=records.reduce((a,r)=>a+(r.deduction||0),0);
  const initials=employee.name.split(" ").slice(0,2).map(n=>n[0]).join("");

  const excLeft=MONTHLY_LIMITS.excuses-monthExcuses(employee.id);
  const leaveLeft=MONTHLY_LIMITS.leaves-monthLeaves(employee.id);
  const myRequests=getExcuses(employee.id).sort((a,b)=>b.id-a.id);

  function save(updated){ setRecords(updated); saveEmpData(employee.id,updated); }

  function handleAttendance(){
    // التحقق من إمكانية التسجيل
    if(!isCheckedIn&&!canCheckIn()){
      setGpsState("error");
      setGpsMsg("وقت تسجيل الحضور من 12:00 ص إلى 11:59 ص فقط");
      return;
    }
    if(isCheckedIn&&!canCheckOut()){
      setGpsState("error");
      setGpsMsg("وقت تسجيل الانصراف من 12:00 م إلى 11:59 م فقط");
      return;
    }
    setGpsState("locating"); setGpsMsg("جارٍ تحديد موقعك..."); setSimulated(false);
    if(!navigator.geolocation){ doSimulate(); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const dist=getDistance(pos.coords.latitude,pos.coords.longitude,OFFICE.lat,OFFICE.lng);
        if(dist>OFFICE.radius){ setGpsState("far"); setGpsMsg(`أنت على بُعد ${Math.round(dist)} متر — يجب أن تكون ضمن ${OFFICE.radius} متر`); }
        else afterGPS();
      },
      err=>{ if(err.code===1){setGpsState("denied");setGpsMsg("يرجى السماح بالوصول للموقع");}else doSimulate(); },
      {enableHighAccuracy:true,timeout:12000}
    );
  }

  function doSimulate(){ setSimulated(true); afterGPS(); }

  function afterGPS(){
    if(isCheckedIn){ setShowCheckout(true); setGpsState(null); }
    else doCheckIn();
  }

  function doCheckIn(){
    if(todayRec){ setGpsState("error"); setGpsMsg("تم تسجيل حضورك وانصرافك اليوم مسبقاً"); return; }
    const now=new Date().toISOString();
    const status=checkInStatus(now);
    const covered = status==="late" ? findCoveringExcuse(employee.id, now) : null;
    const ded=(status==="late" && !covered)?currentDeduction():0;
    const newRecord={id:Date.now(),checkIn:now,checkOut:null,status,deduction:ded||undefined,excused:!!covered};
    save([...records,newRecord]);
    gsSaveAttendance(employee, newRecord); // حفظ في Google Sheets
    setGpsState("ok");
    if(status==="late"&&covered) setGpsMsg("تم تسجيل الحضور — تأخير مغطّى بزمنية معتمدة ✓ بدون خصم");
    else if(status==="late") setGpsMsg(`تم تسجيل الحضور — ⚠️ تأخير — سيُطرح ${ded.toLocaleString()} دينار`);
    else setGpsMsg("تم تسجيل الحضور بنجاح ✓ في الوقت المحدد");
  }

  function confirmCheckout(){
    const now=new Date().toISOString();
    const m = nowMin();
    const isEarly = isEarlyLeaveTime(m);
    const covered = isEarly ? findCoveringExcuse(employee.id, now) : null;
    const earlyDed = (isEarly && !covered) ? currentDeduction() : 0;
    const updatedRecords = records.map(r=>r.id===todayRec.id?{
      ...r,
      checkOut:now,
      deduction:(r.deduction||0)+earlyDed||undefined,
      earlyLeave:isEarly||undefined,
      earlyLeaveExcused:(isEarly&&!!covered)||undefined,
    }:r);
    save(updatedRecords);
    // حفظ الانصراف في Google Sheets
    const updatedRec = updatedRecords.find(r=>r.id===todayRec.id);
    if(updatedRec) gsSaveAttendance(employee, updatedRec);
    setShowCheckout(false); setGpsState("ok");
    if(isEarly&&covered) setGpsMsg("تم تسجيل الانصراف — خروج مبكر مغطّى بزمنية معتمدة ✓ بدون خصم");
    else if(isEarly) setGpsMsg(`تم تسجيل الانصراف — ⚠️ خروج مبكر — سيُطرح ${earlyDed.toLocaleString()} دينار`);
    else setGpsMsg("تم تسجيل الانصراف بنجاح ✓");
  }

  // الوقت المتبقي + حالة الزمنية النشطة
  const [timeInfo,setTimeInfo]=useState({});
  useEffect(()=>{
    function calc(){
      const now = new Date();
      const m = now.getHours()*60 + now.getMinutes();

      // أولاً: هل لدى الموظف زمنية معتمدة نشطة الآن؟
      const activeExcuse = getExcuses(employee.id).find(e=>{
        if(e.type!=="excuse" || e.status!=="approved") return false;
        const start = new Date(e.excuseStart);
        const end = new Date(start.getTime()+RULES.excuseHours*3600000);
        return now>=start && now<=end;
      });
      if(activeExcuse){
        const start = new Date(activeExcuse.excuseStart);
        const end = new Date(start.getTime()+RULES.excuseHours*3600000);
        const elapsedMin = Math.floor((now-start)/60000);
        const remainMin  = Math.floor((end-now)/60000);
        const kindLabel = activeExcuse.excuseKind==="early" ? "خروج مبكر" : "تأخير دخول";
        setTimeInfo({
          msg:`🕓 زمنيتك (${kindLabel}) — صار عليها ${Math.floor(elapsedMin/60)}:${String(elapsedMin%60).padStart(2,"0")} من بدايتها، وباقي ${Math.floor(remainMin/60)}:${String(remainMin%60).padStart(2,"0")} على انتهائها`,
          color:"#075985", bg:"#e0f2fe"
        });
        return;
      }

      const checkInEnd=toMin(RULES.checkIn.to.h,RULES.checkIn.to.m);
      const lateEnd=toMin(RULES.late.to.h,RULES.late.to.m);
      const earlyStart=toMin(RULES.earlyLeave.from.h,RULES.earlyLeave.from.m);
      const earlyEnd=toMin(RULES.earlyLeave.to.h,RULES.earlyLeave.to.m);
      const checkOutStart=toMin(RULES.checkOut.from.h,RULES.checkOut.from.m);

      if(!isCheckedIn&&m<checkInEnd){
        const left=checkInEnd-m;
        setTimeInfo({msg:`⏰ متبقي على إغلاق بوابة الدخول الرسمي: ${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`,color:"#854d0e",bg:"#fef9c3"});
      } else if(!isCheckedIn&&m>=checkInEnd&&m<=lateEnd){
        const left=lateEnd-m;
        setTimeInfo({msg:`⚠️ أنت الآن بفترة تأخير الدخول (يُسجَّل خصم) — متبقي: ${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`,color:"#991b1b",bg:"#fee2e2"});
      } else if(isCheckedIn&&m>=earlyStart&&m<=earlyEnd){
        const left=earlyEnd-m;
        setTimeInfo({msg:`⚠️ أنت الآن بفترة الخروج المبكر (يُسجَّل خصم إذا انصرفت) — متبقي: ${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`,color:"#991b1b",bg:"#fee2e2"});
      } else if(isCheckedIn&&m<checkOutStart){
        const left=checkOutStart-m;
        setTimeInfo({msg:`⏳ يمكن الانصراف بدون خصم بعد: ${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`,color:"#1d4ed8",bg:"#eff6ff"});
      } else {
        setTimeInfo({});
      }
    }
    calc();
    const t=setInterval(calc,30000);
    return ()=>clearInterval(t);
  },[isCheckedIn]);

  return(
    <div style={S.appWrap}>
      {showCheckout&&todayRec&&(
        <CheckoutModal employee={employee} checkInTime={todayRec.checkIn}
          onConfirm={confirmCheckout} onCancel={()=>{setShowCheckout(false);setGpsState(null);}}/>
      )}
      {showExcuse&&(
        <ExcuseModal employee={employee} onClose={()=>{setShowExcuse(false);forceUpdate(n=>n+1);}}/>
      )}

      <div style={S.header}>
        <button style={S.logoutBtn} onClick={onLogout}>خروج</button>
        <span style={S.headerTitle}>الحضور والانصراف</span>
        <div style={{width:60}}/>
      </div>

      <div style={S.scrollArea}>

        {/* ── الرئيسية ── */}
        {activeTab==="home"&&<>
          {/* بطاقة الموظف */}
          <div style={S.empCard}>
            <div style={S.avatar}>{initials}</div>
            <div style={{flex:1}}>
              <p style={S.empName}>{employee.name}</p>
              <p style={S.empMeta}>{employee.position} · {employee.department}</p>
              <p style={S.empId}>{employee.id}</p>
            </div>
          </div>

          <LiveClock/>

          {/* شريط أوقات الدوام */}
          <div style={S.timeRulesBox}>
            <div style={S.timeRule}>
              <span style={{fontSize:16}}>🟢</span>
              <div>
                <p style={S.timeRuleLabel}>وقت الحضور</p>
                <p style={S.timeRuleVal}>12:00 ص — 8:00 ص</p>
              </div>
            </div>
            <div style={S.timeRuleDivider}/>
            <div style={S.timeRule}>
              <span style={{fontSize:16}}>🟡</span>
              <div>
                <p style={S.timeRuleLabel}>تأخير دخول (خصم)</p>
                <p style={S.timeRuleVal}>8:01 ص — 11:59 ص</p>
              </div>
            </div>
            <div style={S.timeRuleDivider}/>
            <div style={S.timeRule}>
              <span style={{fontSize:16}}>🟠</span>
              <div>
                <p style={S.timeRuleLabel}>خروج مبكر (خصم)</p>
                <p style={S.timeRuleVal}>12:00 م — 1:59 م</p>
              </div>
            </div>
            <div style={S.timeRuleDivider}/>
            <div style={S.timeRule}>
              <span style={{fontSize:16}}>🔴</span>
              <div>
                <p style={S.timeRuleLabel}>الانصراف</p>
                <p style={S.timeRuleVal}>2:00 م — 11:59 م</p>
              </div>
            </div>
          </div>

          {/* عداد تنازلي */}
          {timeInfo.msg&&(
            <div style={{...S.feedback,background:timeInfo.bg,margin:"10px 16px 0"}}>
              <p style={{margin:0,fontSize:13,fontWeight:700,color:timeInfo.color}}>{timeInfo.msg}</p>
            </div>
          )}

          {/* حالة اليوم */}
          {todayRec&&(
            <div style={{...S.todayBar,background:isCheckedIn?"#dcfce7":todayRec.status==="late"?"#fef9c3":"#f0fdf4"}}>
              <span style={{fontSize:20}}>{isCheckedIn?"🟢":todayRec.status==="late"?"⚠️":"✅"}</span>
              <div style={{flex:1}}>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:isCheckedIn?"#166534":todayRec.status==="late"?"#854d0e":"#15803d"}}>
                  {isCheckedIn?(todayRec.status==="late"?"في الدوام — تسجيل متأخر":"في الدوام — في الوقت"):
                    (todayRec.status==="late"?"انتهى الدوام — كان متأخراً":"انتهى الدوام")}
                </p>
                <p style={{margin:0,fontSize:12,color:"#64748b"}}>
                  حضور: {fmtTime(todayRec.checkIn)}
                  {todayRec.checkOut&&` · انصراف: ${fmtTime(todayRec.checkOut)}`}
                  {todayRec.checkOut&&` · ${duration(todayRec.checkIn,todayRec.checkOut)}h`}
                </p>
                {todayRec.deduction&&(
                  <p style={{margin:"3px 0 0",fontSize:12,color:"#dc2626",fontWeight:700}}>
                    💸 خصم التأخير: {todayRec.deduction.toLocaleString()} دينار
                  </p>
                )}
              </div>
            </div>
          )}

          {/* الزر الكبير */}
          <button
            style={{...S.bigBtn,background:isCheckedIn
              ?"linear-gradient(135deg,#ef4444,#b91c1c)"
              :"linear-gradient(135deg,#22c55e,#15803d)"}}
            onClick={handleAttendance}>
            <span style={{fontSize:48}}>{isCheckedIn?"👋":"👆"}</span>
            <span style={S.bigBtnLabel}>{isCheckedIn?"تسجيل الانصراف":"تسجيل الحضور"}</span>
            <span style={S.bigBtnSub}>
              {gpsState==="locating"?"⏳ جارٍ تحديد الموقع...":"اضغط — سيتحقق من موقعك وتوقيتك"}
            </span>
          </button>

          {/* ملاحظة GPS */}
          <div style={S.gpsNote}>
            <span style={{fontSize:14}}>📍</span>
            <span style={{fontSize:12,color:"#64748b"}}>يجب أن تكون ضمن <b>{OFFICE.radius} متر</b> من مقر العمل</span>
          </div>

          {/* رسالة الحالة */}
          {gpsState&&gpsState!=="locating"&&(
            <div style={{...S.feedback,
              background:gpsState==="ok"?"#dcfce7":gpsState==="far"||gpsState==="denied"?"#fef9c3":"#fee2e2"}}>
              <span style={{fontSize:20}}>{gpsState==="ok"?"✅":gpsState==="far"?"📍":"❌"}</span>
              <div>
                <p style={{margin:0,fontSize:13,fontWeight:600,
                  color:gpsState==="ok"?"#166534":gpsState==="far"?"#854d0e":"#991b1b"}}>{gpsMsg}</p>
                {simulated&&gpsState==="ok"&&<p style={{margin:"2px 0 0",fontSize:11,color:"#94a3b8"}}>وضع تجريبي — GPS محاكى</p>}
              </div>
            </div>
          )}

          {/* زمنية / إجازة */}
          <button style={S.excuseBtn} onClick={()=>setShowExcuse(true)}>
            <span>📋</span>
            <div style={{textAlign:"right"}}>
              <p style={{margin:0,fontSize:14,fontWeight:700,color:"#5b21b6"}}>طلب زمنية أو إجازة</p>
              <p style={{margin:0,fontSize:11,color:"#7c3aed"}}>
                زمنيات متبقية: {excLeft}/2 · إجازات: {leaveLeft}/1
              </p>
            </div>
          </button>

          {/* إحصائيات */}
          <div style={S.statsRow}>
            <div style={S.statBox}>
              <p style={S.statNum}>{records.filter(r=>r.checkOut).length}</p>
              <p style={S.statLabel}>أيام مكتملة</p>
            </div>
            <div style={S.statBox}>
              <p style={S.statNum}>{totalHours.toFixed(1)}</p>
              <p style={S.statLabel}>إجمالي ساعات</p>
            </div>
            <div style={{...S.statBox,borderTop:"2px solid #ef4444"}}>
              <p style={{...S.statNum,color:"#dc2626"}}>{totalDeductions.toLocaleString()}</p>
              <p style={S.statLabel}>خصومات (دينار)</p>
            </div>
          </div>
        </>}

        {/* ── السجل ── */}
        {activeTab==="history"&&(
          <div style={{padding:"0 16px 90px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 0 12px"}}>
              <h2 style={{...S.sectionTitle,padding:0}}>{historySubTab==="attendance"?"سجل الحضور":"طلباتي"}</h2>
              {historySubTab==="attendance"&&records.length>0&&(
                <button onClick={()=>exportCSV(records.map(r=>({...r,emp:employee})))}
                  style={{background:"#0f172a",color:"#fff",border:"none",borderRadius:10,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  ⬇ CSV
                </button>
              )}
            </div>

            {/* تبديل بين سجل الحضور وطلباتي */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[{k:"attendance",label:"سجل الحضور"},{k:"requests",label:`طلباتي${myRequests.length?` (${myRequests.length})`:""}`}].map(({k,label})=>(
                <button key={k} onClick={()=>setHistorySubTab(k)}
                  style={{flex:1,padding:"9px 6px",borderRadius:10,border:"2px solid",cursor:"pointer",fontSize:13,fontWeight:700,
                    borderColor:historySubTab===k?"#6366f1":"#e2e8f0",
                    background:historySubTab===k?"#ede9fe":"#f8fafc",
                    color:historySubTab===k?"#4f46e5":"#64748b"}}>
                  {label}
                </button>
              ))}
            </div>

            {historySubTab==="attendance"&&(
              weekRecs.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📋</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد سجل بعد</p></div>
              :weekRecs.map(r=>{
                const dur=duration(r.checkIn,r.checkOut);
                return(
                  <div key={r.id} style={{...S.recordCard,borderRight:`4px solid ${r.status==="late"?"#f59e0b":"#22c55e"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <p style={{margin:0,fontSize:13,fontWeight:700,color:"#334155"}}>{dayName(r.checkIn)}</p>
                        <p style={{margin:"1px 0 0",fontSize:11,color:"#94a3b8"}}>{fmtDateShort(r.checkIn)}</p>
                      </div>
                      <div style={{display:"flex",gap:4,flexDirection:"column",alignItems:"flex-end"}}>
                        <span style={{...S.badge,background:r.checkOut?"#dcfce7":"#fef9c3",color:r.checkOut?"#166534":"#854d0e"}}>
                          {r.checkOut?"مكتمل":"في الدوام"}
                        </span>
                        {r.status==="late"&&<span style={{...S.badge,background:"#fee2e2",color:"#991b1b"}}>متأخر</span>}
                      </div>
                    </div>
                    <div style={S.recordTimes}>
                      <div style={S.timeItem}><span style={{color:"#22c55e",fontWeight:700}}>↓</span><span style={{fontSize:13,color:"#475569"}}>حضور: <b>{fmtTime(r.checkIn)}</b></span></div>
                      <div style={S.timeItem}><span style={{color:"#ef4444",fontWeight:700}}>↑</span><span style={{fontSize:13,color:"#475569"}}>انصراف: <b>{fmtTime(r.checkOut)}</b></span></div>
                      {dur&&<div style={S.timeItem}><span style={{color:"#6366f1",fontWeight:700}}>⏱</span><span style={{fontSize:13,color:"#475569"}}>المدة: <b>{dur} ساعة</b></span></div>}
                      {r.deduction&&<div style={S.timeItem}><span style={{color:"#dc2626",fontWeight:700}}>💸</span><span style={{fontSize:13,color:"#dc2626",fontWeight:700}}>خصم: {r.deduction.toLocaleString()} دينار</span></div>}
                    </div>
                  </div>
                );
              })
            )}

            {historySubTab==="requests"&&(
              myRequests.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📭</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد طلبات</p></div>
              :myRequests.map(req=>{
                const excuseEndIso = req.type==="excuse" && req.excuseStart
                  ? new Date(new Date(req.excuseStart).getTime()+RULES.excuseHours*3600000).toISOString()
                  : null;
                const statusColor = req.status==="pending"?"#f59e0b":req.status==="approved"?"#22c55e":"#ef4444";
                return(
                  <div key={req.id} style={{...S.recordCard,borderRight:`4px solid ${statusColor}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <p style={{margin:0,fontWeight:700,fontSize:14,color:"#0f172a"}}>
                          {req.type==="excuse"?(req.excuseKind==="early"?"زمنية — خروج مبكر":"زمنية — تأخير دخول"):"إجازة"}
                        </p>
                        <p style={{margin:"1px 0 0",fontSize:11,color:"#94a3b8"}}>
                          🕐 وقت الطلب: {fmtDate(req.date)} — {fmtTime(req.date)}
                        </p>
                      </div>
                      <span style={{...S.badge,
                        background:req.status==="pending"?"#fef9c3":req.status==="approved"?"#dcfce7":"#fee2e2",
                        color:req.status==="pending"?"#854d0e":req.status==="approved"?"#166534":"#991b1b"}}>
                        {req.status==="pending"?"⏳ قيد المراجعة":req.status==="approved"?"✓ مقبول":"✗ مرفوض"}
                      </span>
                    </div>

                    {req.type==="excuse"&&req.excuseStart&&(
                      <p style={{margin:"0 0 6px",fontSize:12,color:"#5b21b6",fontWeight:600}}>
                        ⏱ تغطي من {fmtTime(req.excuseStart)} إلى {fmtTime(excuseEndIso)} — {fmtDateShort(req.excuseStart)}
                      </p>
                    )}
                    {req.type==="leave"&&req.leaveDate&&(
                      <p style={{margin:"0 0 6px",fontSize:12,color:"#92400e",fontWeight:600}}>
                        📅 يوم الإجازة: {fmtDate(req.leaveDate)}
                      </p>
                    )}

                    <p style={{margin:"0 0 8px",fontSize:13,color:"#334155"}}>{req.reason}</p>

                    {req.status!=="pending"&&(
                      <div style={{background:req.status==="approved"?"#f0fdf4":"#fef2f2",borderRadius:10,padding:"8px 12px",fontSize:12,color:req.status==="approved"?"#166534":"#991b1b",fontWeight:600}}>
                        {req.decisionDate?`🕐 تاريخ ${req.status==="approved"?"الموافقة":"الرفض"}: ${fmtDate(req.decisionDate)} — ${fmtTime(req.decisionDate)}`:null}
                        {req.status==="rejected"&&(
                          <div style={{marginTop:4}}>
                            ↩️ تمت إعادة {req.type==="excuse"?"الزمنية":"الإجازة"} إلى رصيدك — لم يتم خصمها من حدّك الشهري
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── الملف ── */}
        {activeTab==="profile"&&(
          <div style={{padding:"0 16px 90px"}}>
            <h2 style={S.sectionTitle}>الملف الشخصي</h2>
            <div style={S.profileCard}>
              <div style={{...S.avatar,width:72,height:72,fontSize:28,margin:"0 auto 16px"}}>{initials}</div>
              <p style={{textAlign:"center",fontSize:20,fontWeight:700,color:"#0f172a",margin:"0 0 4px"}}>{employee.name}</p>
              <p style={{textAlign:"center",fontSize:14,color:"#64748b",margin:0}}>{employee.position}</p>
            </div>
            {[
              {label:"الرقم الوظيفي",value:employee.id,icon:"🪪"},
              {label:"القسم",value:employee.department,icon:"🏢"},
              {label:"المنصب",value:employee.position,icon:"💼"},
            ].map(item=>(
              <div key={item.label} style={S.infoRow}>
                <span style={{fontSize:20}}>{item.icon}</span>
                <div>
                  <p style={{margin:0,fontSize:12,color:"#94a3b8"}}>{item.label}</p>
                  <p style={{margin:0,fontSize:15,fontWeight:600,color:"#1e293b"}}>{item.value}</p>
                </div>
              </div>
            ))}
            <div style={{background:"linear-gradient(135deg,#ede9fe,#ddd6fe)",borderRadius:14,padding:16,marginTop:12,border:"1px solid #c4b5fd"}}>
              <p style={{margin:"0 0 6px",fontWeight:700,color:"#5b21b6",fontSize:14}}>📲 تثبيت التطبيق</p>
              <p style={{margin:0,fontSize:12,color:"#6d28d9",lineHeight:1.6}}>
                iOS: اضغط زر المشاركة ← "إضافة إلى الشاشة الرئيسية"<br/>
                Android: اضغط ⋮ ← "إضافة إلى الشاشة الرئيسية"
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={S.bottomNav}>
        {[{key:"home",icon:"🏠",label:"الرئيسية"},{key:"history",icon:"📋",label:"السجل"},{key:"profile",icon:"👤",label:"ملفي"}].map(tab=>(
          <button key={tab.key} style={{...S.navBtn,...(activeTab===tab.key?S.navBtnActive:{})}} onClick={()=>setActiveTab(tab.key)}>
            <span style={{fontSize:22}}>{tab.icon}</span>
            <span style={{fontSize:10,marginTop:2,color:activeTab===tab.key?"#6366f1":"#94a3b8"}}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  الجذر
// ══════════════════════════════════════════════════════════════
export default function App(){
  const [user,setUser]=useState(null);
  if(!user) return <LoginScreen onLogin={setUser}/>;
  if(user.isAdmin) return <AdminPanel onLogout={()=>setUser(null)}/>;
  return <HomeScreen employee={user} onLogout={()=>setUser(null)}/>;
}

// ══════════════════════════════════════════════════════════════
//  الأنماط
// ══════════════════════════════════════════════════════════════
const S={
  loginWrap:{minHeight:"100vh",background:"linear-gradient(160deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',Tahoma,sans-serif",direction:"rtl",padding:16},
  loginCard:{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:24,padding:"40px 32px",width:"100%",maxWidth:380,display:"flex",flexDirection:"column",gap:12},
  logoCircle:{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 8px"},
  loginTitle:{color:"#f8fafc",fontSize:22,fontWeight:700,textAlign:"center",margin:0},
  loginSub:{color:"#94a3b8",fontSize:13,textAlign:"center",margin:"0 0 8px"},
  label:{color:"#cbd5e1",fontSize:13,fontWeight:600,marginBottom:-4},
  input:{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:12,padding:"12px 16px",color:"#f8fafc",fontSize:15,outline:"none",textAlign:"right",direction:"rtl"},
  btn:{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:12,padding:"14px",fontSize:16,fontWeight:700,cursor:"pointer",marginTop:8},
  errorMsg:{color:"#f87171",fontSize:13,textAlign:"center",margin:0},
  demoHint:{background:"rgba(255,255,255,0.05)",borderRadius:8,padding:"10px 12px",textAlign:"center"},

  appWrap:{height:"100vh",display:"flex",flexDirection:"column",background:"#f8fafc",fontFamily:"'Segoe UI',Tahoma,sans-serif",direction:"rtl",maxWidth:480,margin:"0 auto",position:"relative",overflow:"hidden"},
  header:{background:"linear-gradient(135deg,#0f172a,#1e3a5f)",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0},
  headerTitle:{color:"#f8fafc",fontWeight:700,fontSize:17},
  logoutBtn:{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",color:"#cbd5e1",borderRadius:8,padding:"6px 14px",fontSize:13,cursor:"pointer"},
  scrollArea:{flex:1,overflowY:"auto",paddingBottom:80},

  empCard:{margin:"16px 16px 0",background:"#fff",borderRadius:16,padding:16,display:"flex",alignItems:"center",gap:14,boxShadow:"0 2px 12px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"},
  avatar:{width:52,height:52,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,flexShrink:0},
  empName:{margin:0,fontWeight:700,color:"#0f172a",fontSize:15},
  empMeta:{margin:"2px 0 0",fontSize:12,color:"#64748b"},
  empId:{margin:"2px 0 0",fontSize:11,color:"#94a3b8",fontFamily:"monospace"},

  clockBox:{margin:"12px 16px 0",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:16,padding:20,textAlign:"center"},
  clockDay:{margin:"0 0 2px",fontSize:15,fontWeight:700,color:"#a5b4fc",letterSpacing:1},
  clockTime:{margin:0,fontSize:38,fontWeight:800,color:"#fff",letterSpacing:2},
  clockDate:{margin:"4px 0 0",fontSize:13,color:"rgba(255,255,255,0.6)"},

  timeRulesBox:{margin:"10px 16px 0",background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",display:"flex",flexWrap:"wrap",overflow:"hidden"},
  timeRule:{flex:"1 1 45%",minWidth:"45%",padding:"10px 8px",display:"flex",alignItems:"center",gap:6,boxSizing:"border-box"},
  timeRuleLabel:{margin:0,fontSize:10,color:"#94a3b8",fontWeight:600},
  timeRuleVal:{margin:0,fontSize:11,fontWeight:700,color:"#334155"},
  timeRuleDivider:{display:"none"},

  todayBar:{margin:"10px 16px 0",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,border:"1px solid rgba(0,0,0,0.06)"},

  bigBtn:{margin:"12px 16px 0",borderRadius:20,padding:"24px 20px",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",width:"calc(100% - 32px)"},
  bigBtnLabel:{color:"#fff",fontSize:22,fontWeight:800},
  bigBtnSub:{color:"rgba(255,255,255,0.75)",fontSize:12},

  gpsNote:{margin:"8px 16px 0",background:"#f0f9ff",borderRadius:10,padding:"8px 14px",display:"flex",alignItems:"center",gap:8,border:"1px solid #bae6fd"},
  feedback:{margin:"10px 16px 0",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,border:"1px solid rgba(0,0,0,0.06)"},

  excuseBtn:{margin:"12px 16px 0",background:"linear-gradient(135deg,#ede9fe,#ddd6fe)",border:"1px solid #c4b5fd",borderRadius:14,padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:14,width:"calc(100% - 32px)",fontSize:20},

  statsRow:{margin:"12px 16px 0",display:"flex",gap:10},
  statBox:{flex:1,background:"#fff",borderRadius:14,padding:"14px 10px",textAlign:"center",border:"1px solid #e2e8f0",boxShadow:"0 1px 6px rgba(0,0,0,0.04)"},
  statNum:{margin:0,fontSize:22,fontWeight:800,color:"#6366f1"},
  statLabel:{margin:"2px 0 0",fontSize:11,color:"#94a3b8"},

  bottomNav:{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",boxShadow:"0 -4px 20px rgba(0,0,0,0.08)"},
  navBtn:{flex:1,background:"none",border:"none",padding:"10px 0",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2},
  navBtnActive:{background:"rgba(99,102,241,0.06)"},

  sectionTitle:{padding:"20px 0 12px",margin:0,fontSize:18,fontWeight:700,color:"#0f172a"},
  recordCard:{background:"#fff",borderRadius:14,padding:"14px 16px",marginBottom:10,border:"1px solid #e2e8f0",boxShadow:"0 1px 6px rgba(0,0,0,0.04)"},
  recordDate:{margin:0,fontSize:13,fontWeight:600,color:"#334155"},
  badge:{borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600},
  recordTimes:{marginTop:10,display:"flex",flexDirection:"column",gap:6},
  timeItem:{display:"flex",alignItems:"center",gap:8},

  profileCard:{background:"#fff",borderRadius:16,padding:24,marginBottom:12,border:"1px solid #e2e8f0",textAlign:"center"},
  infoRow:{background:"#fff",borderRadius:12,padding:"14px 16px",marginBottom:8,border:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:14},

  searchInput:{width:"100%",background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"10px 16px",fontSize:14,outline:"none",textAlign:"right",direction:"rtl",boxSizing:"border-box"},
  textarea:{width:"100%",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:"10px 14px",fontSize:14,outline:"none",textAlign:"right",direction:"rtl",resize:"none",fontFamily:"inherit",boxSizing:"border-box"},
  empty:{textAlign:"center",padding:"60px 20px",display:"flex",flexDirection:"column",alignItems:"center"},
};

const M={
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"},
  sheet:{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:480,padding:"12px 24px 36px"},
  handle:{width:40,height:4,background:"#e2e8f0",borderRadius:99,margin:"0 auto 20px"},
  title:{textAlign:"center",fontSize:22,fontWeight:800,color:"#0f172a",margin:"0 0 8px"},
  sub:{textAlign:"center",fontSize:14,color:"#64748b",margin:"0 0 20px"},
  infoBox:{background:"#f8fafc",borderRadius:16,padding:"4px 0",border:"1px solid #e2e8f0",marginBottom:24},
  infoRow:{display:"flex",alignItems:"center",gap:14,padding:"14px 16px"},
  infoLabel:{margin:0,fontSize:11,color:"#94a3b8",fontWeight:500},
  infoVal:{margin:"2px 0 0",fontSize:16,fontWeight:700,color:"#0f172a"},
  divider:{height:1,background:"#e2e8f0",margin:"0 16px"},
  btnRow:{display:"flex",gap:12},
  cancelBtn:{flex:1,background:"#f1f5f9",border:"none",borderRadius:14,padding:14,fontSize:15,fontWeight:700,color:"#475569",cursor:"pointer"},
  confirmBtn:{flex:2,background:"linear-gradient(135deg,#ef4444,#b91c1c)",border:"none",borderRadius:14,padding:14,fontSize:15,fontWeight:700,color:"#fff",cursor:"pointer",boxShadow:"0 4px 14px rgba(239,68,68,0.35)"},
};
