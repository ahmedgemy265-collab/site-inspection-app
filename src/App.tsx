import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, FileImage, Ruler, MessageSquare, Plus, Trash2, MapPin, User,
  Calendar, ChevronRight, X, Search, LayoutDashboard, ClipboardList,
  Building2, ArrowRight, Check, Upload, Loader2, AlertCircle, Users,
  FileText, Download,
} from "lucide-react";

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
  } catch { return d; }
};
const fmtFileSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

async function fetchAllRequests() {
  const rows = await sbFetch("requests?select=id,data&order=created_at.desc");
  return (rows || []).map((r) => ({ ...r.data, id: r.id }));
}
async function upsertRequest(record) {
  await sbFetch("requests", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: record.id, data: record }]),
  });
}
async function deleteRequestRow(id) {
  await sbFetch(`requests?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function fetchAllQuotes() {
  const rows = await sbFetch("quotes?select=id,data&order=created_at.desc");
  return (rows || []).map((r) => ({ ...r.data, id: r.id }));
}
async function upsertQuote(record) {
  await sbFetch("quotes", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: record.id, data: record }]),
  });
}
async function deleteQuoteRow(id) {
  await sbFetch(`quotes?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

const DOCS_BUCKET = "inspection-files";
async function uploadDocumentToStorage(file) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${uid()}-${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${DOCS_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`تعذر رفع الملف: ${text}`);
  }
  return {
    id: uid(),
    name: file.name,
    ext,
    size: file.size,
    url: `${SUPABASE_URL}/storage/v1/object/public/${DOCS_BUCKET}/${path}`,
  };
}

// ---------- Auth (login system) ----------
async function sbRpc(fnName, params = {}) {
  return sbFetch(`rpc/${fnName}`, { method: "POST", body: JSON.stringify(params) });
}
async function loginRequest(username, password) {
  const rows = await sbRpc("login", { p_username: username, p_password: password });
  if (!rows || !rows.length) return null;
  return rows[0]; // { session_token, user_id, full_name, role }
}
async function whoamiRequest(token) {
  const rows = await sbRpc("whoami", { p_token: token });
  if (!rows || !rows.length) return null;
  return rows[0];
}
async function logoutRequest(token) {
  await sbRpc("logout", { p_token: token });
}
async function adminListEngineers(token) {
  return sbRpc("admin_list_engineers", { p_token: token });
}
async function adminCreateEngineer(token, username, fullName, role) {
  return sbRpc("admin_create_engineer", { p_token: token, p_username: username, p_full_name: fullName, p_role: role });
}
async function adminResetPassword(token, targetId) {
  return sbRpc("admin_reset_password", { p_token: token, p_target_id: targetId });
}
async function adminDeleteEngineer(token, targetId) {
  return sbRpc("admin_delete_engineer", { p_token: token, p_target_id: targetId });
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
  const [session, setSession] = useState(null); // { token, userId, fullName, role } | null
  const [booting, setBooting] = useState(true);
  const [inspections, setInspections] = useState([]);
  const [requests, setRequests] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [view, setView] = useState("list"); // list | form | detail | requests | requestForm | users | quotes | quoteDetail
  const [activeId, setActiveId] = useState(null);
  const [requestSeed, setRequestSeed] = useState(null); // { siteName, location, requestId } | null
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [engFilter, setEngFilter] = useState("all");

  // boot: validate stored session token + load all inspections
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("session-token");
        if (token) {
          const who = await whoamiRequest(token);
          if (who) {
            setSession({ token, userId: who.user_id, fullName: who.full_name, role: who.role });
            if (who.role === "followup") setView("requests");
          } else {
            localStorage.removeItem("session-token");
          }
        }
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
    try {
      const reqs = await fetchAllRequests();
      setRequests(reqs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      // silent: not all roles depend on requests loading successfully on first paint
    }
    try {
      const qs = await fetchAllQuotes();
      setQuotes(qs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      // silent: not all roles depend on quotes loading successfully on first paint
    }
  }, []);

  async function handleLogin(username, password) {
    const result = await loginRequest(username, password);
    if (!result) throw new Error("اسم المستخدم أو الباسورد غير صحيح");
    const s = { token: result.session_token, userId: result.user_id, fullName: result.full_name, role: result.role };
    setSession(s);
    setView(s.role === "followup" ? "requests" : "list");
    try { localStorage.setItem("session-token", s.token); } catch {}
  }
  function handleLogout() {
    if (session?.token) logoutRequest(session.token).catch(() => {});
    setSession(null);
    try { localStorage.removeItem("session-token"); } catch {}
    setView("list");
  }

  function openNew() {
    setActiveId(null);
    setView("form");
  }
  function openDetail(id) {
    setActiveId(id);
    setView("detail");
  }
  function openQuoteDetail(id) {
    setActiveId(id);
    setView("quoteDetail");
  }
  function openEdit(id) {
    setActiveId(id);
    setView("form");
  }
  function openNewRequest() {
    setView("requestForm");
  }
  function openInspectionFromRequest(req) {
    setActiveId(null);
    setRequestSeed({ siteName: req.siteName, location: req.location, clientPhone: req.clientPhone, requestId: req.id });
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
      // كل معاينة يتم حفظها (جديدة أو تعديل معاينة قديمة) بتتحول لطلب عرض سعر في "المكتب الفني"
      const wasLegacyInspection = !!activeId && inspections.some((i) => i.id === activeId);
      await upsertQuote(record);
      if (wasLegacyInspection) {
        await deleteInspectionRow(activeId);
      }
      if (requestSeed?.requestId) {
        const target = requests.find((r) => r.id === requestSeed.requestId);
        if (target) {
          await upsertRequest({ ...target, status: "done", linkedInspectionId: record.id });
        }
        setRequestSeed(null);
      }
      await refreshAll();
      setView("quoteDetail");
      setActiveId(record.id);
    } catch (e) {
      setErr("حدث خطأ أثناء الحفظ، تأكد من الإنترنت وحاول مرة أخرى");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteQuote(id) {
    if (!window.confirm("هل تريد حذف طلب عرض السعر ده نهائياً؟")) return;
    try {
      await deleteQuoteRow(id);
      await refreshAll();
      setView("quotes");
    } catch (e) {
      setErr("تعذر حذف طلب عرض السعر، حاول مرة أخرى");
    }
  }

  async function handleSaveRequest(record) {
    setSaving(true);
    setErr("");
    try {
      await upsertRequest(record);
      await refreshAll();
      setView("requests");
    } catch (e) {
      setErr("حدث خطأ أثناء حفظ الطلب، تأكد من الإنترنت وحاول مرة أخرى");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignRequest(id, engineerNameOrNull) {
    const target = requests.find((r) => r.id === id);
    if (!target) return;
    try {
      const nextStatus = engineerNameOrNull
        ? ((!target.status || target.status === "unassigned") ? "assigned" : target.status)
        : "unassigned";
      await upsertRequest({ ...target, assignedEngineer: engineerNameOrNull, status: nextStatus });
      await refreshAll();
    } catch (e) {
      setErr("تعذر تحديث تخصيص الطلب");
    }
  }

  async function handleUpdateRequestStatus(id, status) {
    const target = requests.find((r) => r.id === id);
    if (!target) return;
    try {
      await upsertRequest({ ...target, status });
      await refreshAll();
    } catch (e) {
      setErr("تعذر تحديث حالة الطلب");
    }
  }

  async function handleDeleteRequest(id) {
    if (!window.confirm("هل تريد حذف هذا الطلب نهائياً؟")) return;
    try {
      await deleteRequestRow(id);
      await refreshAll();
    } catch (e) {
      setErr("تعذر حذف الطلب");
    }
  }

  const myInspections = inspections.filter((i) => i.engineerName === session?.fullName);
  const engineers = Array.from(new Set(inspections.map((i) => i.engineerName))).filter(Boolean);
  const filteredForAdmin = inspections.filter((i) => {
    const matchSearch = !search || i.siteName?.toLowerCase().includes(search.toLowerCase());
    const matchEng = engFilter === "all" || i.engineerName === engFilter;
    return matchSearch && matchEng;
  });
  const requestsForEngineer = requests.filter(
    (r) => !r.assignedEngineer || r.assignedEngineer === session?.fullName
  );

  const activeInspection = activeId ? inspections.find((i) => i.id === activeId) : null;
  const activeQuote = activeId ? quotes.find((q) => q.id === activeId) : null;
  // true إذا كان الفورم مفتوح لإنشاء/تعديل طلب عرض سعر (مش تعديل معاينة قديمة لسه موجودة في inspections)
  const formIsQuoteContext = view === "form" && !(activeId && inspections.some((i) => i.id === activeId));

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

        .role-switch { display: flex; flex-wrap: wrap; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); padding: 3px; gap: 3px; }
        .role-switch button {
          border: none; background: transparent; color: rgba(255,255,255,0.65);
          padding: 7px 14px; font-family: 'Tajawal'; font-size: 13px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; gap: 6px; transition: all .15s;
        }
        .role-switch button.active { background: var(--accent); color: #fff; }

        .user-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
        .user-name { color: rgba(255,255,255,0.85); font-size: 13px; font-weight: 700; }
        .btn-sm { padding: 6px 11px; font-size: 12.5px; }

        .container { max-width: 920px; margin: 0 auto; padding: 20px 16px 60px; }

        .user-create-box { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; background: var(--paper-2); border: 1px solid var(--line); padding: 14px; }
        .user-create-box input { flex: 1; min-width: 160px; padding: 10px 12px; border: 1.5px solid var(--line); font-family: 'Tajawal'; font-size: 13.5px; }
        .user-create-box input:focus { outline: none; border-color: var(--accent); }
        .user-create-box select { padding: 10px 12px; border: 1.5px solid var(--line); font-family: 'Tajawal'; font-size: 13.5px; background: #fff; }
        .user-list { display: flex; flex-direction: column; gap: 8px; }
        .user-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--paper-2); border: 1px solid var(--line); padding: 12px 14px; flex-wrap: wrap; }
        .user-row-info { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
        .user-row-username { color: var(--muted); font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        .badge-admin { background: rgba(232,98,44,0.12); color: var(--accent); font-size: 10.5px; font-weight: 800; padding: 2px 8px; }

        .req-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
        .req-subtabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; }
        .req-subtabs button {
          border: 1.5px solid var(--line); background: var(--paper-2); color: var(--ink);
          padding: 8px 13px; font-family: 'Tajawal'; font-size: 12.5px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; gap: 6px; transition: all .15s;
        }
        .req-subtabs button.active { background: var(--bg2); color: #fff; border-color: var(--bg2); }
        .req-subtab-count { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; background: rgba(0,0,0,0.08); padding: 1px 6px; }
        .req-subtabs button.active .req-subtab-count { background: rgba(255,255,255,0.22); }
        .req-row { background: var(--paper-2); border: 1px solid var(--line); padding: 14px; }
        .req-row-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
        .req-row-head strong { font-size: 14.5px; }
        .badge-assigned { background: rgba(15,33,54,0.08); color: var(--ink); font-size: 10.5px; font-weight: 800; padding: 2px 8px; white-space: nowrap; }
        .badge-unassigned { background: rgba(232,98,44,0.12); color: var(--accent); font-size: 10.5px; font-weight: 800; padding: 2px 8px; white-space: nowrap; }
        .badge-scheduled { background: rgba(200,150,0,0.14); color: #8a6a00; font-size: 10.5px; font-weight: 800; padding: 2px 8px; white-space: nowrap; }
        .badge-done { background: rgba(30,140,80,0.14); color: #1b7a45; font-size: 10.5px; font-weight: 800; padding: 2px 8px; white-space: nowrap; }
        .req-row-body { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; color: var(--muted); margin-bottom: 6px; }
        .req-row-body span { display: inline-flex; align-items: center; gap: 4px; }
        .req-notes { font-size: 13px; color: var(--ink); background: rgba(0,0,0,0.03); padding: 8px 10px; margin: 6px 0; }
        .req-row-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
        .req-meta { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
        .req-admin-actions { display: flex; align-items: center; gap: 6px; }
        .req-admin-actions select { padding: 7px 9px; border: 1.5px solid var(--line); font-family: 'Tajawal'; font-size: 12.5px; background: #fff; }
        .user-row-actions { display: flex; gap: 6px; }

        .modal-backdrop { position: fixed; inset: 0; background: rgba(15,33,54,0.6); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
        .modal-box { background: #fff; max-width: 360px; width: 100%; padding: 22px; text-align: center; }
        .modal-box h3 { margin: 0 0 10px; font-size: 16px; }
        .modal-box p { font-size: 13px; color: var(--muted); margin: 0 0 10px; }
        .password-reveal { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 700; letter-spacing: 2px; background: rgba(0,0,0,0.05); padding: 12px; margin-bottom: 10px; }
        .modal-box .hint { font-size: 11.5px; color: var(--danger); }

        .doc-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
        .doc-row { display: flex; align-items: center; gap: 10px; background: var(--paper-2); border: 1px solid var(--line); padding: 9px 12px; color: var(--ink); text-decoration: none; }
        .doc-row-link { cursor: pointer; }
        .doc-row-link:hover { border-color: var(--accent); }
        .doc-row-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .doc-row-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-row-size { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }

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
        .location-link-row { display: flex; gap: 8px; }
        .location-link-row input { flex: 1; }
        .location-link-row button { white-space: nowrap; }
        .location-link-preview { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--accent); text-decoration: none; }
        .location-link-preview:hover { text-decoration: underline; }

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
          {session && (
            <div className="user-bar">
              {session.role === "admin" && (
                <div className="role-switch">
                  <button
                    className={(view !== "users" && view !== "requests" && view !== "requestForm" && view !== "quotes" && view !== "quoteDetail" && !formIsQuoteContext) ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <LayoutDashboard size={14} /> المعاينات
                  </button>
                  <button className={view === "requests" || view === "requestForm" ? "active" : ""} onClick={() => setView("requests")}>
                    <ClipboardList size={14} /> الطلبات
                  </button>
                  <button className={(view === "quotes" || view === "quoteDetail" || formIsQuoteContext) ? "active" : ""} onClick={() => setView("quotes")}>
                    <FileText size={14} /> المكتب الفني
                  </button>
                  <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}>
                    <Users size={14} /> المهندسين
                  </button>
                </div>
              )}
              {session.role === "engineer" && (
                <div className="role-switch">
                  <button
                    className={(view !== "requests" && view !== "quotes" && view !== "quoteDetail" && !formIsQuoteContext) ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <LayoutDashboard size={14} /> معايناتي
                  </button>
                  <button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}>
                    <ClipboardList size={14} /> طلبات المعاينة
                  </button>
                  <button className={(view === "quotes" || view === "quoteDetail" || formIsQuoteContext) ? "active" : ""} onClick={() => setView("quotes")}>
                    <FileText size={14} /> المكتب الفني
                  </button>
                </div>
              )}
              <span className="user-name">{session.fullName}</span>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>خروج</button>
            </div>
          )}
        </div>
      </div>

      <div className="container">
        {booting ? (
          <div className="boot-loading"><Loader2 className="spin" size={26} /> جارِ تحميل البيانات…</div>
        ) : !session ? (
          <LoginScreen onLogin={handleLogin} />
        ) : session.role === "followup" ? (
          <>
            {view === "requestForm" ? (
              <RequestForm
                createdBy={session.fullName}
                saving={saving}
                err={err}
                onCancel={() => setView("requests")}
                onSave={handleSaveRequest}
              />
            ) : (
              <>
                <RequestsList
                  mode="followup"
                  items={requests}
                  currentUser={session}
                  onDelete={handleDeleteRequest}
                />
                <button className="btn btn-primary fab-add" onClick={openNewRequest}><Plus size={18} /> طلب جديد</button>
              </>
            )}
          </>
        ) : session.role === "engineer" ? (
          <>
            {view === "list" && (
              <EngineerList
                engineerName={session.fullName}
                items={myInspections}
                onOpen={openDetail}
                onSwitchUser={handleLogout}
              />
            )}
            {view === "form" && (
              <InspectionForm
                engineerName={session.fullName}
                initial={activeInspection || activeQuote || (requestSeed ? { siteName: requestSeed.siteName, location: requestSeed.location, clientPhone: requestSeed.clientPhone } : null)}
                saving={saving}
                err={err}
                onCancel={() => {
                  const cameFromRequest = !!requestSeed;
                  setRequestSeed(null);
                  if (cameFromRequest) { setView("requests"); return; }
                  if (activeId && inspections.some((i) => i.id === activeId)) { setView("detail"); return; }
                  if (activeId && quotes.some((q) => q.id === activeId)) { setView("quoteDetail"); return; }
                  setView("quotes");
                }}
                onSave={handleSave}
              />
            )}
            {view === "detail" && activeInspection && (
              <InspectionDetail
                insp={activeInspection}
                canEdit={activeInspection.engineerName === session.fullName}
                onBack={() => setView("list")}
                onEdit={() => openEdit(activeInspection.id)}
                onDelete={() => handleDelete(activeInspection.id)}
              />
            )}
            {view === "requests" && (
              <RequestsList
                mode="engineer"
                items={requestsForEngineer}
                currentUser={session}
                onAssign={handleAssignRequest}
                onUpdateStatus={handleUpdateRequestStatus}
                onStartInspection={openInspectionFromRequest}
                onOpenInspection={openQuoteDetail}
              />
            )}
            {view === "quotes" && (
              <>
                <QuotesList items={quotes} onOpen={openQuoteDetail} />
                <button className="btn btn-primary fab-add" onClick={openNew}><Plus size={18} /> طلب عرض سعر جديد</button>
              </>
            )}
            {view === "quoteDetail" && activeQuote && (
              <InspectionDetail
                insp={activeQuote}
                canEdit={activeQuote.engineerName === session.fullName}
                onBack={() => setView("quotes")}
                onEdit={() => openEdit(activeQuote.id)}
                onDelete={() => handleDeleteQuote(activeQuote.id)}
              />
            )}
          </>
        ) : view === "users" ? (
          <AdminUsers token={session.token} />
        ) : view === "requests" || view === "requestForm" ? (
          <>
            {view === "requestForm" ? (
              <RequestForm
                createdBy={session.fullName}
                saving={saving}
                err={err}
                onCancel={() => setView("requests")}
                onSave={handleSaveRequest}
              />
            ) : (
              <>
                <RequestsList
                  mode="admin"
                  items={requests}
                  currentUser={session}
                  token={session.token}
                  onAssign={handleAssignRequest}
                  onDelete={handleDeleteRequest}
                  onOpenInspection={openQuoteDetail}
                />
                <button className="btn btn-primary fab-add" onClick={openNewRequest}><Plus size={18} /> طلب جديد</button>
              </>
            )}
          </>
        ) : view === "quotes" ? (
          <>
            <QuotesList items={quotes} onOpen={openQuoteDetail} />
            <button className="btn btn-primary fab-add" onClick={openNew}><Plus size={18} /> طلب عرض سعر جديد</button>
          </>
        ) : view === "quoteDetail" && activeQuote ? (
          <InspectionDetail
            insp={activeQuote}
            canEdit={true}
            onBack={() => setView("quotes")}
            onEdit={() => openEdit(activeQuote.id)}
            onDelete={() => handleDeleteQuote(activeQuote.id)}
          />
        ) : (
          <>
            {view === "list" && (
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
                engineerName={activeInspection?.engineerName || activeQuote?.engineerName || session.fullName}
                initial={activeInspection || activeQuote}
                saving={saving}
                err={err}
                onCancel={() => {
                  if (activeId && inspections.some((i) => i.id === activeId)) { setView("detail"); return; }
                  if (activeId && quotes.some((q) => q.id === activeId)) { setView("quoteDetail"); return; }
                  setView("quotes");
                }}
                onSave={handleSave}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!username.trim() || !password) return;
    setLoading(true);
    setErr("");
    try {
      await onLogin(username.trim(), password);
    } catch (e) {
      setErr(e.message || "بيانات الدخول غير صحيحة");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="name-gate">
      <User size={26} color="#E8622C" />
      <h2>تسجيل الدخول</h2>
      <p>ادخل اسم المستخدم والباسورد اللي معاك</p>
      {err && <div className="err-banner"><AlertCircle size={16} /> {err}</div>}
      <input
        placeholder="اسم المستخدم"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        type="password"
        placeholder="الباسورد"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn btn-primary btn-block" disabled={loading} onClick={submit}>
        {loading ? <Loader2 className="spin" size={15} /> : <>دخول <ArrowRight size={15} /></>}
      </button>
    </div>
  );
}

function RequestForm({ createdBy, saving, err, onCancel, onSave }) {
  const [siteName, setSiteName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [localErr, setLocalErr] = useState("");

  function submit() {
    if (!siteName.trim() || !clientName.trim()) {
      setLocalErr("اكتب اسم الموقع واسم العميل على الأقل");
      return;
    }
    setLocalErr("");
    onSave({
      id: uid(),
      siteName: siteName.trim(),
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      location: location.trim(),
      notes: notes.trim(),
      createdBy,
      createdAt: Date.now(),
      assignedEngineer: null,
      status: "unassigned",
      linkedInspectionId: null,
    });
  }

  return (
    <div className="form-wrap">
      <div className="eyebrow" style={{ marginBottom: 6 }}>متابعة عملاء</div>
      <h2 style={{ margin: "0 0 18px", fontSize: 18 }}>طلب معاينة جديد</h2>

      {(localErr || err) && <div className="err-banner"><AlertCircle size={15} /> {localErr || err}</div>}

      <div className="form-grid">
        <Field label="اسم الموقع" icon={Building2}>
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="مثال: مركز خدمة السيارات - الهرم" />
        </Field>
        <Field label="اسم العميل" icon={User}>
          <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="اسم العميل" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="رقم تليفون العميل (اختياري)" icon={MessageSquare}>
          <input type="text" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="رقم التليفون" />
        </Field>
        <Field label="العنوان / الموقع (اختياري)" icon={MapPin}>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="العنوان بالتفصيل" />
        </Field>
      </div>
      <Field label="ملاحظات (اختياري)" icon={ClipboardList}>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي تفاصيل إضافية عن الطلب" />
      </Field>

      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onCancel}>إلغاء</button>
        <button className="btn btn-primary" disabled={saving} onClick={submit}>
          {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />} حفظ الطلب
        </button>
      </div>
    </div>
  );
}

const REQ_STATUS_LABEL = {
  unassigned: "لم يتم التخصيص",
  assigned: "مخصصة",
  scheduled: "تم تحديد ميعاد",
  done: "تمت",
};
const REQ_STATUS_CLASS = {
  unassigned: "badge-unassigned",
  assigned: "badge-assigned",
  scheduled: "badge-scheduled",
  done: "badge-done",
};
function reqStatusOf(r) {
  return r.status || (r.assignedEngineer ? "assigned" : "unassigned");
}
const REQ_TABS = [
  { key: "unassigned", label: "مطلوبة" },
  { key: "assigned", label: "مخصصة" },
  { key: "scheduled", label: "محدد لها ميعاد" },
  { key: "done", label: "تمت" },
];

function RequestsList({ mode, items, currentUser, token, onAssign, onUpdateStatus, onStartInspection, onOpenInspection, onDelete }) {
  const [engineerOptions, setEngineerOptions] = useState([]);
  const [subTab, setSubTab] = useState("unassigned");

  useEffect(() => {
    if (mode !== "admin" || !token) return;
    adminListEngineers(token)
      .then((rows) => setEngineerOptions((rows || []).filter((r) => r.role === "engineer")))
      .catch(() => {});
  }, [mode, token]);

  const byStatus = REQ_TABS.reduce((acc, t) => {
    acc[t.key] = items.filter((r) => reqStatusOf(r) === t.key);
    return acc;
  }, {});
  const visibleItems = byStatus[subTab] || [];

  return (
    <div>
      <div className="req-subtabs">
        {REQ_TABS.map((t) => (
          <button key={t.key} className={subTab === t.key ? "active" : ""} onClick={() => setSubTab(t.key)}>
            {t.label} <span className="req-subtab-count">{byStatus[t.key].length}</span>
          </button>
        ))}
      </div>

      {!visibleItems.length ? (
        <p style={{ color: "var(--muted)", fontSize: 13.5, textAlign: "center", marginTop: 30 }}>
          لا توجد طلبات في هذا التصنيف حالياً
        </p>
      ) : (
        <div className="req-list">
          {visibleItems.map((r) => {
            const status = reqStatusOf(r);
            const isMine = mode === "engineer" && r.assignedEngineer === currentUser.fullName;
            return (
              <div className="req-row" key={r.id}>
                <div className="req-row-head">
                  <strong>{r.siteName}</strong>
                  <span className={REQ_STATUS_CLASS[status]}>{REQ_STATUS_LABEL[status]}</span>
                </div>
                {r.assignedEngineer && (
                  <div className="req-row-body">
                    <span><Users size={12} /> {r.assignedEngineer}</span>
                  </div>
                )}
                <div className="req-row-body">
                  <span><User size={12} /> {r.clientName}</span>
                  {r.clientPhone && <span><MessageSquare size={12} /> {r.clientPhone}</span>}
                  {r.location && <span><MapPin size={12} /> {r.location}</span>}
                </div>
                {r.notes && <p className="req-notes">{r.notes}</p>}
                <div className="req-row-foot">
                  <span className="req-meta">بواسطة {r.createdBy} — {fmtDate(r.createdAt)}</span>

                  {mode === "engineer" && !r.assignedEngineer && (
                    <button className="btn btn-primary btn-sm" onClick={() => onAssign(r.id, currentUser.fullName)}>تخصيص لنفسي</button>
                  )}
                  {isMine && status === "assigned" && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onUpdateStatus(r.id, "scheduled")}>تم تحديد ميعاد</button>
                  )}
                  {isMine && (status === "assigned" || status === "scheduled") && (
                    <button className="btn btn-primary btn-sm" onClick={() => onStartInspection(r)}>ابدأ المعاينة</button>
                  )}
                  {isMine && status === "done" && r.linkedInspectionId && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenInspection(r.linkedInspectionId)}>عرض المعاينة</button>
                  )}

                  {mode === "admin" && (
                    <div className="req-admin-actions">
                      <select
                        value={r.assignedEngineer || ""}
                        onChange={(e) => onAssign(r.id, e.target.value || null)}
                      >
                        <option value="">بدون تخصيص</option>
                        {engineerOptions.map((eng) => (
                          <option key={eng.id} value={eng.full_name}>{eng.full_name}</option>
                        ))}
                      </select>
                      {r.linkedInspectionId && (
                        <button className="btn btn-ghost btn-sm" onClick={() => onOpenInspection(r.linkedInspectionId)}>عرض المعاينة</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => onDelete(r.id)}><Trash2 size={13} /></button>
                    </div>
                  )}

                  {mode === "followup" && r.createdBy === currentUser.fullName && (
                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(r.id)}><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminUsers({ token }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState("engineer");
  const [creating, setCreating] = useState(false);
  const [revealPassword, setRevealPassword] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await adminListEngineers(token);
      setList(rows || []);
    } catch (e) {
      setErr("تعذر تحميل قائمة المهندسين");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newUsername.trim() || !newFullName.trim()) return;
    setCreating(true);
    setErr("");
    try {
      const password = await adminCreateEngineer(token, newUsername.trim(), newFullName.trim(), newRole);
      setRevealPassword({ username: newUsername.trim(), password });
      setNewUsername(""); setNewFullName("");
      await load();
    } catch (e) {
      setErr("تعذر إضافة المستخدم، ممكن اسم المستخدم مستخدم بالفعل");
    } finally {
      setCreating(false);
    }
  }

  async function handleReset(id, username) {
    if (!window.confirm(`توليد باسورد جديد لـ ${username}؟ الباسورد القديم هيبقى ملغي`)) return;
    try {
      const password = await adminResetPassword(token, id);
      setRevealPassword({ username, password });
    } catch (e) {
      setErr("تعذر توليد باسورد جديد");
    }
  }

  async function handleDelete(id, username) {
    if (!window.confirm(`هل تريد حذف المهندس ${username} نهائياً؟`)) return;
    try {
      await adminDeleteEngineer(token, id);
      await load();
    } catch (e) {
      setErr("تعذر حذف المهندس");
    }
  }

  return (
    <div>
      <div className="section-head">
        <h2><Users size={16} /> إدارة المستخدمين</h2>
      </div>

      {err && <div className="err-banner"><AlertCircle size={16} /> {err}</div>}

      <div className="user-create-box">
        <input placeholder="اسم المستخدم (بالإنجليزي)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        <input placeholder="الاسم الكامل" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          <option value="engineer">مهندس</option>
          <option value="followup">متابعة عملاء</option>
        </select>
        <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
          {creating ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} إضافة مستخدم
        </button>
      </div>

      {loading ? (
        <div className="boot-loading"><Loader2 className="spin" size={22} /> جارِ التحميل…</div>
      ) : (
        <div className="user-list">
          {list.map((u) => (
            <div className="user-row" key={u.id}>
              <div className="user-row-info">
                <strong>{u.full_name}</strong>
                <span className="user-row-username">{u.username}</span>
                {u.role === "admin" && <span className="badge-admin">أدمن</span>}
                {u.role === "followup" && <span className="badge-assigned">متابعة عملاء</span>}
              </div>
              {u.role !== "admin" && (
                <div className="user-row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => handleReset(u.id, u.username)}>باسورد جديد</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id, u.username)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
          {!list.length && <p style={{ color: "var(--muted)", fontSize: 13.5 }}>لا يوجد مهندسين مضافين بعد</p>}
        </div>
      )}

      {revealPassword && (
        <div className="modal-backdrop" onClick={() => setRevealPassword(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>تم توليد باسورد جديد</h3>
            <p>ابعت البيانات دي للمهندس (اسم المستخدم: <b>{revealPassword.username}</b>):</p>
            <div className="password-reveal">{revealPassword.password}</div>
            <p className="hint">الباسورد ده مش هيتعرض تاني، انسخه دلوقتي</p>
            <button className="btn btn-primary btn-block" onClick={() => setRevealPassword(null)}>تم</button>
          </div>
        </div>
      )}
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
          <p>مفيش معاينات قديمة مسجلة هنا</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((i) => <InspCard key={i.id} insp={i} onClick={() => onOpen(i.id)} />)}
        </div>
      )}
    </>
  );
}

function QuotesList({ items, onOpen }) {
  return (
    <>
      <div className="section-head">
        <h2><FileText size={16} /> المكتب الفني — طلبات عروض الأسعار</h2>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          <FileText size={40} />
          <p>مفيش طلبات عروض أسعار مسجلة لسه</p>
          <p>دوس على "طلب عرض سعر جديد" علشان تبدأ</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((q) => <InspCard key={q.id} insp={q} onClick={() => onOpen(q.id)} />)}
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
            {insp.locationLink && (
              <a href={insp.locationLink} target="_blank" rel="noreferrer" className="mono">
                <MapPin size={12} /> فتح على الخريطة ↗
              </a>
            )}
            {insp.clientPhone && <span><MessageSquare size={12} /> {insp.clientPhone}</span>}
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

      {insp.documents?.length > 0 && (
        <div className="detail-section">
          <h3><FileText size={13} /> المرفقات ({insp.documents.length})</h3>
          <div className="doc-list">
            {insp.documents.map((d) => (
              <a className="doc-row doc-row-link" key={d.id} href={d.url} target="_blank" rel="noreferrer">
                <FileText size={16} />
                <div className="doc-row-info">
                  <span className="doc-row-name">{d.name}</span>
                  <span className="doc-row-size">{fmtFileSize(d.size)}</span>
                </div>
                <Download size={15} />
              </a>
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

      {!insp.photos?.length && !insp.drawings?.length && !insp.documents?.length && !insp.measurements?.length && !insp.requests && !insp.notes && (
        <div className="empty-state"><p>مفيش تفاصيل مسجلة في المعاينة دي</p></div>
      )}
    </div>
  );
}

function InspectionForm({ engineerName, initial, saving, err, onCancel, onSave }) {
  const [siteName, setSiteName] = useState(initial?.siteName || "");
  const [date, setDate] = useState(initial?.date || today());
  const [location, setLocation] = useState(initial?.location || "");
  const [locationLink, setLocationLink] = useState(initial?.locationLink || "");
  const [clientPhone, setClientPhone] = useState(initial?.clientPhone || "");
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState(initial?.photos || []);
  const [drawings, setDrawings] = useState(initial?.drawings || []);
  const [documents, setDocuments] = useState(initial?.documents || []);
  const [measurements, setMeasurements] = useState(initial?.measurements || []);
  const [requests, setRequests] = useState(initial?.requests || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [uploading, setUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [localErr, setLocalErr] = useState("");
  const photoInput = useRef(null);
  const drawInput = useRef(null);
  const docInput = useRef(null);

  async function handleDocFiles(files) {
    setDocUploading(true);
    setLocalErr("");
    try {
      const arr = Array.from(files).slice(0, 10);
      const results = await Promise.all(arr.map((f) => uploadDocumentToStorage(f)));
      setDocuments((prev) => [...prev, ...results]);
    } catch (e) {
      setLocalErr(e.message || "تعذر رفع أحد الملفات");
    } finally {
      setDocUploading(false);
    }
  }

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

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocalErr("المتصفح ده مش بيدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    setLocalErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocationLink(`https://www.google.com/maps?q=${latitude},${longitude}`);
        setLocating(false);
      },
      () => {
        setLocalErr("تعذر تحديد موقعك، تأكد إنك سمحت للمتصفح بالوصول للموقع");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function submit() {
    if (!siteName.trim()) { setLocalErr("من فضلك اكتب اسم الموقع"); return; }
    if (!clientPhone.trim()) { setLocalErr("من فضلك اكتب رقم تليفون العميل"); return; }
    const record = {
      id: initial?.id || uid(),
      engineerName: initial?.engineerName || engineerName,
      siteName: siteName.trim(),
      date, location: location.trim(), locationLink: locationLink.trim(),
      clientPhone: clientPhone.trim(),
      photos, drawings, documents,
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
      <div className="form-grid">
        <Field label="رقم تليفون العميل" icon={MessageSquare}>
          <input type="text" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="رقم التليفون" />
        </Field>
        <Field label="العنوان / الموقع (اختياري)" icon={MapPin}>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="العنوان بالتفصيل" />
        </Field>
      </div>
      <Field label="لينك اللوكيشن (اختياري)" icon={MapPin}>
        <div className="location-link-row">
          <input type="text" value={locationLink} onChange={(e) => setLocationLink(e.target.value)} placeholder="هيتحط تلقائي أو الصق رابط جوجل مابس" />
          <button type="button" className="btn btn-ghost btn-sm" disabled={locating} onClick={useCurrentLocation}>
            {locating ? <Loader2 className="spin" size={14} /> : <MapPin size={14} />} موقعي الحالي
          </button>
        </div>
        {locationLink && (
          <a href={locationLink} target="_blank" rel="noreferrer" className="location-link-preview">فتح على الخريطة ↗</a>
        )}
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
        <FileText size={13} style={{ verticalAlign: "-2px", marginLeft: 6 }} />المرفقات
      </h3>
      <div className="upload-zone" onClick={() => docInput.current?.click()}>
        {docUploading ? <Loader2 className="spin" size={20} style={{ marginBottom: 6 }} /> : <Upload size={20} style={{ marginBottom: 6 }} />}
        <br />
        ارفع ملفات Word أو Excel أو PDF أو DWG
        <input
          ref={docInput} type="file" multiple hidden
          accept=".doc,.docx,.xls,.xlsx,.pdf,.dwg,.dxf"
          onChange={(e) => e.target.files.length && handleDocFiles(e.target.files)}
        />
      </div>
      {documents.length > 0 && (
        <div className="doc-list">
          {documents.map((d) => (
            <div className="doc-row" key={d.id}>
              <FileText size={16} />
              <div className="doc-row-info">
                <span className="doc-row-name">{d.name}</span>
                <span className="doc-row-size">{fmtFileSize(d.size)}</span>
              </div>
              <button className="rm" onClick={() => setDocuments((ds) => ds.filter((x) => x.id !== d.id))}><X size={13} /></button>
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
