import { useState, useEffect, useCallback, useRef } from "react";
import * as faceapi from "face-api.js";

// ══════════════════════════════════════════════════════════════
//  ربط Google Sheets
// ══════════════════════════════════════════════════════════════
const GS_URL = "https://script.google.com/macros/s/AKfycbyY-t08HCe2cVAViZvrQJbo1yiXgnzESp9v6_g0CqTxb1fK4migbc2pnhEoK1nf7mWe/exec";

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

async function gsSaveFaceDescriptor(empId, descriptor, photo) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveFaceDescriptor", empId, descriptor, photo: photo||"" }),
    });
  } catch (e) { console.warn("GS save face descriptor failed", e); }
}

async function gsSaveWorkDays(monthKeyStr, workDays) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveWorkDays", monthKey: monthKeyStr, workDays }),
    });
  } catch (e) { console.warn("GS save work days failed", e); }
}

async function gsGetWorkDays() {
  try {
    const response = await fetch(`${GS_URL}?action=getWorkDays`);
    const data = await response.json();
    return data.workDays || [];
  } catch (e) {
    console.warn("gsGetWorkDays failed", e);
    return [];
  }
}

// يجلب الوقت الحقيقي من سيرفر Google (لمنع التلاعب بساعة الجهاز عند تسجيل الحضور/الانصراف)
async function gsGetServerTime() {
  try {
    const response = await fetch(`${GS_URL}?action=getServerTime`);
    const data = await response.json();
    if(!data.now) throw new Error("no time");
    return data.now;
  } catch (e) {
    console.warn("gsGetServerTime failed", e);
    throw new Error("تعذّر الاتصال بالسيرفر للتحقق من الوقت. تحقق من الإنترنت وحاول مجدداً.");
  }
}

async function gsGetAttendanceLock() {
  try {
    const response = await fetch(`${GS_URL}?action=getAttendanceLock`);
    const data = await response.json();
    return !!data.locked;
  } catch (e) {
    console.warn("gsGetAttendanceLock failed", e);
    return false;
  }
}

async function gsSetAttendanceLock(locked) {
  try {
    await fetch(GS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setAttendanceLock", locked }),
    });
  } catch (e) { console.warn("GS set attendance lock failed", e); }
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

async function gsGetAttendance() {
  try {
    const response = await fetch(`${GS_URL}?action=getAttendance`);
    const data = await response.json();
    return data.records || [];
  } catch (e) {
    console.warn("gsGetAttendance failed", e);
    return [];
  }
}

async function gsGetExcusesAll() {
  try {
    const response = await fetch(`${GS_URL}?action=getExcuses`);
    const data = await response.json();
    return data.excuses || [];
  } catch (e) {
    console.warn("gsGetExcuses failed", e);
    return [];
  }
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

// إعدادات التحقق من الوجه
const FACE_MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
const FACE_MATCH_THRESHOLD = 0.5; // كل ما قلّت القيمة، زادت الدقة المطلوبة للمطابقة

// ══════════════════════════════════════════════════════════════
//  أدوات مساعدة
// ══════════════════════════════════════════════════════════════
function getDistance(lat1,lng1,lat2,lng2) {
  const R=6371000, φ1=(lat1*Math.PI)/180, φ2=(lat2*Math.PI)/180;
  const Δφ=((lat2-lat1)*Math.PI)/180, Δλ=((lng2-lng1)*Math.PI)/180;
  const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// تحميل نماذج التعرف على الوجه مرة واحدة فقط لكل الجلسة
let faceModelsPromise=null;
function loadFaceModels(){
  if(!faceModelsPromise){
    faceModelsPromise=Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
    ]);
  }
  return faceModelsPromise;
}

