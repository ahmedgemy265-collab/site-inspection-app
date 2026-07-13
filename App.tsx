import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, FileImage, Ruler, MessageSquare, Plus, Trash2, MapPin, User,
  Calendar, ChevronRight, X, Search, LayoutDashboard, ClipboardList,
  Building2, ArrowRight, Check, Upload, Loader2, AlertCircle, Users,
} from "lucide-react";

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
  } catch { return d; }
};

function compressImage(file, maxDim = 1000, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذرت قراءة الملف"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("تعذر تحميل الصورة"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const UNITS = ["م", "سم", "مم", "م²", "بوصة", "لتر", "بار"];

// ---------- Supabase storage layer ----------
// بيانات الاتصال بمشروع Supabase بتاعك
const SUPABASE_URL = "https://iezecgdvuxlchudfpowc.supabase.co";
const SUPABASE_KEY = "sb_publishable_RgGmU5LfMv9Le7b2ufcmGA_mdOKPDnn";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAllInspections() {
  const rows = await sbFetch("inspections?select=id,data&order=created_at.desc");
  return (rows || []).map((r) => ({ ...r.data, id: r.id }));
}
async function upsertInspection(record) {
  await sbFetch("inspections", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: record.id, data: record }]),
  });
}
async function deleteInspectionRow(id) {
  await sbFetch(`inspections?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- UI atoms ----------
function CornerFrame({ children, className = "" }) {
  return (
    <div className={`corner-frame ${className}`}>
      <span className="cf c-tl" /><span className="cf c-tr" /><span className="cf c-bl" /><span className="cf c-br" />
      {children}
    </div>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="field">
      <span className="field-label">{Icon && <Icon size={14} />} {label}</span>
      {children}
    </label>
  );
}

export default function SiteInspectionApp() {
  const [role, setRole] = useState("engineer"); // 'engineer' | 'admin'
  const [engineerName, setEngineerName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [booting, setBooting] = useState(true);
  const [inspections, setInspections] = useState([]);
  const [view, setView] = useState("list"); // list | form | detail
  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [engFilter, setEngFilter] = useState("all");

  // boot: load stored engineer name + all inspections
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem("engineer-name");
        if (saved) setEngineerName(saved);
      } catch {}
      await refreshAll();
      setBooting(false);
    })();
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const items = await fetchAllInspections();
      setInspections(items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      setErr("تعذر الاتصال بقاعدة البيانات، تأكد من الإنترنت وحاول تاني");
    }
  }, []);

  function setName(n) {
    setEngineerName(n);
    try { localStorage.setItem("engineer-name", n); } catch {}
  }

  function openNew() {
    setActiveId(null);
    setView("form");
  }
  function openDetail(id) {
    setActiveId(id);
    setView("detail");
  }
  function openEdit(id) {
    setActiveId(id);
    setView("form");
  }

  async function handleDelete(id) {
    if (!window.confirm("هل تريد حذف هذه المعاينة نهائياً؟")) return;
    try {
      await deleteInspectionRow(id);
      await refreshAll();
      setView("list");
    } catch (e) {
      setErr("تعذر حذف المعاينة، حاول مرة أخرى");
    }
  }

  async function handleSave(record) {
    setSaving(true);
    setErr("");
    try {
      await upsertInspection(record);
      await refreshAll();
      setView("detail");
      setActiveId(record.id);
    } catch (e) {
      setErr("حدث خطأ أثناء الحفظ، تأكد من الإنترنت وحاول مرة أخرى");
    } finally {
      setSaving(false);
    }
  }

  const myInspections = inspections.filter((i) => i.engineerName === engineerName);
  const engineers = Array.from(new Set(inspections.map((i) => i.engineerName))).filter(Boolean);
  const filteredForAdmin = inspections.filter((i) => {
    const matchSearch = !search || i.siteName?.toLowerCase().includes(search.toLowerCase());
    const matchEng = engFilter === "all" || i.engineerName === engFilter;
    return matchSearch && matchEng;
  });

  const activeInspection = activeId ? inspections.find((i) => i.id === activeId) : null;

  return (
    <div className="app-root" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .app-root {
          --bg: #0F2136;
          --bg2: #16314D;
          --paper: #EEF2F5;
          --paper-2: #FFFFFF;
          --ink: #16232E;
          --muted: #5B6B76;
          --line: #CBD8DF;
          --accent: #E8622C;
          --accent-ink: #FFFFFF;
          --blue: #2E86AB;
          --success: #2F8F5B;
          --danger: #C6432B;
          font-family: 'Tajawal', sans-serif;
          color: var(--ink);
          min-height: 100vh;
          background: var(--paper);
          background-image:
            linear-gradient(var(--line) 1px, transparent 1px),
            linear-gradient(90deg, var(--line) 1px, transparent 1px);
          background-size: 28px 28px;
          background-position: -1px -1px;
          background-attachment: local;
        }
        .app-root * { box-sizing: border-box; }
        .mono { font-family: 'IBM Plex Mono', monospace; }

        .topbar {
          background: linear-gradient(135deg, var(--bg) 0%, var(--bg2) 100%);
          color: #fff;
          padding: 18px 20px;
          position: relative;
          overflow: hidden;
        }
        .topbar::after {
          content: "";
          position: absolute; inset: 0;
          background-image: linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 22px 22px;
          pointer-events: none;
        }
        .topbar-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-badge {
          width: 38px; height: 38px; border: 2px solid var(--accent);
          display: flex; align-items: center; justify-content: center;
          color: var(--accent); background: rgba(232,98,44,0.12); flex-shrink:0;
        }
        .brand-text h1 { margin: 0; font-size: 17px; font-weight: 900; letter-spacing: 0.2px; }
        .brand-text p { margin: 2px 0 0; font-size: 11px; color: rgba(255,255,255,0.6); font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.5px; }

        .role-switch { display: flex; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); padding: 3px; gap: 3px; }
        .role-switch button {
          border: none; background: transparent; color: rgba(255,255,255,0.65);
          padding: 7px 14px; font-family: 'Tajawal'; font-size: 13px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; gap: 6px; transition: all .15s;
        }
        .role-switch button.active { background: var(--accent); color: #fff; }

        .container { max-width: 920px; margin: 0 auto; padding: 20px 16px 60px; }

        .name-gate {
          max-width: 380px; margin: 60px auto; background: var(--paper-2);
          border: 1px solid var(--line); padding: 28px 24px; text-align: center;
        }
        .name-gate h2 { font-size: 18px; margin: 12px 0 4px; }
        .name-gate p { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
        .name-gate input { width: 100%; padding: 11px 12px; border: 1.5px solid var(--line); font-family: 'Tajawal'; font-size: 14px; margin-bottom: 12px; }
        .name-gate input:focus { outline: none; border-color: var(--accent); }

        .btn {
          display: inline-flex; align-items: center; gap: 7px; justify-content: center;
          border: none; cursor: pointer; font-family: 'Tajawal'; font-weight: 700; font-size: 13.5px;
          padding: 10px 16px; transition: opacity .15s, transform .1s;
        }
        .btn:active { transform: scale(0.98); }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-primary:hover { opacity: 0.92; }
        .btn-outline { background: transparent; border: 1.5px solid var(--ink); color: var(--ink); }
        .btn-ghost { background: rgba(0,0,0,0.05); color: var(--ink); }
        .btn-danger { background: transparent; color: var(--danger); border: 1.5px solid var(--danger); }
        .btn-block { width: 100%; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .section-head { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 12px; gap: 10px; flex-wrap: wrap; }
        .section-head h2 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; }
        .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: 1.5px; color: var(--muted); text-transform: uppercase; }

        .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; }
        .stat-card { background: var(--paper-2); border: 1px solid var(--line); padding: 12px 14px; }
        .stat-card .num { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; color: var(--bg2); }
        .stat-card .lbl { font-size: 11.5px; color: var(--muted); margin-top: 2px; }

        .filters { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
        .search-box { flex: 1; min-width: 160px; display: flex; align-items: center; gap: 8px; background: var(--paper-2); border: 1px solid var(--line); padding: 9px 12px; }
        .search-box input { border: none; background: transparent; font-family: 'Tajawal'; font-size: 13.5px; width: 100%; outline: none; }
        .filters select { border: 1px solid var(--line); background: var(--paper-2); font-family: 'Tajawal'; font-size: 13px; padding: 9px 10px; }

        .card-list { display: flex; flex-direction: column; gap: 10px; }
        .insp-card {
          background: var(--paper-2); border: 1px solid var(--line); padding: 14px 16px;
          cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px;
          border-inline-start: 4px solid var(--accent); transition: box-shadow .15s;
        }
        .insp-card:hover { box-shadow: 3px 3px 0 rgba(0,0,0,0.08); }
        .insp-card-main h3 { margin: 0 0 4px; font-size: 15px; }
        .insp-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
        .insp-meta span { display: flex; align-items: center; gap: 4px; }
        .insp-tags { display: flex; gap: 6px; margin-top: 6px; }
        .tag { font-size: 10.5px; font-family: 'IBM Plex Mono', monospace; background: rgba(46,134,171,0.1); color: var(--blue); padding: 2px 7px; border: 1px solid rgba(46,134,171,0.25); }

        .empty-state { text-align: center; padding: 50px 20px; color: var(--muted); }
        .empty-state svg { opacity: 0.35; margin-bottom: 10px; }
        .empty-state p { margin: 4px 0; font-size: 13.5px; }

        .fab-add { position: fixed; bottom: 22px; left: 22px; z-index: 20; box-shadow: 0 6px 16px rgba(0,0,0,0.25); }

        /* form */
        .form-wrap { background: var(--paper-2); border: 1px solid var(--line); padding: 20px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 560px) { .form-grid { grid-template-columns: 1fr; } .stats-row { grid-template-columns: 1fr 1fr; } }
        .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .field-label { font-size: 12.5px; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 6px; }
        .field input[type=text], .field input[type=date], .field textarea, .field select {
          border: 1.5px solid var(--line); padding: 10px 11px; font-family: 'Tajawal'; font-size: 14px; background: #fff; width: 100%;
        }
        .field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--accent); }
        .field textarea { resize: vertical; min-height: 70px; }

        .divider { border: none; border-top: 1px dashed var(--line); margin: 20px 0; }

        .upload-zone {
          border: 2px dashed var(--line); padding: 18px; text-align: center; cursor: pointer;
          color: var(--muted); font-size: 13px; transition: border-color .15s, background .15s;
        }
        .upload-zone:hover { border-color: var(--accent); background: rgba(232,98,44,0.04); }
        .thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; margin-top: 12px; }
        .thumb { position: relative; }
        .thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; border: 1px solid var(--line); }
        .thumb .rm { position: absolute; top: -6px; left: -6px; background: var(--danger); color: #fff; border: none; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .thumb input { width: 100%; margin-top: 4px; font-size: 10.5px; border: 1px solid var(--line); padding: 3px 5px; font-family: 'Tajawal'; }

        .meas-row { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
        @media (max-width: 480px) { .meas-row { grid-template-columns: 1fr 1fr; } }
        .meas-row input, .meas-row select { border: 1.5px solid var(--line); padding: 8px 9px; font-family: 'Tajawal'; font-size: 13px; }
        .meas-row .rm-row { background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 6px; }

        .form-actions { display: flex; gap: 10px; margin-top: 18px; }

        /* detail */
        .detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .detail-title h2 { margin: 0 0 6px; font-size: 19px; }
        .detail-title .insp-meta { font-size: 12.5px; }
        .detail-actions { display: flex; gap: 8px; }

        .detail-section { margin-bottom: 22px; }
        .detail-section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; font-weight: 600; margin: 0 0 10px; display: flex; align-items: center; gap: 7px; }
        .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
        .gallery figure { margin: 0; }
        .corner-frame { position: relative; border: 1px solid var(--line); background: #fff; }
        .corner-frame img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
        .cf { position: absolute; width: 10px; height: 10px; border-color: var(--accent); border-style: solid; }
        .c-tl { top: -1px; right: -1px; border-width: 2px 2px 0 0; }
        .c-tr { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
        .c-bl { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }
        .c-br { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
        figcaption { font-size: 11px; color: var(--muted); margin-top: 4px; text-align: center; }

        .meas-table { width: 100%; border-collapse: collapse; }
        .meas-table td, .meas-table th { padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13.5px; text-align: right; }
        .meas-table th { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); font-weight: 600; }
        .meas-table td.val { font-family: 'IBM Plex Mono', monospace; }

        .note-box { background: rgba(0,0,0,0.03); border-inline-start: 3px solid var(--blue); padding: 12px 14px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
        .note-box.req { border-inline-start-color: var(--accent); }

        .err-banner { background: rgba(198,67,43,0.1); border: 1px solid rgba(198,67,43,0.3); color: var(--danger); padding: 10px 14px; font-size: 13px; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
        .boot-loading { display: flex; align-items: center; justify-content: center; min-height: 60vh; color: var(--muted); flex-direction: column; gap: 10px; font-size: 13.5px; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-badge"><ClipboardList size={19} /></div>
            <div className="brand-text">
              <h1>معاينات المواقع</h1>
              <p>SITE INSPECTION LOG — FIRE PROTECTION</p>
            </div>
          </div>
          <div className="role-switch">
            <button className={role === "engineer" ? "active" : ""} onClick={() => { setRole("engineer"); setView("list"); }}>
              <User size={14} /> مهندس
            </button>
            <button className={role === "admin" ? "active" : ""} onClick={() => { setRole("admin"); setView("list"); }}>
              <LayoutDashboard size={14} /> إدارة
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        {booting ? (
          <div className="boot-loading"><Loader2 className="spin" size={26} /> جارِ تحميل البيانات…</div>
        ) : role === "engineer" && !engineerName ? (
          <NameGate nameDraft={nameDraft} setNameDraft={setNameDraft} onConfirm={() => nameDraft.trim() && setName(nameDraft.trim())} />
        ) : role === "engineer" ? (
          <>
            {view === "list" && (
              <EngineerList
                engineerName={engineerName}
                items={myInspections}
                onOpen={openDetail}
                onSwitchUser={() => { setName(""); }}
              />
            )}
            {view === "form" && (
              <InspectionForm
                engineerName={engineerName}
                initial={activeInspection}
                saving={saving}
                err={err}
                onCancel={() => setView(activeId ? "detail" : "list")}
                onSave={handleSave}
              />
            )}
            {view === "detail" && activeInspection && (
              <InspectionDetail
                insp={activeInspection}
                canEdit={activeInspection.engineerName === engineerName}
                onBack={() => setView("list")}
                onEdit={() => openEdit(activeInspection.id)}
                onDelete={() => handleDelete(activeInspection.id)}
              />
            )}
            {view === "list" && (
              <button className="btn btn-primary fab-add" onClick={openNew}><Plus size={18} /> معاينة جديدة</button>
            )}
          </>
        ) : (
          <>
            {view !== "detail" && (
              <AdminDashboard
                items={inspections}
                filtered={filteredForAdmin}
                engineers={engineers}
                search={search} setSearch={setSearch}
                engFilter={engFilter} setEngFilter={setEngFilter}
                onOpen={openDetail}
              />
            )}
            {view === "detail" && activeInspection && (
              <InspectionDetail
                insp={activeInspection}
                canEdit={true}
                onBack={() => setView("list")}
                onEdit={() => openEdit(activeInspection.id)}
                onDelete={() => handleDelete(activeInspection.id)}
              />
            )}
            {view === "form" && (
              <InspectionForm
                engineerName={activeInspection?.engineerName || engineers[0] || ""}
                initial={activeInspection}
                saving={saving}
                err={err}
                onCancel={() => setView(activeId ? "detail" : "list")}
                onSave={handleSave}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NameGate({ nameDraft, setNameDraft, onConfirm }) {
  return (
    <div className="name-gate">
      <User size={26} color="#E8622C" />
      <h2>اكتب اسمك للبدء</h2>
      <p>هيتربط اسمك بكل المعاينات اللي هترفعها</p>
      <input
        placeholder="اسم المهندس"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onConfirm()}
      />
      <button className="btn btn-primary btn-block" onClick={onConfirm}>دخول <ArrowRight size={15} /></button>
    </div>
  );
}

function EngineerList({ engineerName, items, onOpen, onSwitchUser }) {
  return (
    <>
      <div className="section-head">
        <h2><User size={16} /> معايناتي — {engineerName}</h2>
        <button className="btn btn-ghost" onClick={onSwitchUser}>تغيير المستخدم</button>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={40} />
          <p>مفيش معاينات مسجلة لسه</p>
          <p>دوس على "معاينة جديدة" علشان تبدأ</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((i) => <InspCard key={i.id} insp={i} onClick={() => onOpen(i.id)} />)}
        </div>
      )}
    </>
  );
}

function InspCard({ insp, onClick }) {
  return (
    <div className="insp-card" onClick={onClick}>
      <div className="insp-card-main">
        <h3>{insp.siteName || "بدون اسم"}</h3>
        <div className="insp-meta">
          <span className="mono"><Calendar size={12} /> {fmtDate(insp.date)}</span>
          {insp.location && <span><MapPin size={12} /> {insp.location}</span>}
          <span><User size={12} /> {insp.engineerName}</span>
        </div>
        <div className="insp-tags">
          {insp.photos?.length > 0 && <span className="tag">{insp.photos.length} صورة</span>}
          {insp.drawings?.length > 0 && <span className="tag">{insp.drawings.length} رسم</span>}
          {insp.measurements?.length > 0 && <span className="tag">{insp.measurements.length} مقاس</span>}
        </div>
      </div>
      <ChevronRight size={18} color="#5B6B76" />
    </div>
  );
}

function AdminDashboard({ items, filtered, engineers, search, setSearch, engFilter, setEngFilter, onOpen }) {
  return (
    <>
      <div className="stats-row">
        <div className="stat-card"><div className="num mono">{items.length}</div><div className="lbl">إجمالي المعاينات</div></div>
        <div className="stat-card"><div className="num mono">{engineers.length}</div><div className="lbl">عدد المهندسين</div></div>
        <div className="stat-card"><div className="num mono">{new Set(items.map(i => i.siteName)).size}</div><div className="lbl">عدد المواقع</div></div>
      </div>

      <div className="section-head"><h2><LayoutDashboard size={16} /> كل المعاينات</h2></div>

      <div className="filters">
        <div className="search-box">
          <Search size={15} color="#5B6B76" />
          <input placeholder="ابحث باسم الموقع…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={engFilter} onChange={(e) => setEngFilter(e.target.value)}>
          <option value="all">كل المهندسين</option>
          {engineers.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Users size={40} />
          <p>{items.length === 0 ? "لسه مفيش معاينات مرفوعة من الفريق" : "مفيش نتائج مطابقة"}</p>
        </div>
      ) : (
        <div className="card-list">
          {filtered.map((i) => <InspCard key={i.id} insp={i} onClick={() => onOpen(i.id)} />)}
        </div>
      )}
    </>
  );
}

function InspectionDetail({ insp, canEdit, onBack, onEdit, onDelete }) {
  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 14 }}><ArrowRight size={15} /> رجوع للقائمة</button>

      <div className="detail-head">
        <div className="detail-title">
          <h2>{insp.siteName}</h2>
          <div className="insp-meta">
            <span className="mono"><Calendar size={12} /> {fmtDate(insp.date)}</span>
            {insp.location && <span><MapPin size={12} /> {insp.location}</span>}
            <span><User size={12} /> {insp.engineerName}</span>
          </div>
        </div>
        {canEdit && (
          <div className="detail-actions">
            <button className="btn btn-outline" onClick={onEdit}>تعديل</button>
            <button className="btn btn-danger" onClick={onDelete}><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      {insp.photos?.length > 0 && (
        <div className="detail-section">
          <h3><Camera size={13} /> الصور ({insp.photos.length})</h3>
          <div className="gallery">
            {insp.photos.map((p) => (
              <figure key={p.id}>
                <CornerFrame><img src={p.dataUrl} alt={p.caption || "صورة"} /></CornerFrame>
                {p.caption && <figcaption>{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      )}

      {insp.drawings?.length > 0 && (
        <div className="detail-section">
          <h3><FileImage size={13} /> الرسومات ({insp.drawings.length})</h3>
          <div className="gallery">
            {insp.drawings.map((p) => (
              <figure key={p.id}>
                <CornerFrame><img src={p.dataUrl} alt={p.caption || "رسم"} /></CornerFrame>
                {p.caption && <figcaption>{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      )}

      {insp.measurements?.length > 0 && (
        <div className="detail-section">
          <h3><Ruler size={13} /> المقاسات</h3>
          <table className="meas-table">
            <thead><tr><th>البند</th><th>القيمة</th><th>الوحدة</th></tr></thead>
            <tbody>
              {insp.measurements.map((m) => (
                <tr key={m.id}><td>{m.label}</td><td className="val">{m.value}</td><td className="val">{m.unit}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {insp.requests && (
        <div className="detail-section">
          <h3><ClipboardList size={13} /> الطلبات</h3>
          <div className="note-box req">{insp.requests}</div>
        </div>
      )}

      {insp.notes && (
        <div className="detail-section">
          <h3><MessageSquare size={13} /> ملاحظات</h3>
          <div className="note-box">{insp.notes}</div>
        </div>
      )}

      {!insp.photos?.length && !insp.drawings?.length && !insp.measurements?.length && !insp.requests && !insp.notes && (
        <div className="empty-state"><p>مفيش تفاصيل مسجلة في المعاينة دي</p></div>
      )}
    </div>
  );
}

function InspectionForm({ engineerName, initial, saving, err, onCancel, onSave }) {
  const [siteName, setSiteName] = useState(initial?.siteName || "");
  const [date, setDate] = useState(initial?.date || today());
  const [location, setLocation] = useState(initial?.location || "");
  const [photos, setPhotos] = useState(initial?.photos || []);
  const [drawings, setDrawings] = useState(initial?.drawings || []);
  const [measurements, setMeasurements] = useState(initial?.measurements || []);
  const [requests, setRequests] = useState(initial?.requests || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [uploading, setUploading] = useState(false);
  const [localErr, setLocalErr] = useState("");
  const photoInput = useRef(null);
  const drawInput = useRef(null);

  async function handleFiles(files, setter) {
    setUploading(true);
    setLocalErr("");
    try {
      const arr = Array.from(files).slice(0, 10);
      const results = await Promise.all(arr.map(async (f) => ({ id: uid(), dataUrl: await compressImage(f), caption: "" })));
      setter((prev) => [...prev, ...results]);
    } catch {
      setLocalErr("تعذر رفع أحد الملفات، جرّب صورة تانية");
    } finally {
      setUploading(false);
    }
  }

  function addMeasurement() {
    setMeasurements((m) => [...m, { id: uid(), label: "", value: "", unit: UNITS[0] }]);
  }
  function updateMeasurement(id, patch) {
    setMeasurements((m) => m.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function removeMeasurement(id) {
    setMeasurements((m) => m.filter((row) => row.id !== id));
  }

  function submit() {
    if (!siteName.trim()) { setLocalErr("من فضلك اكتب اسم الموقع"); return; }
    const record = {
      id: initial?.id || uid(),
      engineerName: initial?.engineerName || engineerName,
      siteName: siteName.trim(),
      date, location: location.trim(),
      photos, drawings,
      measurements: measurements.filter((m) => m.label.trim() || m.value.toString().trim()),
      requests: requests.trim(), notes: notes.trim(),
      createdAt: initial?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    onSave(record);
  }

  return (
    <div className="form-wrap">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{initial ? "تعديل معاينة" : "معاينة جديدة"}</div>
      <h2 style={{ margin: "0 0 18px", fontSize: 18 }}>بيانات الموقع</h2>

      {(localErr || err) && <div className="err-banner"><AlertCircle size={15} /> {localErr || err}</div>}

      <div className="form-grid">
        <Field label="اسم الموقع" icon={Building2}>
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="مثال: مركز خدمة السيارات - الهرم" />
        </Field>
        <Field label="التاريخ" icon={Calendar}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="العنوان / الموقع (اختياري)" icon={MapPin}>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="العنوان بالتفصيل" />
      </Field>

      <hr className="divider" />
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#5B6B76", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, marginBottom: 10 }}>
        <Camera size={13} style={{ verticalAlign: "-2px", marginLeft: 6 }} />الصور
      </h3>
      <div className="upload-zone" onClick={() => photoInput.current?.click()}>
        <Upload size={20} style={{ marginBottom: 6 }} /><br />
        دوس هنا لرفع صور من الموقع
        <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files.length && handleFiles(e.target.files, setPhotos)} />
      </div>
      {photos.length > 0 && (
        <div className="thumb-grid">
          {photos.map((p) => (
            <div className="thumb" key={p.id}>
              <img src={p.dataUrl} alt="" />
              <button className="rm" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}><X size={12} /></button>
              <input placeholder="وصف الصورة" value={p.caption} onChange={(e) => setPhotos((ps) => ps.map((x) => x.id === p.id ? { ...x, caption: e.target.value } : x))} />
            </div>
          ))}
        </div>
      )}

      <hr className="divider" />
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#5B6B76", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, marginBottom: 10 }}>
        <FileImage size={13} style={{ verticalAlign: "-2px", marginLeft: 6 }} />الرسومات
      </h3>
      <div className="upload-zone" onClick={() => drawInput.current?.click()}>
        <Upload size={20} style={{ marginBottom: 6 }} /><br />
        ارفع رسومات أو مخططات (صور)
        <input ref={drawInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files.length && handleFiles(e.target.files, setDrawings)} />
      </div>
      {drawings.length > 0 && (
        <div className="thumb-grid">
          {drawings.map((p) => (
            <div className="thumb" key={p.id}>
              <img src={p.dataUrl} alt="" />
              <button className="rm" onClick={() => setDrawings((ps) => ps.filter((x) => x.id !== p.id))}><X size={12} /></button>
              <input placeholder="وصف الرسم" value={p.caption} onChange={(e) => setDrawings((ps) => ps.map((x) => x.id === p.id ? { ...x, caption: e.target.value } : x))} />
            </div>
          ))}
        </div>
      )}

      <hr className="divider" />
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#5B6B76", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, marginBottom: 10 }}>
        <Ruler size={13} style={{ verticalAlign: "-2px", marginLeft: 6 }} />المقاسات
      </h3>
      {measurements.map((m) => (
        <div className="meas-row" key={m.id}>
          <input placeholder="البند (مثال: ارتفاع الباب)" value={m.label} onChange={(e) => updateMeasurement(m.id, { label: e.target.value })} />
          <input placeholder="القيمة" value={m.value} onChange={(e) => updateMeasurement(m.id, { value: e.target.value })} className="mono" />
          <select value={m.unit} onChange={(e) => updateMeasurement(m.id, { unit: e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button className="rm-row" onClick={() => removeMeasurement(m.id)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={addMeasurement}><Plus size={14} /> إضافة مقاس</button>

      <hr className="divider" />
      <Field label="الطلبات" icon={ClipboardList}>
        <textarea value={requests} onChange={(e) => setRequests(e.target.value)} placeholder="اكتب المعدات أو المتطلبات المطلوبة للموقع" />
      </Field>
      <Field label="ملاحظات" icon={MessageSquare}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي ملاحظات إضافية عن المعاينة" />
      </Field>

      <div className="form-actions">
        <button className="btn btn-outline" onClick={onCancel} disabled={saving}>إلغاء</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={saving || uploading}>
          {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />} {saving ? "جارِ الحفظ…" : "حفظ المعاينة"}
        </button>
      </div>
    </div>
  );
}