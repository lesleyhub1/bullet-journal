import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Circle, Minus, Star, X, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight,
  CalendarDays, CalendarRange, BookOpen, Settings, Plus, Check, Sparkles,
  Download, Upload, Trash2, Link2, ChevronDown, Sun, CloudSun, Cloud,
  CloudRain, CloudLightning, Menu, ArrowUpRight, Layers
} from "lucide-react";

/* ============================================================================
   BULLET JOURNAL — a local-first, analog-inspired daily planner PWA
   ----------------------------------------------------------------------------
   Data model (IndexedDB, database "bujo-db"):
     entries      { id, text, type, priority, completed, struck, date(YYYY-MM-DD),
                    monthKey(YYYY-MM), futureKey(YYYY-MM), collectionId, threadId,
                    createdAt, order }
     collections  { id, name, icon, createdAt }
     meta         { key: "mood-YYYY-MM-DD", value: 1-5 }  (and other small kv pairs)
   Entry.type ∈ "task" | "event" | "note"
   Entry.status (tasks only) ∈ "open" | "done" | "migrated" | "scheduled" | "irrelevant"
   ============================================================================ */

// ---------------------------------------------------------------------------
// IndexedDB — tiny promise wrapper, no external dependency
// ---------------------------------------------------------------------------
const DB_NAME = "bujo-db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        const store = db.createObjectStore("entries", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("monthKey", "monthKey", { unique: false });
        store.createIndex("futureKey", "futureKey", { unique: false });
        store.createIndex("collectionId", "collectionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("collections")) {
        db.createObjectStore("collections", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

function getAll(storeName) {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const t = db.transaction(storeName, "readonly");
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

const dbPut = (storeName, value) => tx(storeName, "readwrite", (s) => s.put(value));
const dbDelete = (storeName, id) => tx(storeName, "readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const pad2 = (n) => String(n).padStart(2, "0");
const toDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toMonthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function haptic(pattern = 10) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

function daysInMonth(year, monthIdx0) {
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

// ---------------------------------------------------------------------------
// Signifier glyphs
// ---------------------------------------------------------------------------
function Signifier({ entry, size = 18 }) {
  const stroke = "var(--ink)";
  if (entry.type === "task") {
    if (entry.status === "done") return <Check size={size} strokeWidth={2.4} className="text-[var(--accent-done)]" />;
    if (entry.status === "migrated") return <ArrowRight size={size} strokeWidth={2.2} className="text-[var(--accent-event)]" />;
    if (entry.status === "scheduled") return <ArrowLeft size={size} strokeWidth={2.2} className="text-[var(--accent-event)]" />;
    if (entry.status === "irrelevant") return <Minus size={size} strokeWidth={2.2} className="text-[var(--ink-faint)] rotate-45" />;
    return <span className="block rounded-full" style={{ width: size * 0.42, height: size * 0.42, background: "var(--ink)" }} />;
  }
  if (entry.type === "event") return <Circle size={size * 0.62} strokeWidth={2.2} className="text-[var(--ink)]" />;
  return <Minus size={size * 0.8} strokeWidth={2.4} className="text-[var(--ink)]" />;
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------
export default function App() {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState([]);
  const [collections, setCollections] = useState([]);
  const [meta, setMeta] = useState({});
  const [view, setView] = useState("daily"); // daily | monthly | future | collections | collection | settings
  const [activeDate, setActiveDate] = useState(new Date());
  const [activeMonth, setActiveMonth] = useState(new Date());
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState(null); // entry id awaiting month pick
  const [threadPickerFor, setThreadPickerFor] = useState(null); // entry id awaiting collection pick
  const [toast, setToast] = useState(null);

  // -- boot: load everything from IndexedDB -----------------------------
  const reload = useCallback(async () => {
    const [e, c, m] = await Promise.all([getAll("entries"), getAll("collections"), getAll("meta")]);
    setEntries(e);
    setCollections(c.sort((a, b) => a.createdAt - b.createdAt));
    const metaObj = {};
    m.forEach((row) => { metaObj[row.key] = row.value; });
    setMeta(metaObj);
  }, []);

  useEffect(() => {
    reload().then(() => setReady(true));
  }, [reload]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  // -- entry CRUD ----------------------------------------------------------
  const createEntry = async ({ text, type, priority }) => {
    if (!text.trim()) return;
    const now = new Date();
    const entry = {
      id: uid(),
      text: text.trim(),
      type,
      priority: !!priority,
      status: type === "task" ? "open" : undefined,
      date: toDateKey(activeDate),
      monthKey: toMonthKey(activeDate),
      futureKey: null,
      collectionId: view === "collection" ? activeCollectionId : null,
      threadId: null,
      createdAt: now.getTime(),
      order: now.getTime(),
    };
    await dbPut("entries", entry);
    setEntries((prev) => [...prev, entry]);
    haptic(8);
  };

  const updateEntry = async (id, patch) => {
    setEntries((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e));
      const found = next.find((e) => e.id === id);
      if (found) dbPut("entries", found);
      return next;
    });
  };

  const removeEntry = async (id) => {
    await dbDelete("entries", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    haptic(6);
  };

  const setMood = async (dateKey, value) => {
    const key = `mood-${dateKey}`;
    await dbPut("meta", { key, value });
    setMeta((prev) => ({ ...prev, [key]: value }));
    haptic(8);
  };

  const createCollection = async (name) => {
    if (!name.trim()) return null;
    const col = { id: uid(), name: name.trim(), createdAt: Date.now() };
    await dbPut("collections", col);
    setCollections((prev) => [...prev, col]);
    return col.id;
  };

  const deleteCollection = async (id) => {
    await dbDelete("collections", id);
    setCollections((prev) => prev.filter((c) => c.id !== id));
    // detach threads pointing at this collection
    const affected = entries.filter((e) => e.threadId === id);
    for (const e of affected) await updateEntry(e.id, { threadId: null });
  };

  // -- task lifecycle actions (used by reflection + inline swipe) ----------
  const completeTask = (id) => { updateEntry(id, { status: "done" }); haptic([10, 30, 10]); };
  const migrateTask = async (id, toDateKey_ = null) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await updateEntry(id, { status: "migrated" });
    const target = toDateKey_ || toDateKey(addDays(new Date(e.date + "T00:00:00"), 1));
    const clone = {
      id: uid(), text: e.text, type: "task", priority: e.priority, status: "open",
      date: target, monthKey: target.slice(0, 7), futureKey: null,
      collectionId: e.collectionId, threadId: e.threadId,
      createdAt: Date.now(), order: Date.now(),
    };
    await dbPut("entries", clone);
    setEntries((prev) => [...prev, clone]);
    haptic([10, 20, 10]);
  };
  const scheduleTask = async (id, futureKey) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await updateEntry(id, { status: "scheduled" });
    const clone = {
      id: uid(), text: e.text, type: "task", priority: e.priority, status: "open",
      date: null, monthKey: null, futureKey,
      collectionId: e.collectionId, threadId: e.threadId,
      createdAt: Date.now(), order: Date.now(),
    };
    await dbPut("entries", clone);
    setEntries((prev) => [...prev, clone]);
    haptic([10, 20, 10]);
  };
  const markIrrelevant = (id) => { updateEntry(id, { status: "irrelevant" }); haptic(14); };

  // -- backup export / import ----------------------------------------------
  const exportBackup = () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), entries, collections, meta };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bujo-backup-${toDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("Backup exported");
  };

  const importBackup = async (file) => {
    const text = await file.text();
    try {
      const payload = JSON.parse(text);
      for (const e of payload.entries || []) await dbPut("entries", e);
      for (const c of payload.collections || []) await dbPut("collections", c);
      for (const k of Object.keys(payload.meta || {})) await dbPut("meta", { key: k, value: payload.meta[k] });
      await reload();
      flash("Backup restored");
    } catch (err) {
      flash("Import failed — invalid file");
    }
  };

  // -- derived data ----------------------------------------------------------
  const dateKey = toDateKey(activeDate);
  const monthKey = toMonthKey(activeMonth);
  const dayEntries = useMemo(
    () => entries.filter((e) => e.date === dateKey).sort((a, b) => a.order - b.order),
    [entries, dateKey]
  );
  const monthTaskEntries = useMemo(
    () => entries.filter((e) => e.monthKey === monthKey && !e.date && e.type === "task"),
    [entries, monthKey]
  );
  const monthDayEntries = useMemo(
    () => entries.filter((e) => e.date && e.date.startsWith(monthKey)),
    [entries, monthKey]
  );

  if (!ready) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[var(--paper)]">
        <div className="text-[var(--ink-faint)] font-mono text-sm tracking-widest animate-pulse">OPENING JOURNAL…</div>
      </div>
    );
  }

  const activeCollection = collections.find((c) => c.id === activeCollectionId) || null;

  return (
    <div className="bujo-root h-screen w-full flex flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
      <StyleSheet />
      <TopBar
        view={view}
        setView={setView}
        activeDate={activeDate}
        activeCollection={activeCollection}
        onBack={() => { setView("collections"); setActiveCollectionId(null); }}
      />

      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pb-40">
        {view === "daily" && (
          <DailyLog
            activeDate={activeDate}
            setActiveDate={setActiveDate}
            entries={dayEntries}
            mood={meta[`mood-${dateKey}`]}
            setMood={(v) => setMood(dateKey, v)}
            onToggleTask={(e) => (e.status === "done" ? updateEntry(e.id, { status: "open" }) : completeTask(e.id))}
            onDelete={removeEntry}
            onMigrate={migrateTask}
            onSchedule={(id) => setScheduleFor(id)}
            onIrrelevant={markIrrelevant}
            onOpenReflection={() => setReflectionOpen(true)}
            onThread={(id) => setThreadPickerFor(id)}
            collections={collections}
            onJumpToCollection={(id) => { setActiveCollectionId(id); setView("collection"); }}
          />
        )}

        {view === "monthly" && (
          <MonthlyLog
            activeMonth={activeMonth}
            setActiveMonth={setActiveMonth}
            dayEntries={monthDayEntries}
            taskEntries={monthTaskEntries}
            onJumpToDay={(dk) => { setActiveDate(new Date(dk + "T00:00:00")); setView("daily"); }}
            onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
            onDelete={removeEntry}
          />
        )}

        {view === "future" && (
          <FutureLog
            entries={entries.filter((e) => e.futureKey && e.type === "task")}
            onAdd={async (futureKey, text) => {
              if (!text.trim()) return;
              const entry = {
                id: uid(), text: text.trim(), type: "task", priority: false, status: "open",
                date: null, monthKey: null, futureKey, collectionId: null, threadId: null,
                createdAt: Date.now(), order: Date.now(),
              };
              await dbPut("entries", entry);
              setEntries((prev) => [...prev, entry]);
              haptic(8);
            }}
            onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
            onDelete={removeEntry}
            onOpenMonth={(fk) => {
              const [y, m] = fk.split("-").map(Number);
              setActiveMonth(new Date(y, m - 1, 1));
              setView("monthly");
            }}
          />
        )}

        {view === "collections" && (
          <CollectionsIndex
            collections={collections}
            entries={entries}
            onOpen={(id) => { setActiveCollectionId(id); setView("collection"); }}
            onCreate={createCollection}
            onDelete={deleteCollection}
          />
        )}

        {view === "collection" && activeCollection && (
          <CollectionPage
            collection={activeCollection}
            entries={entries.filter((e) => e.collectionId === activeCollection.id)}
            onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
            onDelete={removeEntry}
          />
        )}

        {view === "settings" && (
          <SettingsPage onExport={exportBackup} onImport={importBackup} entryCount={entries.length} collectionCount={collections.length} />
        )}
      </main>

      {(view === "daily" || view === "collection") && (
        <RapidLogBar
          onSubmit={(payload) => createEntry(payload)}
          placeholder={view === "collection" ? `Add to ${activeCollection?.name || "collection"}…` : "Log it…"}
        />
      )}

      <BottomNav view={view} setView={setView} />

      {reflectionOpen && (
        <ReflectionMode
          entries={dayEntries.filter((e) => e.type === "task" && e.status === "open")}
          onComplete={completeTask}
          onMigrate={(id) => migrateTask(id)}
          onSchedule={(id) => setScheduleFor(id)}
          onIrrelevant={markIrrelevant}
          onClose={() => setReflectionOpen(false)}
        />
      )}

      {scheduleFor && (
        <MonthPickerModal
          onPick={(fk) => { scheduleTask(scheduleFor, fk); setScheduleFor(null); }}
          onClose={() => setScheduleFor(null)}
        />
      )}

      {threadPickerFor && (
        <ThreadPickerModal
          collections={collections}
          onCreate={async (name) => {
            const id = await createCollection(name);
            if (id) { await updateEntry(threadPickerFor, { threadId: id }); }
            setThreadPickerFor(null);
          }}
          onPick={(id) => { updateEntry(threadPickerFor, { threadId: id }); setThreadPickerFor(null); }}
          onClose={() => setThreadPickerFor(null)}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-sm font-medium shadow-lg animate-fadein">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global stylesheet — paper / dot-grid aesthetic, injected once
// ---------------------------------------------------------------------------
function StyleSheet() {
  return (
    <style>{`
      :root {
        --paper: #F6F2E8;
        --paper-card: #FBF8F1;
        --ink: #2A2620;
        --ink-faint: #948C7C;
        --rule: #DED5C0;
        --accent-priority: #8B3A3A;
        --accent-event: #35506B;
        --accent-done: #4B6350;
      }
      .bujo-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background-image: radial-gradient(var(--rule) 1px, transparent 1px);
        background-size: 18px 18px;
        padding-top: env(safe-area-inset-top);
        overscroll-behavior-y: contain;
      }
      .font-serif-display { font-family: 'Newsreader', Georgia, serif; }
      .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
      * { -webkit-tap-highlight-color: transparent; }
      input, textarea { font-family: inherit; }
      @keyframes fadein { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: translateY(0);} }
      .animate-fadein { animation: fadein .25s ease-out; }
      @keyframes strike { from { width: 0; } to { width: 100%; } }
      .strike-line { position: relative; }
      .strike-line::after {
        content: ""; position: absolute; left: 0; top: 50%; height: 1px;
        background: var(--ink-faint); animation: strike .3s ease-out forwards;
      }
      ::-webkit-scrollbar { display: none; }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function TopBar({ view, activeDate, activeCollection, onBack }) {
  const titleMap = {
    daily: activeDate.toLocaleDateString(undefined, { weekday: "long" }),
    monthly: "Monthly Log",
    future: "Future Log",
    collections: "Collections",
    collection: activeCollection?.name || "Collection",
    settings: "Settings",
  };
  return (
    <header className="shrink-0 pt-3 px-5 pb-3 flex items-center justify-between" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
      <div className="flex items-center gap-2">
        {view === "collection" && (
          <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-black/5" style={{ minWidth: 44, minHeight: 44 }}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div>
          <h1 className="font-serif-display text-2xl leading-tight">{titleMap[view]}</h1>
          {view === "daily" && (
            <p className="font-mono text-xs text-[var(--ink-faint)] tracking-wide">
              {activeDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </div>
      <div className="w-2 h-2 rounded-full bg-[var(--accent-priority)]" />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation
// ---------------------------------------------------------------------------
function BottomNav({ view, setView }) {
  const items = [
    { key: "daily", icon: CalendarDays, label: "Day" },
    { key: "monthly", icon: CalendarRange, label: "Month" },
    { key: "future", icon: Layers, label: "Future" },
    { key: "collections", icon: BookOpen, label: "Index" },
    { key: "settings", icon: Settings, label: "Settings" },
  ];
  return (
    <nav
      className="shrink-0 border-t border-[var(--rule)] bg-[var(--paper-card)]/95 backdrop-blur flex items-stretch"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map(({ key, icon: Icon, label }) => {
        const active = view === key || (key === "collections" && view === "collection");
        return (
          <button
            key={key}
            onClick={() => setView(key)}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2 active:opacity-60"
            style={{ minHeight: 52 }}
          >
            <Icon size={20} strokeWidth={active ? 2.4 : 1.8} className={active ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"} />
            <span className={`text-[10px] font-mono tracking-wide ${active ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Rapid Logging Console — bottom docked sticky input
// ---------------------------------------------------------------------------
const TYPE_OPTIONS = [
  { key: "task", label: "Task", glyph: "•" },
  { key: "event", label: "Event", glyph: "○" },
  { key: "note", label: "Note", glyph: "—" },
];
const PREFIX_MAP = { "•": "task", "*": "task", "○": "event", "o": "event", "—": "note", "-": "note" };

function RapidLogBar({ onSubmit, placeholder }) {
  const [text, setText] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState(false);
  const inputRef = useRef(null);

  const handleChange = (val) => {
    // auto-detect leading prefix and strip it
    const first = val.trim()[0];
    if (val.length === 1 && PREFIX_MAP[first]) {
      setType(PREFIX_MAP[first]);
      if (first === "*") setPriority(true);
      setText("");
      return;
    }
    setText(val);
  };

  const submit = () => {
    if (!text.trim()) return;
    onSubmit({ text, type, priority });
    setText("");
    setPriority(false);
  };

  return (
    <div
      className="fixed left-0 right-0 z-40 bg-[var(--paper-card)] border-t border-[var(--rule)] px-3 pt-2"
      style={{ bottom: 52, paddingBottom: "calc(env(safe-area-inset-bottom) + 4px)" }}
    >
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setType(opt.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 flex items-center gap-1.5 ${
              type === opt.key
                ? "bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]"
                : "bg-transparent text-[var(--ink-faint)] border-[var(--rule)]"
            }`}
            style={{ minHeight: 30 }}
          >
            <span className="font-mono">{opt.glyph}</span>{opt.label}
          </button>
        ))}
        <button
          onClick={() => setPriority((p) => !p)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 flex items-center gap-1 ${
            priority ? "bg-[var(--accent-priority)] text-white border-[var(--accent-priority)]" : "bg-transparent text-[var(--ink-faint)] border-[var(--rule)]"
          }`}
          style={{ minHeight: 30 }}
        >
          <Star size={12} fill={priority ? "white" : "none"} /> Priority
        </button>
      </div>
      <div className="flex items-end gap-2 pb-2">
        <div className="flex-1 flex items-center gap-2 bg-[var(--paper)] rounded-2xl border border-[var(--rule)] px-3" style={{ minHeight: 44 }}>
          <span className="font-mono text-[var(--ink-faint)] w-4 text-center">
            {type === "task" ? "•" : type === "event" ? "○" : "—"}
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none py-2.5 text-[15px]"
            enterKeyHint="done"
          />
        </div>
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-2xl bg-[var(--ink)] text-[var(--paper)] flex items-center justify-center disabled:opacity-30"
          style={{ width: 44, height: 44 }}
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry row — shared across Daily/Monthly/Collection views
// ---------------------------------------------------------------------------
function EntryRow({ entry, onToggleTask, onDelete, onMigrate, onSchedule, onIrrelevant, onThread, collections, onJumpToCollection, compact }) {
  const [open, setOpen] = useState(false);
  const isDone = entry.status === "done";
  const isMuted = entry.status === "migrated" || entry.status === "scheduled" || entry.status === "irrelevant";
  const thread = entry.threadId ? collections.find((c) => c.id === entry.threadId) : null;

  return (
    <div className="group">
      <div
        className={`flex items-start gap-3 py-2.5 ${compact ? "" : "border-b border-[var(--rule)]/70"}`}
        onClick={() => entry.type === "task" && !isMuted && setOpen((o) => !o)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); entry.type === "task" && !isMuted && onToggleTask(entry); }}
          className="mt-0.5 shrink-0 flex items-center justify-center"
          style={{ width: 24, height: 24 }}
        >
          <Signifier entry={entry} />
        </button>
        <div className="flex-1 min-w-0">
          <p
            className={`text-[15px] leading-snug break-words ${isDone || isMuted ? "text-[var(--ink-faint)]" : "text-[var(--ink)]"} ${
              entry.status === "irrelevant" ? "line-through decoration-1" : ""
            }`}
          >
            {entry.priority && <Star size={13} className="inline mr-1 -mt-0.5 text-[var(--accent-priority)]" fill="var(--accent-priority)" />}
            {entry.text}
          </p>
          {thread && (
            <button
              onClick={(e) => { e.stopPropagation(); onJumpToCollection && onJumpToCollection(thread.id); }}
              className="mt-1 flex items-center gap-1 text-[11px] font-mono text-[var(--accent-event)]"
            >
              <Link2 size={11} /> {thread.name} <ArrowUpRight size={11} />
            </button>
          )}
        </div>
        {entry.type === "task" && !isMuted && (
          <ChevronDown size={16} className={`text-[var(--ink-faint)] mt-1 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </div>

      {open && entry.type === "task" && !isMuted && (
        <div className="flex flex-wrap gap-2 pb-3 pl-9 animate-fadein">
          <ActionChip icon={ArrowRight} label="Migrate" onClick={() => { onMigrate(entry.id); setOpen(false); }} />
          <ActionChip icon={ArrowLeft} label="Schedule" onClick={() => { onSchedule(entry.id); setOpen(false); }} />
          <ActionChip icon={Minus} label="Irrelevant" onClick={() => { onIrrelevant(entry.id); setOpen(false); }} />
          {onThread && <ActionChip icon={Link2} label="Thread" onClick={() => { onThread(entry.id); setOpen(false); }} />}
          <ActionChip icon={Trash2} label="Delete" danger onClick={() => { onDelete(entry.id); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

function ActionChip({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${
        danger ? "border-[var(--accent-priority)] text-[var(--accent-priority)]" : "border-[var(--rule)] text-[var(--ink)]"
      }`}
      style={{ minHeight: 32 }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Daily Log
// ---------------------------------------------------------------------------
const MOOD_ICONS = [Cloud, CloudRain, CloudSun, Sun, Sparkles];

function DailyLog({ activeDate, setActiveDate, entries, mood, setMood, onToggleTask, onDelete, onMigrate, onSchedule, onIrrelevant, onOpenReflection, onThread, collections, onJumpToCollection }) {
  const openTaskCount = entries.filter((e) => e.type === "task" && e.status === "open").length;
  return (
    <div>
      <div className="flex items-center justify-between py-2">
        <button onClick={() => setActiveDate(addDays(activeDate, -1))} className="p-2 active:opacity-50" style={{ minWidth: 44, minHeight: 44 }}>
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setActiveDate(new Date())} className="font-mono text-xs text-[var(--ink-faint)] px-3 py-1.5 rounded-full border border-[var(--rule)]">
          Today
        </button>
        <button onClick={() => setActiveDate(addDays(activeDate, 1))} className="p-2 active:opacity-50" style={{ minWidth: 44, minHeight: 44 }}>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="flex items-center justify-center gap-3 py-3">
        {MOOD_ICONS.map((Icon, i) => {
          const val = i + 1;
          const active = mood === val;
          return (
            <button key={val} onClick={() => setMood(val)} style={{ width: 40, height: 40 }} className="flex items-center justify-center rounded-full active:scale-95">
              <Icon size={20} className={active ? "text-[var(--accent-event)]" : "text-[var(--ink-faint)]/50"} strokeWidth={active ? 2.2 : 1.6} />
            </button>
          );
        })}
      </div>

      <div className="mt-2 rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] px-4 pt-1">
        {entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--ink-faint)]">A blank page. Log your first bullet below.</p>
        ) : (
          entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onToggleTask={onToggleTask}
              onDelete={onDelete}
              onMigrate={onMigrate}
              onSchedule={onSchedule}
              onIrrelevant={onIrrelevant}
              onThread={onThread}
              collections={collections}
              onJumpToCollection={onJumpToCollection}
            />
          ))
        )}
      </div>

      {openTaskCount > 0 && (
        <button
          onClick={onOpenReflection}
          className="w-full mt-4 rounded-2xl bg-[var(--ink)] text-[var(--paper)] py-3.5 flex items-center justify-center gap-2 font-medium active:opacity-90"
        >
          <Sparkles size={16} /> End of Day Reflection ({openTaskCount})
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly Log — dual pane: date list (left) + monthly tasks (right, stacked on mobile)
// ---------------------------------------------------------------------------
function MonthlyLog({ activeMonth, setActiveMonth, dayEntries, taskEntries, onJumpToDay, onToggleTask, onDelete }) {
  const year = activeMonth.getFullYear();
  const monthIdx = activeMonth.getMonth();
  const total = daysInMonth(year, monthIdx);
  const rows = Array.from({ length: total }, (_, i) => i + 1);

  const entriesByDay = useMemo(() => {
    const map = {};
    dayEntries.forEach((e) => {
      const d = Number(e.date.slice(8, 10));
      (map[d] = map[d] || []).push(e);
    });
    return map;
  }, [dayEntries]);

  return (
    <div>
      <div className="flex items-center justify-between py-2">
        <button onClick={() => setActiveMonth(addMonths(activeMonth, -1))} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><ChevronLeft size={20} /></button>
        <h2 className="font-serif-display text-xl">{MONTH_NAMES[monthIdx]} {year}</h2>
        <button onClick={() => setActiveMonth(addMonths(activeMonth, 1))} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><ChevronRight size={20} /></button>
      </div>

      <section className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] mb-4 overflow-hidden">
        <h3 className="font-mono text-[11px] tracking-widest text-[var(--ink-faint)] px-4 pt-3 pb-1">CALENDAR</h3>
        <div className="px-2 pb-2">
          {rows.map((d) => {
            const date = new Date(year, monthIdx, d);
            const dow = WEEKDAY_LETTERS[date.getDay()];
            const items = entriesByDay[d] || [];
            const dk = toDateKey(date);
            return (
              <button
                key={d}
                onClick={() => onJumpToDay(dk)}
                className="w-full flex items-center gap-3 px-2 py-2 border-b border-[var(--rule)]/60 last:border-b-0 text-left active:bg-black/5"
                style={{ minHeight: 40 }}
              >
                <span className="font-mono text-xs text-[var(--ink-faint)] w-8 shrink-0">{d} {dow}</span>
                <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
                  {items.length === 0 ? (
                    <span className="text-[13px] text-[var(--ink-faint)]/50">—</span>
                  ) : (
                    items.slice(0, 3).map((it) => (
                      <span key={it.id} className="text-[13px] truncate flex items-center gap-1">
                        <Signifier entry={it} size={11} />
                        <span className="truncate max-w-[90px]">{it.text}</span>
                      </span>
                    ))
                  )}
                  {items.length > 3 && <span className="text-[11px] text-[var(--ink-faint)]">+{items.length - 3}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] px-4 pt-1">
        <h3 className="font-mono text-[11px] tracking-widest text-[var(--ink-faint)] pt-3 pb-1">MONTHLY TASKS</h3>
        {taskEntries.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ink-faint)]">No open-ended items this month.</p>
        ) : (
          taskEntries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onToggleTask={onToggleTask} onDelete={onDelete} onMigrate={() => {}} onSchedule={() => {}} onIrrelevant={() => {}} collections={[]} compact />
          ))
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Future Log — 12 month grid
// ---------------------------------------------------------------------------
function FutureLog({ entries, onAdd, onToggleTask, onDelete, onOpenMonth }) {
  const [openMonth, setOpenMonth] = useState(null);
  const [draft, setDraft] = useState("");
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(now, i));

  const byKey = useMemo(() => {
    const map = {};
    entries.forEach((e) => { (map[e.futureKey] = map[e.futureKey] || []).push(e); });
    return map;
  }, [entries]);

  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      {months.map((m) => {
        const fk = toMonthKey(m);
        const items = byKey[fk] || [];
        const isOpen = openMonth === fk;
        return (
          <div key={fk} className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] p-3 col-span-1">
            <button className="w-full flex items-center justify-between mb-1" onClick={() => setOpenMonth(isOpen ? null : fk)}>
              <span className="font-serif-display text-base">{MONTH_NAMES[m.getMonth()].slice(0, 3)}</span>
              <span className="font-mono text-[10px] text-[var(--ink-faint)]">{items.length}</span>
            </button>
            <div className="space-y-1 mb-2">
              {items.slice(0, isOpen ? undefined : 3).map((it) => (
                <div key={it.id} className="flex items-center gap-1.5">
                  <button onClick={() => onToggleTask(it)}><Signifier entry={it} size={13} /></button>
                  <span className={`text-[12px] truncate ${it.status === "done" ? "text-[var(--ink-faint)] line-through" : ""}`}>{it.text}</span>
                </div>
              ))}
              {!isOpen && items.length > 3 && <p className="text-[10px] text-[var(--ink-faint)] font-mono">+{items.length - 3} more</p>}
            </div>
            {isOpen && (
              <div className="flex items-center gap-1 mt-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onAdd(fk, draft); setDraft(""); } }}
                  placeholder="Add item…"
                  className="flex-1 bg-[var(--paper)] rounded-lg px-2 py-1.5 text-xs border border-[var(--rule)] outline-none"
                />
                <button
                  onClick={() => { onAdd(fk, draft); setDraft(""); }}
                  className="rounded-lg bg-[var(--ink)] text-[var(--paper)] p-1.5"
                  style={{ width: 30, height: 30 }}
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collections index + collection page (with threading)
// ---------------------------------------------------------------------------
function CollectionsIndex({ collections, entries, onOpen, onCreate, onDelete }) {
  const [name, setName] = useState("");
  return (
    <div>
      <div className="flex items-center gap-2 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onCreate(name); setName(""); } }}
          placeholder="New collection name…"
          className="flex-1 bg-[var(--paper-card)] border border-[var(--rule)] rounded-xl px-3 py-2.5 text-sm outline-none"
        />
        <button
          onClick={() => { onCreate(name); setName(""); }}
          className="rounded-xl bg-[var(--ink)] text-[var(--paper)] flex items-center justify-center"
          style={{ width: 44, height: 44 }}
        >
          <Plus size={18} />
        </button>
      </div>

      {collections.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--ink-faint)]">No collections yet — create an index page for a project, book list, or anything worth tracking on its own page.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {collections.map((c) => {
            const count = entries.filter((e) => e.collectionId === c.id).length;
            const threadCount = entries.filter((e) => e.threadId === c.id).length;
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] px-4 py-3">
                <button onClick={() => onOpen(c.id)} className="flex-1 text-left">
                  <p className="font-serif-display text-base">{c.name}</p>
                  <p className="font-mono text-[10px] text-[var(--ink-faint)]">
                    {count} item{count !== 1 ? "s" : ""}{threadCount ? ` · linked from ${threadCount}` : ""}
                  </p>
                </button>
                <button onClick={() => onDelete(c.id)} className="p-2 text-[var(--ink-faint)]" style={{ minWidth: 40, minHeight: 40 }}>
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollectionPage({ collection, entries, onToggleTask, onDelete }) {
  return (
    <div className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] px-4 pt-1 mt-2">
      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--ink-faint)]">This page is empty. Log something below.</p>
      ) : (
        entries
          .sort((a, b) => a.order - b.order)
          .map((entry) => (
            <EntryRow key={entry.id} entry={entry} onToggleTask={onToggleTask} onDelete={onDelete} onMigrate={() => {}} onSchedule={() => {}} onIrrelevant={() => {}} collections={[]} compact />
          ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — backup export / import
// ---------------------------------------------------------------------------
function SettingsPage({ onExport, onImport, entryCount, collectionCount }) {
  const fileRef = useRef(null);
  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] p-4">
        <h3 className="font-mono text-[11px] tracking-widest text-[var(--ink-faint)] mb-2">JOURNAL</h3>
        <p className="text-sm">{entryCount} bullets logged across {collectionCount} collections.</p>
        <p className="text-xs text-[var(--ink-faint)] mt-1">Everything lives in this device's IndexedDB storage — nothing leaves your phone.</p>
      </div>

      <div className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] p-4 space-y-3">
        <h3 className="font-mono text-[11px] tracking-widest text-[var(--ink-faint)]">BACKUP</h3>
        <button onClick={onExport} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--ink)] text-[var(--paper)] py-3 font-medium">
          <Download size={16} /> Export backup JSON
        </button>
        <button onClick={() => fileRef.current?.click()} className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--rule)] py-3 font-medium">
          <Upload size={16} /> Import backup JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
      </div>

      <div className="rounded-2xl bg-[var(--paper-card)] border border-[var(--rule)] p-4">
        <h3 className="font-mono text-[11px] tracking-widest text-[var(--ink-faint)] mb-2">ABOUT</h3>
        <p className="text-xs text-[var(--ink-faint)] leading-relaxed">
          A digital rendition of the analog bullet journal method. Rapid log, migrate honestly, and let go of what no longer matters.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reflection Mode — full-screen ritual, one task at a time
// ---------------------------------------------------------------------------
function ReflectionMode({ entries, onComplete, onMigrate, onSchedule, onIrrelevant, onClose }) {
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(entries);

  useEffect(() => { setRemaining(entries); }, []); // eslint-disable-line

  const current = remaining[index];

  const advance = () => {
    if (index >= remaining.length - 1) onClose();
    else setIndex((i) => i + 1);
  };

  const act = (fn) => (id) => { fn(id); advance(); };

  if (!current) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--ink)] text-[var(--paper)] flex flex-col items-center justify-center px-8">
        <Sparkles size={32} className="mb-4" />
        <p className="font-serif-display text-xl text-center mb-6">Page cleared. Well done.</p>
        <button onClick={onClose} className="px-6 py-3 rounded-full border border-[var(--paper)]/40">Close</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ink)] text-[var(--paper)] flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="font-mono text-xs opacity-60">{index + 1} / {remaining.length}</span>
        <button onClick={onClose} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><X size={20} /></button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <span className="font-mono text-xs uppercase tracking-widest opacity-50 mb-4">Still open</span>
        <p className="font-serif-display text-2xl leading-snug">
          {current.priority && <Star size={16} className="inline mr-2 -mt-1 text-[var(--accent-priority)]" fill="var(--accent-priority)" />}
          {current.text}
        </p>
      </div>

      <div className="px-5 pb-8 grid grid-cols-2 gap-3">
        <RitualButton icon={Check} label="Complete" onClick={() => act(onComplete)(current.id)} />
        <RitualButton icon={ArrowRight} label="Migrate → tomorrow" onClick={() => act(onMigrate)(current.id)} />
        <RitualButton icon={ArrowLeft} label="Schedule → future" onClick={() => onSchedule(current.id)} />
        <RitualButton icon={Minus} label="Irrelevant" onClick={() => act(onIrrelevant)(current.id)} />
      </div>
    </div>
  );
}

function RitualButton({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--paper)]/25 py-5 active:bg-[var(--paper)]/10">
      <Icon size={20} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modals — month picker (Schedule) & thread picker (link to collection)
// ---------------------------------------------------------------------------
function MonthPickerModal({ onPick, onClose }) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(now, i));
  return (
    <ModalShell title="Schedule to future month" onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {months.map((m) => {
          const fk = toMonthKey(m);
          return (
            <button key={fk} onClick={() => onPick(fk)} className="rounded-xl border border-[var(--rule)] py-3 text-sm font-medium active:bg-black/5">
              {MONTH_NAMES[m.getMonth()].slice(0, 3)} '{String(m.getFullYear()).slice(2)}
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

function ThreadPickerModal({ collections, onPick, onCreate, onClose }) {
  const [name, setName] = useState("");
  return (
    <ModalShell title="Thread to a collection" onClose={onClose}>
      <div className="flex items-center gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection…"
          className="flex-1 bg-[var(--paper)] border border-[var(--rule)] rounded-xl px-3 py-2.5 text-sm outline-none"
        />
        <button onClick={() => name.trim() && onCreate(name)} className="rounded-xl bg-[var(--ink)] text-[var(--paper)] px-3" style={{ height: 44 }}>
          <Plus size={16} />
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1.5">
        {collections.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="w-full text-left px-3 py-2.5 rounded-xl border border-[var(--rule)] text-sm active:bg-black/5">
            {c.name}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full bg-[var(--paper-card)] rounded-t-3xl p-5 animate-fadein"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-[var(--rule)] mx-auto mb-4" />
        <h3 className="font-serif-display text-lg mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}