// حساب درجة التشابه بين بصمتين (المسافة الإقليدية بين متجهي 128 رقم)
function faceDistance(d1,d2){
  if(!d1||!d2||d1.length!==d2.length) return Infinity;
  let sum=0;
  for(let i=0;i<d1.length;i++) sum+=(d1[i]-d2[i])**2;
  return Math.sqrt(sum);
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
function monthKey(d){ const n=d?new Date(d):new Date(); return `${n.getFullYear()}-${n.getMonth()}`; }

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
  const offsetRef=useRef(0); // الفرق (مليثانية) بين وقت السيرفر ووقت الجهاز

  useEffect(()=>{
    let cancelled=false;
    gsGetServerTime().then(serverIso=>{
      if(cancelled) return;
      offsetRef.current = new Date(serverIso).getTime() - Date.now();
      setNow(new Date(Date.now()+offsetRef.current));
    }).catch(()=>{});
    const t=setInterval(()=>setNow(new Date(Date.now()+offsetRef.current)),1000);
    return ()=>{ cancelled=true; clearInterval(t); };
  },[]);

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
//  نافذة التحقق من الوجه / تسجيل الوجه
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  نافذة إدخال رمز إعادة تسجيل الوجه
// ══════════════════════════════════════════════════════════════
function FaceResetCodeModal({correctCode,onSuccess,onCancel}){
  const [code,setCode]=useState("");
  const [error,setError]=useState("");

  function submit(){
    if(code.trim()===String(correctCode||"").trim() && code.trim()!==""){
      onSuccess();
    } else {
      setError("الرمز غير صحيح — راجع المدير للحصول على الرمز الصحيح");
    }
  }

  return(
    <div style={M.overlay}>
      <div style={M.sheet}>
        <div style={M.handle}/>
        <h2 style={M.title}>رمز إعادة تسجيل الوجه</h2>
        <p style={M.sub}>هذي العملية تستبدل بصمة الوجه المسجَّلة حالياً — أدخل الرمز المعتمد من المدير للاستمرار</p>
        <input
          type="password" placeholder="أدخل الرمز" value={code}
          onChange={e=>{setCode(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:"12px 16px",color:"#0f172a",fontSize:15,outline:"none",textAlign:"right",direction:"rtl",width:"100%",boxSizing:"border-box",marginBottom:12}}
        />
        {error&&<p style={{color:"#dc2626",fontSize:13,textAlign:"center",margin:"0 0 12px"}}>{error}</p>}
        <div style={M.btnRow}>
          <button style={M.cancelBtn} onClick={onCancel}>إلغاء</button>
          <button style={{...M.confirmBtn,background:"linear-gradient(135deg,#6366f1,#4338ca)",boxShadow:"0 4px 14px rgba(99,102,241,0.35)"}} onClick={submit}>
            تأكيد
          </button>
        </div>
      </div>
    </div>
  );
}

function FaceCaptureModal({mode,acceptedDescriptors,onDone,onCancel}){
  // mode: "enroll" يسجل وجه جديد | "verify" يطابق مع أي بصمة من acceptedDescriptors
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const [status,setStatus]=useState("loading"); // loading | ready | scanning | success | fail | error
  const [message,setMessage]=useState("جارٍ تحميل نظام التعرف على الوجه...");
  const [attempts,setAttempts]=useState(0);

  useEffect(()=>{
    let cancelled=false;
    async function start(){
      try{
        await loadFaceModels();
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user"}});
        if(cancelled){ stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current=stream;
        if(videoRef.current){ videoRef.current.srcObject=stream; }
        setStatus("ready");
        setMessage(mode==="enroll"?"ضع وجهك وسط الإطار واضغط تسجيل":"ضع وجهك وسط الإطار للتحقق");
      }catch(e){
        if(!cancelled){ setStatus("error"); setMessage("تعذّر تشغيل الكاميرا — تأكد من السماح بالوصول إليها"); }
      }
    }
    start();
    return ()=>{
      cancelled=true;
      if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    };
  },[mode]);

  function stopCamera(){
    if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
  }

  async function capture(){
    if(status!=="ready" && status!=="fail") return;
    setStatus("scanning"); setMessage("جارٍ تحليل الوجه...");
    try{
      const detection=await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if(!detection){
        setStatus("fail"); setMessage("لم يتم العثور على وجه — حاول مرة أخرى بإضاءة أفضل");
        setAttempts(a=>a+1);
        return;
      }
      const descriptor=Array.from(detection.descriptor);
      if(mode==="enroll"){
        // التقاط صورة مصغّرة ومضغوطة (للعرض البشري فقط؛ التحقق الفعلي يعتمد على البصمة الرقمية أعلاه)
        let photo="";
        try{
          const canvas=document.createElement("canvas");
          const targetWidth=80; // أصغر لضمان الحفظ في Sheets
          const scale=targetWidth/videoRef.current.videoWidth;
          canvas.width=targetWidth;
          canvas.height=videoRef.current.videoHeight*scale;
          const ctx=canvas.getContext("2d");
          ctx.translate(canvas.width,0); ctx.scale(-1,1);
          ctx.drawImage(videoRef.current,0,0,canvas.width,canvas.height);
          photo=canvas.toDataURL("image/jpeg",0.3); // جودة أقل لحجم أصغر
        }catch(e){ /* تجاهل فشل التقاط الصورة، البصمة الرقمية تكفي للتحقق */ }
        stopCamera();
        setStatus("success"); setMessage("تم تسجيل الوجه بنجاح ✓");
        setTimeout(()=>onDone(descriptor,photo),900);
      } else {
        const matched=(acceptedDescriptors||[]).some(saved=>faceDistance(descriptor,saved)<=FACE_MATCH_THRESHOLD);
        if(matched){
          stopCamera();
          setStatus("success"); setMessage("تم التحقق من الهوية ✓");
          setTimeout(()=>onDone(true),700);
        } else {
          setStatus("fail"); setMessage("الوجه غير مطابق — حاول مرة أخرى");
          setAttempts(a=>a+1);
        }
      }
    }catch(e){
      setStatus("fail"); setMessage("حدث خطأ بالتحليل — حاول مرة أخرى");
      setAttempts(a=>a+1);
    }
  }

  function cancel(){ stopCamera(); onCancel(); }

  return(
    <div style={M.overlay}>
      <div style={M.sheet}>
        <div style={M.handle}/>
        <h2 style={M.title}>{mode==="enroll"?"تسجيل بصمة الوجه":"التحقق من الهوية"}</h2>
        <p style={M.sub}>{message}</p>

        <div style={{
          position:"relative",width:"100%",aspectRatio:"3/4",maxHeight:340,
          background:"#0f172a",borderRadius:20,overflow:"hidden",marginBottom:18,
          border:`3px solid ${status==="success"?"#22c55e":status==="fail"||status==="error"?"#ef4444":"#6366f1"}`,
        }}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}}/>
          {status==="loading"&&(
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,0.85)"}}>
              <span style={{fontSize:36}}>⏳</span>
            </div>
          )}
          {status==="scanning"&&(
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(99,102,241,0.25)"}}>
              <span style={{fontSize:36}}>🔍</span>
            </div>
          )}
          {status==="success"&&(
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(34,197,94,0.25)"}}>
              <span style={{fontSize:48}}>✅</span>
            </div>
          )}
          {status==="error"&&(
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,0.9)"}}>
              <span style={{fontSize:36}}>🚫</span>
            </div>
          )}
        </div>

        {attempts>=3&&mode==="verify"&&(
          <p style={{textAlign:"center",fontSize:12,color:"#f59e0b",marginBottom:12}}>
            ⚠️ عدة محاولات فاشلة — تأكد أنك نفس الشخص المسجَّل أو راجع المدير
          </p>
        )}

        <div style={M.btnRow}>
          <button style={M.cancelBtn} onClick={cancel}>إلغاء</button>
          <button
            style={{...M.confirmBtn,background:"linear-gradient(135deg,#6366f1,#4338ca)",boxShadow:"0 4px 14px rgba(99,102,241,0.35)",opacity:(status==="ready"||status==="fail")?1:0.6}}
            onClick={capture}
            disabled={status!=="ready"&&status!=="fail"}>
            {status==="scanning"?"جارٍ التحليل...":mode==="enroll"?"تسجيل الوجه":"تحقق الآن"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExcuseModal({employee,onClose}){
  const [type,setType]=useState("excuse"); // excuse | leave
  const [excuseDate,setExcuseDate]=useState(()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; });
  const [excuseHour,setExcuseHour]=useState(8);
  const excuseKind = excuseHour<12 ? "late" : "early"; // تُحدَّد تلقائياً حسب الساعة، لا تحتاج اختياراً يدوياً
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
                <label style={{color:"#475569",fontSize:13,fontWeight:600}}>نوع الزمنية (يُحدَّد تلقائياً حسب الساعة)</label>
                <div style={{margin:"6px 0 14px",padding:"10px 14px",borderRadius:10,fontSize:13,fontWeight:700,textAlign:"center",
                  background:excuseKind==="late"?"#ede9fe":"#fef3c7",
                  color:excuseKind==="late"?"#4f46e5":"#92400e"}}>
                  {excuseKind==="late"?"تأخير دخول":"خروج مبكر"}
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
      const emp = employees.find(e =>
        String(e.id).trim().toLowerCase() === id.toLowerCase() &&
        String(e.pin).trim() === pin.trim()
      );
      if(emp){
        onLogin(emp.isAdmin ? {...emp, isAdmin:true} : {...emp, isAdmin:false});
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
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  لوحة المدير
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  شريط بحث وفلترة قابل لإعادة الاستخدام (طلبات / خصومات / رواتب / موظفون)
// ══════════════════════════════════════════════════════════════
function FilterBar({search,onSearch,placeholder,filter,onFilter,dateFrom,onDateFrom,dateTo,onDateTo,showPeriod=true}){
  return(
    <div style={{padding:"0 16px 12px"}}>
      {showPeriod&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {[["today","اليوم"],["week","الأسبوع"],["all","الكل"],["range","من/إلى"]].map(([k,l])=>(
            <button key={k} onClick={()=>onFilter(k)}
              style={{flex:1,padding:"8px 4px",borderRadius:10,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:50,
                background:filter===k?"#6366f1":"#f1f5f9",color:filter===k?"#fff":"#64748b"}}>
              {l}
            </button>
          ))}
        </div>
      )}
      {showPeriod&&filter==="range"&&(
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
          <div style={{flex:1}}>
            <p style={{margin:"0 0 4px",fontSize:11,color:"#64748b",fontWeight:600}}>من</p>
            <input type="date" value={dateFrom} onChange={e=>onDateFrom(e.target.value)}
              style={{width:"100%",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",color:"#0f172a",boxSizing:"border-box"}}/>
          </div>
          <div style={{flex:1}}>
            <p style={{margin:"0 0 4px",fontSize:11,color:"#64748b",fontWeight:600}}>إلى</p>
            <input type="date" value={dateTo} onChange={e=>onDateTo(e.target.value)}
              style={{width:"100%",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",color:"#0f172a",boxSizing:"border-box"}}/>
          </div>
        </div>
      )}
      <input style={S.searchInput} placeholder={placeholder||"🔍  ابحث بالاسم أو الرقم الوظيفي..."}
        value={search} onChange={e=>onSearch(e.target.value)}/>
    </div>
  );
}

function AdminPanel({employee,onLogout}){
  const [filter,setFilter]=useState("today");
  const [search,setSearch]=useState("");
  const [tab,setTab]=useState("records");
  const [deduction,setDeduction]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("lateDeduction")||JSON.stringify(RULES.lateDeduction));}catch{return RULES.lateDeduction;}
  });
  const [deductionInput,setDeductionInput]=useState(String(deduction));
  const today=new Date();
  const todayISO=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [dateFrom,setDateFrom]=useState(todayISO);
  const [dateTo,setDateTo]=useState(todayISO);
  const [selectedEmp,setSelectedEmp]=useState(null);
  const [allRecords,setAllRecords]=useState([]);
  const [allRequests,setAllRequests]=useState([]);
  const [employees,setEmployees]=useState([]);
  const [dataLoading,setDataLoading]=useState(true);
  const [salaryMonth,setSalaryMonth]=useState(monthKey());
  const [workDaysMap,setWorkDaysMap]=useState({}); // monthKey -> عدد أيام العمل بذلك الشهر
  const [newWorkMonth,setNewWorkMonth]=useState(monthKey());
  const [newWorkDays,setNewWorkDays]=useState("");
  const [showFaceEnroll,setShowFaceEnroll]=useState(false);
  const [showFaceResetCode,setShowFaceResetCode]=useState(false);
  const [hasFace,setHasFace]=useState(!!employee.faceDescriptor);
  const [attendanceLocked,setAttendanceLocked]=useState(false);
  const [lockLoading,setLockLoading]=useState(false);

  // فلاتر مستقلة لكل تبويب (بحث + فترة زمنية)
  const [reqSearch,setReqSearch]=useState("");
  const [reqFilter,setReqFilter]=useState("all");
  const [reqDateFrom,setReqDateFrom]=useState(todayISO);
  const [reqDateTo,setReqDateTo]=useState(todayISO);

  const [dedSearch,setDedSearch]=useState("");
  const [dedFilter,setDedFilter]=useState("all");
  const [dedDateFrom,setDedDateFrom]=useState(todayISO);
  const [dedDateTo,setDedDateTo]=useState(todayISO);

  const [salSearch,setSalSearch]=useState("");
  const [empSearch,setEmpSearch]=useState("");

  // دالة مساعدة: تاريخ الطلب الفعلي (وقت الزمنية/يوم الإجازة، أو تاريخ الإرسال كاحتياط)
  function requestDateIso(req){
    return (req.type==="excuse"&&req.excuseStart) ? req.excuseStart
         : (req.type==="leave"&&req.leaveDate) ? req.leaveDate
         : req.date;
  }
  // فلترة عامة بحسب الفترة الزمنية (اليوم/الأسبوع/الكل/من-إلى) لأي قائمة فيها تاريخ ISO
  function withinPeriod(iso, filterKey, fromStr, toStr){
    if(!iso) return filterKey==="all";
    const d=new Date(iso);
    if(filterKey==="today") return d.toDateString()===todayStr;
    if(filterKey==="week"){ const w=new Date(); w.setDate(w.getDate()-7); return d>=w; }
    if(filterKey==="range"){
      const from=new Date(fromStr+"T00:00:00");
      const to=new Date(toStr+"T23:59:59");
      return d>=from && d<=to;
    }
    return true; // "all"
  }

  async function loadAllData(){
    setDataLoading(true);
    const [recs,excs,emps,wd,locked]=await Promise.all([gsGetAttendance(),gsGetExcusesAll(),gsGetEmployees(),gsGetWorkDays(),gsGetAttendanceLock()]);
    setAllRecords(recs.map(r=>({
      ...r,
      checkOut:r.checkOut||null,
      deduction:Number(r.deduction)||0,
      emp:{id:r.empId,name:r.name,department:r.dept,position:r.position}
    })));
    setAllRequests(excs.map((ex,i)=>({
      ...ex,
      id:ex.date+"_"+ex.empId+"_"+i,
      emp:{id:ex.empId,name:ex.name,department:"",position:""}
    })));
    setEmployees(emps);
    const wdMap={};
    wd.forEach(w=>{ wdMap[w.monthKey]=w.workDays; });
    setWorkDaysMap(wdMap);
    setAttendanceLocked(locked);
    setDataLoading(false);
  }

  useEffect(()=>{ loadAllData(); },[]);

  function saveDeduction(val){
    const n=Number(val);
    if(!isNaN(n)&&n>=0){ setDeduction(n); localStorage.setItem("lateDeduction",JSON.stringify(n)); }
  }

  function saveWorkDaysHandler(monthKeyStr,daysVal){
    const n=Number(daysVal);
    if(isNaN(n)||n<0) return;
    setWorkDaysMap(prev=>({...prev,[monthKeyStr]:n}));
    gsSaveWorkDays(monthKeyStr,n);
  }

  async function toggleAttendanceLock(){
    setLockLoading(true);
    const newState=!attendanceLocked;
    await gsSetAttendanceLock(newState);
    setAttendanceLocked(newState);
    setLockLoading(false);
  }

  const todayStr=new Date().toDateString();
  const filtered=allRecords.filter(r=>{
    if(!r.checkIn) return false;
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

  const todayPresent=new Set(allRecords.filter(r=>r.checkIn&&new Date(r.checkIn).toDateString()===todayStr).map(r=>r.emp.id)).size;
  const checkedInNow=allRecords.filter(r=>r.checkIn&&new Date(r.checkIn).toDateString()===todayStr&&!r.checkOut).length;
  const lateToday=allRecords.filter(r=>r.checkIn&&new Date(r.checkIn).toDateString()===todayStr&&r.status==="late").length;
  const totalDeductions=allRecords.reduce((a,r)=>a+(r.deduction||0),0);
  const pendingReqs=allRequests.filter(r=>r.status==="pending");

  async function approveRequest(empId,id,approve){
    const req=allRequests.find(e=>e.id===id);
    if(req){
      await gsUpdateExcuseStatus(empId, req.date, approve?"approved":"rejected");
      setAllRequests(prev=>prev.map(e=>e.id===id?{...e,status:approve?"approved":"rejected",decisionDate:new Date().toISOString()}:e));

      // عند الموافقة على زمنية/إجازة، نلغي فقط الجزء المغطّى من الخصم (تأخير الدخول أو الخروج المبكر) لنفس اليوم
      if(approve){
        let coveredDayKey=null;
        // "excuse" بنوعيها: excuseKind="late" تغطي تأخير الدخول، excuseKind="early" تغطي الخروج المبكر | "leave" = إجازة يوم كامل
        if(req.type==="excuse" && req.excuseStart) coveredDayKey=dateKey(req.excuseStart);
        else if(req.type==="leave" && req.leaveDate) coveredDayKey=dateKey(req.leaveDate);

        if(coveredDayKey){
          const matchingRecord=allRecords.find(r=>
            r.emp.id===empId && r.checkIn && dateKey(r.checkIn)===coveredDayKey && (r.deduction||0)>0
          );
          if(matchingRecord){
            const wasLate = matchingRecord.status==="late";
            const isEarlyLeaveRecord = matchingRecord.checkOut
              ? (()=>{ const co=new Date(matchingRecord.checkOut); const m=co.getHours()*60+co.getMinutes();
                  return m>=toMin(RULES.earlyLeave.from.h,RULES.earlyLeave.from.m) && m<=toMin(RULES.earlyLeave.to.h,RULES.earlyLeave.to.m); })()
              : false;

            // نطرح فقط حصة النوع المعتمد (تأخير دخول أو خروج مبكر) من الخصم الحالي، دون إعادة بناء الإجمالي من الصفر
            // (لو عندنا موافقتان منفصلتان بنفس اليوم، كل واحدة تطرح حصتها فقط بدل استرجاع الحصة الملغاة سابقاً)
            let shareToRemove=0;
            if(req.type==="excuse" && req.excuseKind==="early" && isEarlyLeaveRecord) shareToRemove=RULES.lateDeduction;
            else if(req.type==="excuse" && req.excuseKind!=="early" && wasLate) shareToRemove=RULES.lateDeduction;
            else if(req.type==="leave"){
              // الإجازة (يوم كامل) تغطي أي خصم موجود بذلك اليوم (تأخير و/أو خروج مبكر)
              shareToRemove=(wasLate?RULES.lateDeduction:0)+(isEarlyLeaveRecord?RULES.lateDeduction:0);
            }

            const newDeduction=Math.max(0,(matchingRecord.deduction||0)-shareToRemove);

            if(shareToRemove>0 && newDeduction!==(matchingRecord.deduction||0)){
              const clearedRecord={...matchingRecord, deduction:newDeduction||undefined};
              setAllRecords(prev=>prev.map(r=>r===matchingRecord?clearedRecord:r));
              gsSaveAttendance(matchingRecord.emp, clearedRecord);
            }
          }
        }
      }
    }
  }

  if(dataLoading) return(
    <div style={{...S.appWrap,justifyContent:"center",alignItems:"center",display:"flex",flexDirection:"column",gap:16}}>
      <p style={{color:"#64748b",fontSize:14,fontWeight:600}}>⏳ جارٍ تحميل البيانات...</p>
    </div>
  );

  return(
    <div style={S.appWrap}>
      <div style={{...S.header,background:"linear-gradient(135deg,#1e1b4b,#4c1d95)"}}>
        <button style={S.logoutBtn} onClick={onLogout}>خروج</button>
        <span style={S.headerTitle}>🛡️ لوحة المدير</span>
        <div style={{display:"flex",gap:6}}>
          <button onClick={toggleAttendanceLock} disabled={lockLoading} title={attendanceLocked?"إلغاء قفل الحضور والانصراف":"قفل الحضور والانصراف (للعطل الرسمية)"}
            style={{background:attendanceLocked?"#fca5a5":"rgba(255,255,255,0.15)",border:"none",borderRadius:10,color:attendanceLocked?"#7f1d1d":"#fff",fontSize:14,fontWeight:700,padding:"6px 10px",cursor:lockLoading?"wait":"pointer",opacity:lockLoading?0.6:1}}>
            {attendanceLocked?"🔒":"🔓"}
          </button>
          <button onClick={()=>hasFace?setShowFaceResetCode(true):setShowFaceEnroll(true)} title="تسجيل/تحديث بصمة الوجه"
            style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,padding:"6px 10px",cursor:"pointer"}}>
            {hasFace?"🟢":"📷"}
          </button>
          <button onClick={loadAllData} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,padding:"6px 12px",cursor:"pointer"}}>🔄</button>
        </div>
      </div>
      {attendanceLocked&&(
        <div style={{background:"#fee2e2",borderBottom:"1px solid #fca5a5",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <p style={{margin:0,fontSize:12,color:"#991b1b",fontWeight:700}}>🔒 تسجيل الحضور والانصراف مقفل حالياً لجميع الموظفين (عطلة رسمية)</p>
          <button onClick={toggleAttendanceLock} disabled={lockLoading} style={{background:"#fff",border:"1px solid #fca5a5",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:700,color:"#991b1b",cursor:"pointer"}}>إلغاء القفل</button>
        </div>
      )}
      {!hasFace&&(
        <div style={{background:"#fef9c3",borderBottom:"1px solid #fde047",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <p style={{margin:0,fontSize:12,color:"#854d0e",fontWeight:600}}>📷 سجّل بصمة وجهك لتفعيل التحقق الأمني</p>
          <button onClick={()=>setShowFaceEnroll(true)} style={{background:"#facc15",border:"none",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:700,color:"#713f12",cursor:"pointer"}}>تسجيل الآن</button>
        </div>
      )}
      {showFaceResetCode&&(
        <FaceResetCodeModal
          correctCode={employee.faceResetCode}
          onSuccess={()=>{ setShowFaceResetCode(false); setShowFaceEnroll(true); }}
          onCancel={()=>setShowFaceResetCode(false)}
        />
      )}
      {showFaceEnroll&&(
        <FaceCaptureModal
          mode="enroll"
          onDone={(descriptor,photo)=>{
            const json=JSON.stringify(descriptor);
            const updated={...employee, faceDescriptor:json, facePhoto:photo||employee.facePhoto};
            Object.assign(employee, updated);
            try{ localStorage.setItem("currentUser",JSON.stringify(updated)); }catch{}
            gsSaveFaceDescriptor(employee.id, json, photo);
            setHasFace(true);
            setShowFaceEnroll(false);
          }}
          onCancel={()=>setShowFaceEnroll(false)}
        />
      )}

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #e2e8f0",background:"#fff",flexShrink:0,overflowX:"auto"}}>
        {[["records","السجلات"],["requests","الطلبات"+(pendingReqs.length?` (${pendingReqs.length})`:"")],["deductions","الخصومات"],["salaries","الرواتب"],["workdays","أيام العمل"],["employees","الموظفون"]].map(([k,l])=>(
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
              <p style={S.statNum}>{employees.length}</p><p style={S.statLabel}>إجمالي</p>
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
                        {(()=>{ const fullEmp=employees.find(e=>e.id===r.emp.id); return fullEmp&&fullEmp.facePhoto ? (
                          <img src={fullEmp.facePhoto} alt={r.emp.name} style={{width:38,height:38,borderRadius:"50%",objectFit:"cover"}}/>
                        ) : (
                          <div style={{...S.avatar,width:38,height:38,fontSize:14}}>
                            {r.emp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                          </div>
                        ); })()}
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
        {tab==="requests"&&(()=>{
          const filteredRequests=allRequests
            .filter(req=>withinPeriod(requestDateIso(req),reqFilter,reqDateFrom,reqDateTo))
            .filter(req=>req.emp.name.includes(reqSearch)||req.emp.id.includes(reqSearch));
          return(
          <div style={{padding:"16px 0 90px"}}>
            <h2 style={{...S.sectionTitle,paddingTop:0,padding:"0 16px"}}>طلبات الزمنيات والإجازات</h2>
            <FilterBar
              search={reqSearch} onSearch={setReqSearch}
              filter={reqFilter} onFilter={setReqFilter}
              dateFrom={reqDateFrom} onDateFrom={setReqDateFrom}
              dateTo={reqDateTo} onDateTo={setReqDateTo}
            />
            <div style={{padding:"0 16px"}}>
            {filteredRequests.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📭</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد طلبات</p></div>
              :filteredRequests.sort((a,b)=>b.id-a.id).map(req=>{
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
          </div>
          );
        })()}

        {/* ── الخصومات ── */}
        {tab==="deductions"&&(()=>{
          const filteredDeductions=allRecords.filter(r=>r.deduction)
            .filter(r=>withinPeriod(r.checkIn,dedFilter,dedDateFrom,dedDateTo))
            .filter(r=>r.emp.name.includes(dedSearch)||r.emp.id.includes(dedSearch));
          return(
          <>
          <div style={{padding:"16px 16px 0"}}>
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
          </div>
          <FilterBar
            search={dedSearch} onSearch={setDedSearch}
            filter={dedFilter} onFilter={setDedFilter}
            dateFrom={dedDateFrom} onDateFrom={setDedDateFrom}
            dateTo={dedDateTo} onDateTo={setDedDateTo}
          />
          <div style={{padding:"0 16px 90px"}}>
            {filteredDeductions.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>💸</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد خصومات</p></div>
              :filteredDeductions.map((r,i)=>(
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
          </>
          );
        })()}

        {/* ── الرواتب ── */}
        {tab==="salaries"&&(()=>{
          const [y,m]=salaryMonth.split("-").map(Number);
          const monthLabel=new Date(y,m,1).toLocaleDateString("ar-SA",{year:"numeric",month:"long"});
          const workDaysForMonth=Number(workDaysMap[salaryMonth])||0;

          // كل أيام الشهر المحدد التي سجّل فيها أي موظف حضوراً فعلياً (يوم عمل حقيقي، يستثني العطل تلقائياً)
          const monthRecords=allRecords.filter(r=>r.checkIn && monthKey(r.checkIn)===salaryMonth);
          const workingDaysSet=new Set(monthRecords.map(r=>dateKey(r.checkIn)));

          const rows=employees.map(emp=>{
            const empRecordsThisMonth=monthRecords.filter(r=>r.emp.id===emp.id);
            const empDed=empRecordsThisMonth.reduce((a,r)=>a+(r.deduction||0),0);
            const empWorkedDays=new Set(empRecordsThisMonth.map(r=>dateKey(r.checkIn)));

            // أيام الغياب = أيام العمل الفعلية (سجّل فيها أحد) التي لم يحضر بها هذا الموظف
            const absentDays=[...workingDaysSet].filter(day=>!empWorkedDays.has(day)).length;
            const base=Number(emp.salary)||0;
            const dailyRateForEmp=workDaysForMonth>0 ? base/workDaysForMonth : 0;
            const absenceDeduction=Math.round(absentDays*dailyRateForEmp);

            return {emp, base, deduction:empDed, absentDays, absenceDeduction, net:base-empDed-absenceDeduction};
          });
          const totalBase=rows.reduce((a,r)=>a+r.base,0);
          const totalDed=rows.reduce((a,r)=>a+r.deduction+r.absenceDeduction,0);
          const totalNet=rows.reduce((a,r)=>a+r.net,0);
          const filteredRows=rows.filter(({emp})=>emp.name.includes(salSearch)||emp.id.includes(salSearch));
          function shiftMonth(delta){
            const d=new Date(y,m+delta,1);
            setSalaryMonth(`${d.getFullYear()}-${d.getMonth()}`);
          }
          return(
            <div style={{padding:"16px 16px 90px"}}>
              <h2 style={{...S.sectionTitle,paddingTop:0}}>الرواتب</h2>
              {workDaysForMonth===0&&(
                <div style={{background:"#fef9c3",border:"1px solid #fde047",borderRadius:12,padding:"10px 14px",marginBottom:14}}>
                  <p style={{margin:0,fontSize:12,color:"#854d0e",fontWeight:600}}>
                    ⚠️ لم يُحدَّد عدد أيام العمل لهذا الشهر بعد — اذهب لتبويب "أيام العمل" لتفعيل حساب خصم الغياب
                  </p>
                </div>
              )}

              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",padding:"10px 14px",marginBottom:16}}>
                <button onClick={()=>shiftMonth(-1)} style={{background:"#f1f5f9",border:"none",borderRadius:10,width:34,height:34,fontSize:16,fontWeight:700,cursor:"pointer",color:"#475569"}}>›</button>
                <p style={{margin:0,fontSize:15,fontWeight:800,color:"#0f172a"}}>{monthLabel}</p>
                <button onClick={()=>shiftMonth(1)} style={{background:"#f1f5f9",border:"none",borderRadius:10,width:34,height:34,fontSize:16,fontWeight:700,cursor:"pointer",color:"#475569"}}>‹</button>
              </div>

              <div style={{...S.statsRow}}>
                <div style={{...S.statBox,borderTop:"3px solid #6366f1"}}>
                  <p style={{...S.statNum,fontSize:16}}>{totalBase.toLocaleString()}</p><p style={S.statLabel}>إجمالي الرواتب</p>
                </div>
                <div style={{...S.statBox,borderTop:"3px solid #ef4444"}}>
                  <p style={{...S.statNum,fontSize:16,color:"#ef4444"}}>{totalDed.toLocaleString()}</p><p style={S.statLabel}>الخصومات</p>
                </div>
                <div style={{...S.statBox,borderTop:"3px solid #22c55e"}}>
                  <p style={{...S.statNum,fontSize:16,color:"#22c55e"}}>{totalNet.toLocaleString()}</p><p style={S.statLabel}>الصافي</p>
                </div>
              </div>

              <h3 style={{fontSize:15,fontWeight:700,color:"#0f172a",margin:"20px 0 12px"}}>تفصيل كل موظف</h3>
              <div style={{marginBottom:12}}>
                <input style={S.searchInput} placeholder="🔍  ابحث بالاسم أو الرقم الوظيفي..."
                  value={salSearch} onChange={e=>setSalSearch(e.target.value)}/>
              </div>
              {filteredRows.length===0
                ?<div style={S.empty}><span style={{fontSize:48}}>💰</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد موظفون</p></div>
                :filteredRows.map(({emp,base,deduction,absentDays,absenceDeduction,net})=>(
                  <div key={emp.id} style={{...S.recordCard,borderRight:"4px solid #6366f1",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div>
                        <p style={{margin:0,fontWeight:700,fontSize:14}}>{emp.name}</p>
                        <p style={{margin:0,fontSize:11,color:"#64748b"}}>{emp.position} · {emp.id}</p>
                      </div>
                      <p style={{margin:0,fontSize:20,fontWeight:800,color:"#22c55e"}}>{net.toLocaleString()}</p>
                    </div>
                    <div style={{display:"flex",gap:14,fontSize:12,color:"#64748b",flexWrap:"wrap"}}>
                      <span>الأساسي: <b style={{color:"#0f172a"}}>{base.toLocaleString()}</b></span>
                      {deduction>0&&<span style={{color:"#dc2626"}}>خصم التأخير: <b>−{deduction.toLocaleString()}</b></span>}
                      {absentDays>0&&<span style={{color:"#dc2626"}}>غياب {absentDays} يوم: <b>−{absenceDeduction.toLocaleString()}</b></span>}
                    </div>
                  </div>
                ))
              }
              <p style={{fontSize:11,color:"#94a3b8",textAlign:"center",marginTop:16}}>
                💡 الراتب الأساسي يُحدَّث من شيت Employees (عمود الراتب)
              </p>
            </div>
          );
        })()}

        {/* ── أيام العمل ── */}
        {tab==="workdays"&&(()=>{
          const months=Object.keys(workDaysMap).sort().reverse();
          function monthKeyToInputValue(mk){
            const [y,m]=mk.split("-").map(Number);
            return `${y}-${String(m+1).padStart(2,"0")}`;
          }
          function inputValueToMonthKey(val){
            const [y,m]=val.split("-").map(Number);
            return `${y}-${m-1}`;
          }
          return(
            <div style={{padding:"16px 16px 90px"}}>
              <h2 style={{...S.sectionTitle,paddingTop:0}}>أيام العمل الشهرية</h2>
              <p style={{fontSize:12,color:"#64748b",margin:"-8px 0 16px"}}>
                حدّد عدد أيام العمل الفعلية لكل شهر (تستثني العطل الرسمية)؛ يُستخدم هذا الرقم لحساب الراتب اليومي وخصم الغياب لكل الموظفين بذلك الشهر.
              </p>

              <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #e2e8f0",marginBottom:20}}>
                <p style={{margin:"0 0 10px",fontSize:13,color:"#64748b",fontWeight:600}}>إضافة / تعديل شهر</p>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  <input type="month" value={monthKeyToInputValue(newWorkMonth)}
                    onChange={e=>setNewWorkMonth(inputValueToMonthKey(e.target.value))}
                    style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 12px",fontSize:13,outline:"none",color:"#0f172a"}}/>
                  <input type="number" placeholder="عدد الأيام" value={newWorkDays}
                    onChange={e=>setNewWorkDays(e.target.value)}
                    style={{width:110,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 12px",fontSize:13,outline:"none",color:"#0f172a"}}/>
                </div>
                <button onClick={()=>{ saveWorkDaysHandler(newWorkMonth,newWorkDays); setNewWorkDays(""); }}
                  disabled={!newWorkDays}
                  style={{width:"100%",background:"#6366f1",border:"none",borderRadius:10,padding:"10px 0",fontSize:13,fontWeight:700,color:"#fff",cursor:"pointer",opacity:newWorkDays?1:0.5}}>
                  حفظ
                </button>
              </div>

              <h3 style={{fontSize:15,fontWeight:700,color:"#0f172a",margin:"0 0 12px"}}>الأشهر المسجَّلة</h3>
              {months.length===0
                ?<div style={S.empty}><span style={{fontSize:48}}>📅</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد أشهر مسجَّلة بعد</p></div>
                :months.map(mk=>{
                  const [y,m]=mk.split("-").map(Number);
                  const label=new Date(y,m,1).toLocaleDateString("ar-SA",{year:"numeric",month:"long"});
                  return(
                    <div key={mk} style={{...S.recordCard,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <p style={{margin:0,fontWeight:700,fontSize:14}}>{label}</p>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <input type="number" value={workDaysMap[mk]}
                          onChange={e=>saveWorkDaysHandler(mk,e.target.value)}
                          style={{width:70,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 8px",fontSize:13,textAlign:"center",outline:"none",color:"#0f172a"}}/>
                        <span style={{fontSize:12,color:"#64748b"}}>يوم</span>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          );
        })()}

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
                  {selectedEmp.facePhoto?(
                    <img src={selectedEmp.facePhoto} alt={selectedEmp.name} style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",margin:"0 auto 14px",border:"3px solid rgba(255,255,255,0.3)",display:"block"}}/>
                  ):(
                    <div style={{...S.avatar,width:72,height:72,fontSize:26,margin:"0 auto 14px",background:"rgba(255,255,255,0.15)"}}>
                      {selectedEmp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                    </div>
                  )}
                  <p style={{color:"#fff",fontWeight:800,fontSize:18,margin:"0 0 4px"}}>{selectedEmp.name}</p>
                  <p style={{color:"#a5b4fc",fontSize:13,margin:0}}>{selectedEmp.position}</p>
                </div>
                {[
                  {icon:"🪪",label:"الرقم الوظيفي",val:selectedEmp.id},
                  {icon:"🏢",label:"القسم",val:selectedEmp.department},
                  {icon:"💼",label:"المنصب",val:selectedEmp.position},
                  {icon:"📅",label:"أيام الحضور",val:`${allRecords.filter(r=>r.emp.id===selectedEmp.id&&r.checkOut).length} يوم مكتمل`},
                  {icon:"⏱",label:"إجمالي ساعات الدوام",val:`${allRecords.filter(r=>r.emp.id===selectedEmp.id).reduce((a,r)=>r.checkOut?a+((new Date(r.checkOut)-new Date(r.checkIn))/3600000):a,0).toFixed(1)} ساعة`},
                  {icon:"⚠️",label:"أيام التأخير",val:`${allRecords.filter(r=>r.emp.id===selectedEmp.id&&r.status==="late").length} يوم`},
                  {icon:"💸",label:"إجمالي الخصومات",val:`${allRecords.filter(r=>r.emp.id===selectedEmp.id).reduce((a,r)=>a+(r.deduction||0),0).toLocaleString()} دينار`},
                  {icon:"🟡",label:"زمنيات هذا الشهر",val:`${allRequests.filter(r=>r.empId===selectedEmp.id&&r.type==="excuse"&&r.monthKey===monthKey()).length} / ${MONTHLY_LIMITS.excuses}`},
                  {icon:"🌴",label:"إجازات هذا الشهر",val:`${allRequests.filter(r=>r.empId===selectedEmp.id&&r.type==="leave"&&r.monthKey===monthKey()).length} / ${MONTHLY_LIMITS.leaves}`},
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
                {allRecords.filter(r=>r.emp.id===selectedEmp.id).length===0
                  ?<div style={S.empty}><span style={{fontSize:40}}>📭</span><p style={{color:"#94a3b8",marginTop:8,fontSize:13}}>لا يوجد سجل بعد</p></div>
                  :allRecords.filter(r=>r.emp.id===selectedEmp.id).slice().reverse().map((r,i)=>{
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
              <>
                <div style={{marginBottom:12}}>
                  <input style={S.searchInput} placeholder="🔍  ابحث بالاسم أو الرقم الوظيفي..."
                    value={empSearch} onChange={e=>setEmpSearch(e.target.value)}/>
                </div>
                {employees.filter(emp=>emp.name.includes(empSearch)||emp.id.includes(empSearch)).map(emp=>{
                const empRecords=allRecords.filter(r=>r.emp.id===emp.id);
                const empDed=empRecords.reduce((a,r)=>a+(r.deduction||0),0);
                const empHours=empRecords.reduce((a,r)=>r.checkOut?a+((new Date(r.checkOut)-new Date(r.checkIn))/3600000):a,0);
                const isHereNow=empRecords.some(r=>new Date(r.checkIn).toDateString()===todayStr&&!r.checkOut);
                const todayRec=empRecords.find(r=>new Date(r.checkIn).toDateString()===todayStr);
                return(
                  <div key={emp.id} onClick={()=>setSelectedEmp(emp)}
                    style={{...S.recordCard,cursor:"pointer",marginBottom:10,borderRight:`4px solid ${isHereNow?"#22c55e":todayRec?"#6366f1":"#e2e8f0"}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      {emp.facePhoto?(
                        <img src={emp.facePhoto} alt={emp.name} style={{width:46,height:46,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
                      ):(
                        <div style={{...S.avatar,width:46,height:46,fontSize:16,flexShrink:0}}>
                          {emp.name.split(" ").slice(0,2).map(n=>n[0]).join("")}
                        </div>
                      )}
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
                }
              </>
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
  const serverOffsetRef=useRef(0); // الفرق بين وقت السيرفر ووقت الجهاز (مليثانية)
  const [offsetReady,setOffsetReady]=useState(false);

  useEffect(()=>{
    gsGetServerTime().then(serverIso=>{
      serverOffsetRef.current = new Date(serverIso).getTime() - Date.now();
      setOffsetReady(true);
    }).catch(()=>setOffsetReady(true)); // لو فشل الجلب، نكمل بفارق صفر (ساعة الجهاز) كحل احتياطي للعرض فقط
  },[]);

  // مصدر الحقيقة هو Google Sheets لا localStorage وحدها (localStorage قد تكون فارغة على جهاز/متصفح جديد
  // مما كان يسبب اعتقاد التطبيق بعدم وجود تسجيل لليوم والسماح بتسجيل حضور مكرر)، ونحدّثها دورياً
  // ليعكس فوراً أي تغيير (مثل إلغاء خصم بعد موافقة على زمنية)
  useEffect(()=>{
    function refreshMyRecords(){
      gsGetAttendance().then(all=>{
        const mine=all.filter(r=>String(r.empId).trim()===String(employee.id).trim()).map(r=>({
          id:new Date(r.checkIn).getTime(),
          checkIn:r.checkIn,
          checkOut:r.checkOut||null,
          status:r.status,
          deduction:Number(r.deduction)||0,
        }));
        if(mine.length>0){ setRecords(mine); saveEmpData(employee.id,mine); }
      }).catch(()=>{});
    }
    refreshMyRecords();
    const t=setInterval(refreshMyRecords,20000); // كل 20 ثانية
    return ()=>clearInterval(t);
  },[employee.id]);

  const [gpsState,setGpsState]=useState(null);
  const [gpsMsg,setGpsMsg]=useState("");
  const [showCheckout,setShowCheckout]=useState(false);
  const [showExcuse,setShowExcuse]=useState(false);
  const [activeTab,setActiveTab]=useState("home");
  const [historySubTab,setHistorySubTab]=useState("attendance"); // attendance | requests
  const [attFilter,setAttFilter]=useState("all"); // all | present | absent
  const [reqStatusFilter,setReqStatusFilter]=useState("all"); // all | pending | approved | rejected
  const [simulated,setSimulated]=useState(false);
  const [,forceUpdate]=useState(0);
  const [sheetExcuses,setSheetExcuses]=useState(null); // أحدث حالة الطلبات من Google Sheets
  const attendanceLock=useRef(false); // قفل يمنع تسجيل حضور/انصراف مكرر عند الضغط المتكرر السريع
  const [showFaceEnroll,setShowFaceEnroll]=useState(false);
  const [showFaceResetCode,setShowFaceResetCode]=useState(false);
  const [hasFace,setHasFace]=useState(!!employee.faceDescriptor);
  const [adminFaces,setAdminFaces]=useState([]); // بصمات وجوه المديرين (تُقبل بديلاً عن وجه الموظف)
  const [showFaceVerify,setShowFaceVerify]=useState(false); // تحقق الوجه قبل تسجيل الحضور/الانصراف
  const [globalAttendanceLocked,setGlobalAttendanceLocked]=useState(false); // قفل عام يضبطه المدير (أيام العطل)
  const [allCompanyRecords,setAllCompanyRecords]=useState([]); // سجلات كل الموظفين (لحساب أيام الغياب الفعلية لهذا الموظف)

  useEffect(()=>{
    gsGetEmployees().then(list=>{
      setAdminFaces(list.filter(e=>e.isAdmin&&e.faceDescriptor).map(e=>JSON.parse(e.faceDescriptor)));
    }).catch(()=>{});
  },[]);

  useEffect(()=>{
    function checkLock(){ gsGetAttendanceLock().then(setGlobalAttendanceLocked).catch(()=>{}); }
    checkLock();
    const t=setInterval(checkLock,15000); // تحديث تلقائي كل 15 ثانية
    return ()=>clearInterval(t);
  },[]);

  useEffect(()=>{
    gsGetAttendance().then(setAllCompanyRecords).catch(()=>{});
  },[]);

  // جلب أحدث حالة الطلبات (الموافقة/الرفض) من Google Sheets دائماً
  const refreshMyRequests=useCallback(()=>{
    gsGetExcusesAll().then(all=>{
      setSheetExcuses(all.filter(e=>String(e.empId).trim()===String(employee.id).trim()));
    }).catch(()=>{});
  },[employee.id]);
  useEffect(()=>{
    refreshMyRequests();
    const t=setInterval(refreshMyRequests,15000); // تحديث تلقائي كل 15 ثانية
    return ()=>clearInterval(t);
  },[refreshMyRequests]);

  // قراءة مبلغ الخصم الحالي
  function currentDeduction(){ try{ return JSON.parse(localStorage.getItem("lateDeduction")||JSON.stringify(RULES.lateDeduction)); }catch{ return RULES.lateDeduction; } }

  const todayKey=new Date(Date.now()+serverOffsetRef.current).toDateString();
  const todayRec=records.find(r=>new Date(r.checkIn).toDateString()===todayKey);
  const isCheckedIn=todayRec&&!todayRec.checkOut;

  const weekRecs=records.slice(-14).reverse();
  const totalHours=records.reduce((a,r)=>r.checkOut?a+(new Date(r.checkOut)-new Date(r.checkIn))/3600000:a,0);
  const totalDeductions=records.reduce((a,r)=>a+(r.deduction||0),0);
  const initials=employee.name.split(" ").slice(0,2).map(n=>n[0]).join("");

  // أيام الغياب الفعلية لهذا الموظف خلال آخر 30 يوماً (أيام عمل فعلية حضر فيها موظفون آخرون ولم يحضر بها هو)
  const absentDays=(()=>{
    const since=new Date(); since.setDate(since.getDate()-30);
    const companyDaysSet=new Set(
      allCompanyRecords.filter(r=>r.checkIn && new Date(r.checkIn)>=since).map(r=>dateKey(r.checkIn))
    );
    const myDaysSet=new Set(records.filter(r=>r.checkIn).map(r=>dateKey(r.checkIn)));
    return [...companyDaysSet].filter(day=>!myDaysSet.has(day) && new Date(day)<=new Date()).sort().reverse();
  })();

  // سجل موحَّد لعرضه بتبويب "سجل الحضور": أيام حضور فعلية + أيام غياب محسوبة، مع دعم الفلترة
  const combinedAttendance=[
    ...weekRecs.map(r=>({...r,_kind:"present"})),
    ...absentDays.map(day=>({_kind:"absent",_day:day,id:`absent_${day}`})),
  ].sort((a,b)=>{
    const da=a._kind==="present"?a.checkIn:a._day;
    const db=b._kind==="present"?b.checkIn:b._day;
    return new Date(db)-new Date(da);
  });
  const filteredAttendance=combinedAttendance.filter(r=>
    attFilter==="all" || (attFilter==="present"&&r._kind==="present") || (attFilter==="absent"&&r._kind==="absent")
  );

  const excLeft=MONTHLY_LIMITS.excuses-monthExcuses(employee.id);
  const leaveLeft=MONTHLY_LIMITS.leaves-monthLeaves(employee.id);
  const myRequests=(sheetExcuses!==null?sheetExcuses:getExcuses(employee.id)).sort((a,b)=>b.id-a.id);
  const filteredRequests=myRequests.filter(r=>reqStatusFilter==="all"||r.status===reqStatusFilter);

  function save(updated){ setRecords(updated); saveEmpData(employee.id,updated); }

  function startAttendance(){
    if(attendanceLock.current) return; // يمنع الضغط المتكرر السريع
    if(!offsetReady){
      setGpsState("error");
      setGpsMsg("جارٍ المزامنة مع السيرفر — أعد المحاولة خلال لحظات");
      return;
    }
    if(globalAttendanceLocked){
      setGpsState("error");
      setGpsMsg("تسجيل الحضور والانصراف مقفل اليوم من قبل المدير (عطلة رسمية)");
      return;
    }
    // التحقق من إمكانية التسجيل (نفس الوقت يُفحص هنا أيضاً تجنباً لفتح الكاميرا بلا فائدة)
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
    // إذا لا يوجد أي بصمة وجه مسجّلة (لا للموظف ولا لأي مدير)، نتجاوز التحقق لتجنّب تعطيل التسجيل
    if(!employee.faceDescriptor && adminFaces.length===0){
      handleAttendance();
      return;
    }
    setShowFaceVerify(true);
  }

  function handleAttendance(){
    if(attendanceLock.current) return; // يمنع الضغط المتكرر السريع
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
    attendanceLock.current=true;
    setGpsState("locating"); setGpsMsg("جارٍ تحديد موقعك..."); setSimulated(false);
    if(!navigator.geolocation){ doSimulate(); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const dist=getDistance(pos.coords.latitude,pos.coords.longitude,OFFICE.lat,OFFICE.lng);
        if(dist>OFFICE.radius){ setGpsState("far"); setGpsMsg(`أنت على بُعد ${Math.round(dist)} متر — يجب أن تكون ضمن ${OFFICE.radius} متر`); attendanceLock.current=false; }
        else afterGPS();
      },
      err=>{ if(err.code===1){setGpsState("denied");setGpsMsg("يرجى السماح بالوصول للموقع");}else doSimulate(); attendanceLock.current=false; },
      {enableHighAccuracy:true,timeout:12000}
    );
  }

  function doSimulate(){ setSimulated(true); afterGPS(); }

  function afterGPS(){
    if(isCheckedIn){ setShowCheckout(true); setGpsState(null); attendanceLock.current=false; }
    else doCheckIn();
  }

  async function doCheckIn(){
    if(todayRec){ setGpsState("error"); setGpsMsg("تم تسجيل حضورك وانصرافك اليوم مسبقاً"); attendanceLock.current=false; return; }
    let now;
    try {
      now = await gsGetServerTime();
    } catch(e) {
      setGpsState("error");
      setGpsMsg(e.message || "تعذّر الاتصال بالسيرفر. تحقق من الإنترنت وحاول مجدداً.");
      attendanceLock.current=false;
      return;
    }
    const status=checkInStatus(now);
    // ← منع التسجيل خارج وقت الدوام نهائياً
    if(status==="invalid"){
      setGpsState("error");
      setGpsMsg("خارج وقت الدوام المسموح — لا يمكن تسجيل الحضور");
      attendanceLock.current=false;
      return;
    }
    const covered = status==="late" ? findCoveringExcuse(employee.id, now) : null;
    const ded=(status==="late" && !covered)?currentDeduction():0;
    const newRecord={id:Date.now(),checkIn:now,checkOut:null,status,deduction:ded||undefined,excused:!!covered};
    save([...records,newRecord]);
    gsSaveAttendance(employee, newRecord);
    setGpsState("ok");
    attendanceLock.current=false;
    if(status==="late"&&covered) setGpsMsg("تم تسجيل الحضور — تأخير مغطّى بزمنية معتمدة ✓ بدون خصم");
    else if(status==="late") setGpsMsg(`تم تسجيل الحضور — ⚠️ تأخير — سيُطرح ${ded.toLocaleString()} دينار`);
    else setGpsMsg("تم تسجيل الحضور بنجاح ✓ في الوقت المحدد");
  }

  async function confirmCheckout(){
    if(attendanceLock.current) return; // يمنع الضغط المتكرر السريع
    attendanceLock.current=true;
    const now=await gsGetServerTime(); // وقت حقيقي من السيرفر، لا يعتمد على ساعة الجهاز
    const nowD=new Date(now);
    const m = nowD.getHours()*60+nowD.getMinutes();
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
    attendanceLock.current=false;
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
  },[isCheckedIn, employee.id]);

  return(
    <div style={S.appWrap}>
      {showCheckout&&todayRec&&(
        <CheckoutModal employee={employee} checkInTime={todayRec.checkIn}
          onConfirm={confirmCheckout} onCancel={()=>{setShowCheckout(false);setGpsState(null);}}/>
      )}
      {showExcuse&&(
        <ExcuseModal employee={employee} onClose={()=>{setShowExcuse(false);forceUpdate(n=>n+1);refreshMyRequests();}}/>
      )}
      {showFaceVerify&&(
        <FaceCaptureModal
          mode="verify"
          acceptedDescriptors={[
            ...(employee.faceDescriptor?[JSON.parse(employee.faceDescriptor)]:[]),
            ...adminFaces,
          ]}
          onDone={()=>{ setShowFaceVerify(false); handleAttendance(); }}
          onCancel={()=>setShowFaceVerify(false)}
        />
      )}
      {showFaceResetCode&&(
        <FaceResetCodeModal
          correctCode={employee.faceResetCode}
          onSuccess={()=>{ setShowFaceResetCode(false); setShowFaceEnroll(true); }}
          onCancel={()=>setShowFaceResetCode(false)}
        />
      )}
      {showFaceEnroll&&(
        <FaceCaptureModal
          mode="enroll"
          onDone={(descriptor,photo)=>{
            const json=JSON.stringify(descriptor);
            const updated={...employee, faceDescriptor:json, facePhoto:photo||employee.facePhoto};
            Object.assign(employee, updated); // تحديث فوري للنسخة الحالية بالجلسة
            try{ localStorage.setItem("currentUser",JSON.stringify(updated)); }catch{}
            gsSaveFaceDescriptor(employee.id, json, photo);
            setHasFace(true);
            setShowFaceEnroll(false);
          }}
          onCancel={()=>setShowFaceEnroll(false)}
        />
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

          {/* تنبيه القفل العام */}
          {globalAttendanceLocked&&(
            <div style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:14,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>🔒</span>
              <p style={{margin:0,fontSize:13,color:"#991b1b",fontWeight:700}}>تسجيل الحضور والانصراف مقفل اليوم من قبل المدير (عطلة رسمية)</p>
            </div>
          )}

          {/* الزر الكبير */}
          <button
            style={{...S.bigBtn,background:globalAttendanceLocked
              ?"linear-gradient(135deg,#94a3b8,#64748b)"
              :isCheckedIn
              ?"linear-gradient(135deg,#ef4444,#b91c1c)"
              :"linear-gradient(135deg,#22c55e,#15803d)",
              cursor:globalAttendanceLocked?"not-allowed":"pointer",opacity:globalAttendanceLocked?0.85:1}}
            onClick={startAttendance} disabled={globalAttendanceLocked}>
            <span style={{fontSize:48}}>{globalAttendanceLocked?"🔒":isCheckedIn?"👋":"👆"}</span>
            <span style={S.bigBtnLabel}>{globalAttendanceLocked?"مقفل اليوم":isCheckedIn?"تسجيل الانصراف":"تسجيل الحضور"}</span>
            <span style={S.bigBtnSub}>
              {globalAttendanceLocked?"يوم عطلة رسمية":gpsState==="locating"?"⏳ جارٍ تحديد الموقع...":"اضغط — سيتحقق من موقعك وتوقيتك"}
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
                <button key={k} onClick={()=>{setHistorySubTab(k);if(k==="requests")refreshMyRequests();}}
                  style={{flex:1,padding:"9px 6px",borderRadius:10,border:"2px solid",cursor:"pointer",fontSize:13,fontWeight:700,
                    borderColor:historySubTab===k?"#6366f1":"#e2e8f0",
                    background:historySubTab===k?"#ede9fe":"#f8fafc",
                    color:historySubTab===k?"#4f46e5":"#64748b"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* فلترة فرعية حسب التبويب النشط */}
            <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
              {historySubTab==="attendance"
                ? [["all","الكل"],["present","حضور"],["absent","غياب"]].map(([k,label])=>(
                  <button key={k} onClick={()=>setAttFilter(k)}
                    style={{flex:1,padding:"7px 4px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,minWidth:60,
                      background:attFilter===k?"#6366f1":"#f1f5f9",color:attFilter===k?"#fff":"#64748b"}}>
                    {label}
                  </button>
                ))
                : [["all","الكل"],["pending","قيد المراجعة"],["approved","موافَق"],["rejected","مرفوض"]].map(([k,label])=>(
                  <button key={k} onClick={()=>setReqStatusFilter(k)}
                    style={{flex:1,padding:"7px 4px",borderRadius:9,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,minWidth:60,
                      background:reqStatusFilter===k?"#6366f1":"#f1f5f9",color:reqStatusFilter===k?"#fff":"#64748b"}}>
                    {label}
                  </button>
                ))
              }
            </div>

            {historySubTab==="attendance"&&(
              filteredAttendance.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📋</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد سجل بعد</p></div>
              :filteredAttendance.map(r=>{
                if(r._kind==="absent"){
                  return(
                    <div key={r.id} style={{...S.recordCard,borderRight:"4px solid #ef4444"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div>
                          <p style={{margin:0,fontSize:13,fontWeight:700,color:"#334155"}}>{dayName(r._day)}</p>
                          <p style={{margin:"1px 0 0",fontSize:11,color:"#94a3b8"}}>{fmtDateShort(r._day)}</p>
                        </div>
                        <span style={{...S.badge,background:"#fee2e2",color:"#991b1b"}}>غائب</span>
                      </div>
                    </div>
                  );
                }
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
              filteredRequests.length===0
              ?<div style={S.empty}><span style={{fontSize:48}}>📭</span><p style={{color:"#94a3b8",marginTop:12}}>لا يوجد طلبات</p></div>
              :filteredRequests.map(req=>{
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
            <div style={{background:hasFace?"linear-gradient(135deg,#dcfce7,#bbf7d0)":"linear-gradient(135deg,#fef9c3,#fef08a)",borderRadius:14,padding:16,marginTop:12,border:`1px solid ${hasFace?"#86efac":"#fde047"}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:hasFace?0:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  {employee.facePhoto&&(
                    <img src={employee.facePhoto} alt="صورة الوجه المسجَّلة" style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",border:"2px solid #fff",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}/>
                  )}
                  <div>
                    <p style={{margin:"0 0 2px",fontWeight:700,color:hasFace?"#166534":"#854d0e",fontSize:14}}>
                      {hasFace?"✅ بصمة الوجه مسجَّلة":"📷 بصمة الوجه غير مسجَّلة"}
                    </p>
                    <p style={{margin:0,fontSize:11,color:hasFace?"#15803d":"#92400e"}}>
                      {hasFace?"تُستخدم للتحقق من هويتك عند تسجيل الحضور والانصراف":"سجّلها الآن لتفعيل التحقق عند تسجيل الحضور والانصراف"}
                    </p>
                  </div>
                </div>
              </div>
              <button onClick={()=>hasFace?setShowFaceResetCode(true):setShowFaceEnroll(true)}
                style={{width:"100%",marginTop:10,background:hasFace?"#fff":"#facc15",border:hasFace?"1px solid #86efac":"none",borderRadius:10,padding:"10px 0",fontSize:13,fontWeight:700,color:hasFace?"#166534":"#713f12",cursor:"pointer"}}>
                {hasFace?"إعادة تسجيل الوجه":"تسجيل الوجه الآن"}
              </button>
            </div>
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
  const [user,setUser]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem("currentUser")||"null"); }catch{ return null; }
  });
  const [adminVerified,setAdminVerified]=useState(false); // يُطلب من جديد بكل تحميل/تحديث للصفحة، وليس مخزَّناً بشكل دائم

  function handleLogin(u){
    try{ localStorage.setItem("currentUser",JSON.stringify(u)); }catch{}
    setUser(u);
  }
  function handleLogout(){
    try{ localStorage.removeItem("currentUser"); }catch{}
    setUser(null);
    setAdminVerified(false);
  }

  if(!user) return <LoginScreen onLogin={handleLogin}/>;

  if(user.isAdmin){
    if(!user.faceDescriptor){
      // لا يمكن فرض التحقق على مدير لم يسجّل وجهه بعد — يدخل مباشرة، ويُفضَّل تسجيل وجهه من لوحته
      return <AdminPanel employee={user} onLogout={handleLogout}/>;
    }
    if(!adminVerified){
      return (
        <FaceCaptureModal
          mode="verify"
          acceptedDescriptors={[JSON.parse(user.faceDescriptor)]}
          onDone={()=>setAdminVerified(true)}
          onCancel={handleLogout}
        />
      );
    }
    return <AdminPanel employee={user} onLogout={handleLogout}/>;
  }

  return <HomeScreen employee={user} onLogout={handleLogout}/>;
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
