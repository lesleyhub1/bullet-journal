import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Circle, Minus, Star, X, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight,
  CalendarDays, CalendarRange, BookOpen, Settings, Plus, Check, Sparkles,
  Download, Upload, Trash2, Link2, ArrowUpRight, Layers, Pencil, RotateCcw,
  AlertTriangle, GripVertical, Sun, CloudSun, Cloud, CloudRain
} from "lucide-react";

/* ============================================================================
   BULLET JOURNAL — a local-first, analog-inspired daily planner PWA
   ----------------------------------------------------------------------------
   Data model (IndexedDB, database "bujo-db"):
     entries      { id, text, type, priority, status, date(YYYY-MM-DD),
                    monthKey(YYYY-MM), futureKey(YYYY-MM), collectionId,
                    threadId, createdAt, order }
     collections  { id, name, createdAt }
     meta         { key, value }  — mood-YYYY-MM-DD, lastExportAt, etc.
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
const dbBulkPut = (storeName, values) => tx(storeName, "readwrite", (s) => values.forEach((v) => s.put(v)));

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
const DAY_MS = 86400000;

function haptic(pattern = 10) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

function daysInMonth(year, monthIdx0) {
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

function prevMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return toMonthKey(d);
}

// ---------------------------------------------------------------------------
// Page-level swipe navigation — swipe anywhere on a Daily/Monthly Log page to
// move to the next/previous day or month. Touches that start on an entry row
// (marked with data-swipe-row) are ignored here entirely, so they're free to
// drive that row's own swipe-to-complete / reveal-actions gesture instead.
// ---------------------------------------------------------------------------
function useSwipeNav(onNext, onPrev) {
  const touchRef = useRef(null);
  const modeRef = useRef("idle");

  const onTouchStart = (e) => {
    if (e.target.closest && e.target.closest("[data-swipe-row]")) {
      touchRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
    modeRef.current = "idle";
  };

  const onTouchMove = (e) => {
    if (!touchRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    if (modeRef.current === "idle") {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) modeRef.current = "swipe";
      else if (Math.abs(dy) > 12) modeRef.current = "scroll";
    }
    // Never preventDefault here — vertical scrolling stays completely native;
    // we only read the gesture and act once on release.
  };

  const onTouchEnd = (e) => {
    if (!touchRef.current) { modeRef.current = "idle"; return; }
    if (modeRef.current === "swipe") {
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.x;
      if (dx <= -60) { onNext(); haptic(8); }
      else if (dx >= 60) { onPrev(); haptic(8); }
    }
    touchRef.current = null;
    modeRef.current = "idle";
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}

// ---------------------------------------------------------------------------
// Signifier glyphs
// ---------------------------------------------------------------------------
function Signifier({ entry, size = 18 }) {
  if (entry.type === "task") {
    if (entry.status === "done") return <Check size={size} strokeWidth={2.4} className="text-accent-done" />;
    if (entry.status === "migrated") return <ArrowRight size={size} strokeWidth={2.2} className="text-accent-event" />;
    if (entry.status === "scheduled") return <ArrowLeft size={size} strokeWidth={2.2} className="text-accent-event" />;
    if (entry.status === "irrelevant") return <Minus size={size} strokeWidth={2.2} className="text-ink-faint rotate-45" />;
    return <span className="block rounded-full" style={{ width: size * 0.42, height: size * 0.42, background: "var(--ink)" }} />;
  }
  if (entry.type === "event") return <Circle size={size * 0.62} strokeWidth={2.2} className="text-ink" />;
  return <Minus size={size * 0.8} strokeWidth={2.4} className="text-ink" />;
}

const TYPE_META = {
  task: { label: "Task", glyph: "•", icon: (s) => <span className="block rounded-full bg-current" style={{ width: s * 0.42, height: s * 0.42 }} /> },
  event: { label: "Event", glyph: "○", icon: (s) => <Circle size={s * 0.7} strokeWidth={2.2} /> },
  note: { label: "Note", glyph: "—", icon: (s) => <Minus size={s * 0.8} strokeWidth={2.4} /> },
};

// ---------------------------------------------------------------------------
// Live viewport height — reads the actual visible height directly from the
// browser rather than trusting a CSS unit (100vh, 100dvh, or a percentage
// chain) to resolve correctly. CSS viewport units have known inconsistencies
// across iOS versions specifically in standalone/home-screen PWA mode; the
// visualViewport API is a direct JS measurement of "how tall is the visible
// window right now," which sidesteps that ambiguity entirely and stays
// correct across orientation changes and (as a side effect) shrinks the
// layout to fit above the on-screen keyboard when it's open.
// ---------------------------------------------------------------------------
function useViewportHeight() {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" ? window.visualViewport?.height || window.innerHeight : 0
  );

  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height || window.innerHeight);
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return height;
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------
export default function App() {
  const viewportHeight = useViewportHeight();
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState([]);
  const [collections, setCollections] = useState([]);
  const [meta, setMeta] = useState({});
  const [view, setView] = useState("daily");
  const [activeDate, setActiveDate] = useState(new Date());
  const [activeMonth, setActiveMonth] = useState(new Date());
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState(null);
  const [threadPickerFor, setThreadPickerFor] = useState(null);
  const [dayPickerFor, setDayPickerFor] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [toast, setToast] = useState(null);

  const reload = useCallback(async () => {
    const [e, c, m] = await Promise.all([getAll("entries"), getAll("collections"), getAll("meta")]);
    setEntries(e);
    setCollections(c.sort((a, b) => a.createdAt - b.createdAt));
    const metaObj = {};
    m.forEach((row) => { metaObj[row.key] = row.value; });
    setMeta(metaObj);
  }, []);

  useEffect(() => { reload().then(() => setReady(true)); }, [reload]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  // -- entry CRUD ----------------------------------------------------------
  const createEntry = async ({ text, type, priority }, target) => {
    if (!text.trim()) return;
    const now = Date.now();
    const base = {
      id: uid(), text: text.trim(), type, priority: !!priority,
      status: type === "task" ? "open" : undefined,
      date: null, monthKey: null, futureKey: null, collectionId: null, threadId: null,
      createdAt: now, order: now,
    };
    const entry = { ...base, ...target };
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

  const persistOrder = async (reordered) => {
    setEntries((prev) => {
      const byId = new Map(reordered.map((e) => [e.id, e]));
      return prev.map((e) => byId.get(e.id) || e);
    });
    await dbBulkPut("entries", reordered);
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
    const affected = entries.filter((e) => e.threadId === id);
    for (const e of affected) await updateEntry(e.id, { threadId: null });
  };

  // -- task lifecycle actions ------------------------------------------------
  const completeTask = (id) => { updateEntry(id, { status: "done" }); haptic([10, 30, 10]); };
  const reopenTask = (id) => { updateEntry(id, { status: "open" }); haptic(8); };

  const migrateTask = async (id, toDateKey_ = null) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await updateEntry(id, { status: "migrated" });
    const target = toDateKey_ || toDateKey(addDays(new Date((e.date || toDateKey(new Date())) + "T00:00:00"), 1));
    const clone = {
      id: uid(), text: e.text, type: "task", priority: e.priority, status: "open",
      date: target, monthKey: target.slice(0, 7), futureKey: null,
      collectionId: e.collectionId, threadId: e.threadId, createdAt: Date.now(), order: Date.now(),
    };
    await dbPut("entries", clone);
    setEntries((prev) => [...prev, clone]);
    haptic([10, 20, 10]);
  };

  const migrateTaskToMonth = async (id, monthKey) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await updateEntry(id, { status: "migrated" });
    const clone = {
      id: uid(), text: e.text, type: "task", priority: e.priority, status: "open",
      date: null, monthKey, futureKey: null,
      collectionId: e.collectionId, threadId: e.threadId, createdAt: Date.now(), order: Date.now(),
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
      collectionId: e.collectionId, threadId: e.threadId, createdAt: Date.now(), order: Date.now(),
    };
    await dbPut("entries", clone);
    setEntries((prev) => [...prev, clone]);
    haptic([10, 20, 10]);
  };

  const markIrrelevant = (id) => { updateEntry(id, { status: "irrelevant" }); haptic(14); };

  const moveEntryToDay = async (id, dateKey_) => {
    await updateEntry(id, { date: dateKey_, monthKey: dateKey_.slice(0, 7), futureKey: null });
    haptic(10);
  };

  // -- backup export / import ----------------------------------------------
  const exportBackup = async () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), entries, collections, meta };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bujo-backup-${toDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const key = "lastExportAt";
    await dbPut("meta", { key, value: Date.now() });
    setMeta((prev) => ({ ...prev, [key]: Date.now() }));
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
    () => entries.filter((e) => !e.date && (e.monthKey === monthKey || e.futureKey === monthKey)).sort((a, b) => a.order - b.order),
    [entries, monthKey]
  );
  const monthDayEntries = useMemo(
    () => entries.filter((e) => e.date && e.date.startsWith(monthKey)),
    [entries, monthKey]
  );
  const rolloverCandidates = useMemo(() => {
    const pmk = prevMonthKey(monthKey);
    return entries.filter((e) => e.type === "task" && e.status === "open" && (e.monthKey === pmk || (e.date && e.date.startsWith(pmk))));
  }, [entries, monthKey]);

  const daysSinceExport = useMemo(() => {
    if (!meta.lastExportAt) return entries.length > 0 ? Infinity : 0;
    return Math.floor((Date.now() - meta.lastExportAt) / DAY_MS);
  }, [meta.lastExportAt, entries.length]);
  const showBackupBanner = !bannerDismissed && entries.length >= 5 && daysSinceExport >= 7;

  if (!ready) {
    return (
      <div className="h-dvh w-full flex items-center justify-center bg-paper" style={viewportHeight ? { height: viewportHeight } : undefined}>
        <div className="text-ink-faint font-mono text-sm tracking-widest animate-pulse">OPENING JOURNAL…</div>
      </div>
    );
  }

  const activeCollection = collections.find((c) => c.id === activeCollectionId) || null;

  const rapidLogTarget = () => {
    if (view === "collection") return { collectionId: activeCollectionId };
    if (view === "monthly") return { monthKey };
    return { date: dateKey, monthKey: toMonthKey(activeDate) };
  };

  return (
    <div className="h-dvh w-full flex justify-center bg-paper-dim" style={viewportHeight ? { height: viewportHeight } : undefined}>
      <StyleSheet />
      <div className="bujo-root relative flex flex-col w-full max-w-md h-full overflow-hidden bg-paper text-ink md:my-4 md:rounded-[2rem] md:shadow-2xl md:h-[min(900px,calc(100vh-2rem))]">
        <TopBar view={view} setView={setView} activeDate={activeDate} activeCollection={activeCollection} onBack={() => { setView("collections"); setActiveCollectionId(null); }} />

        {showBackupBanner && (
          <BackupBanner days={daysSinceExport} onExport={exportBackup} onDismiss={() => setBannerDismissed(true)} />
        )}

        <main key={view} className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 animate-fadein">
          {view === "daily" && (
            <DailyLog
              activeDate={activeDate}
              setActiveDate={setActiveDate}
              entries={dayEntries}
              mood={meta[`mood-${dateKey}`]}
              setMood={(v) => setMood(dateKey, v)}
              onToggleTask={(e) => (e.status === "done" ? reopenTask(e.id) : completeTask(e.id))}
              onDelete={removeEntry}
              onEdit={setEditingEntry}
              onReorder={persistOrder}
              onOpenReflection={() => setReflectionOpen(true)}
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
              rolloverCandidates={rolloverCandidates}
              onRollover={async () => {
                for (const e of rolloverCandidates) await migrateTaskToMonth(e.id, monthKey);
                flash(`Rolled over ${rolloverCandidates.length} task${rolloverCandidates.length === 1 ? "" : "s"}`);
              }}
              onJumpToDay={(dk) => { setActiveDate(new Date(dk + "T00:00:00")); setView("daily"); }}
              onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
              onDelete={removeEntry}
              onEdit={setEditingEntry}
              onReorder={persistOrder}
              collections={collections}
              onJumpToCollection={(id) => { setActiveCollectionId(id); setView("collection"); }}
              onJumpToFuture={() => setView("future")}
            />
          )}

          {view === "future" && (
            <FutureLog
              entries={entries.filter((e) => e.futureKey)}
              onAdd={async (futureKey, text) => {
                if (!text.trim()) return;
                await createEntry({ text, type: "task", priority: false }, { futureKey });
              }}
              onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
              onDelete={removeEntry}
              onEdit={setEditingEntry}
            />
          )}

          {view === "collections" && (
            <CollectionsIndex collections={collections} entries={entries} onOpen={(id) => { setActiveCollectionId(id); setView("collection"); }} onCreate={createCollection} onDelete={deleteCollection} />
          )}

          {view === "collection" && activeCollection && (
            <CollectionPage
              collection={activeCollection}
              entries={entries.filter((e) => e.collectionId === activeCollection.id)}
              onToggleTask={(e) => updateEntry(e.id, { status: e.status === "done" ? "open" : "done" })}
              onDelete={removeEntry}
              onEdit={setEditingEntry}
              onReorder={persistOrder}
              collections={collections}
            />
          )}

          {view === "settings" && (
            <SettingsPage onExport={exportBackup} onImport={importBackup} entryCount={entries.length} collectionCount={collections.length} lastExportAt={meta.lastExportAt} />
          )}
        </main>

        <div className="shrink-0">
          {(view === "daily" || view === "collection" || view === "monthly") && (
            <RapidLogBar
              onSubmit={(payload) => createEntry(payload, rapidLogTarget())}
              placeholder={view === "collection" ? `Add to ${activeCollection?.name || "collection"}…` : view === "monthly" ? `Add to ${MONTH_NAMES[activeMonth.getMonth()]}…` : "Log it…"}
            />
          )}
          <BottomNav view={view} setView={setView} />
        </div>

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
          <MonthPickerModal onPick={(fk) => { scheduleTask(scheduleFor, fk); setScheduleFor(null); }} onClose={() => setScheduleFor(null)} />
        )}

        {dayPickerFor && (
          <DayPickerModal
            monthKey={entries.find((e) => e.id === dayPickerFor)?.monthKey || entries.find((e) => e.id === dayPickerFor)?.futureKey || monthKey}
            onPick={(dk) => { moveEntryToDay(dayPickerFor, dk); setDayPickerFor(null); flash("Moved to Daily Log"); }}
            onClose={() => setDayPickerFor(null)}
          />
        )}

        {threadPickerFor && (
          <ThreadPickerModal
            collections={collections}
            onCreate={async (name) => {
              const id = await createCollection(name);
              if (id) await updateEntry(threadPickerFor, { threadId: id });
              setThreadPickerFor(null);
            }}
            onPick={(id) => { updateEntry(threadPickerFor, { threadId: id }); setThreadPickerFor(null); }}
            onClose={() => setThreadPickerFor(null)}
          />
        )}

        {editingEntry && (
          <EditSheet
            entry={editingEntry}
            onClose={() => setEditingEntry(null)}
            onSave={(patch) => { updateEntry(editingEntry.id, patch); setEditingEntry(null); haptic(10); }}
            onDelete={() => { removeEntry(editingEntry.id); setEditingEntry(null); }}
            onComplete={() => { completeTask(editingEntry.id); setEditingEntry(null); }}
            onReopen={() => { reopenTask(editingEntry.id); setEditingEntry(null); }}
            onMigrate={() => { migrateTask(editingEntry.id); setEditingEntry(null); }}
            onSchedule={() => { setScheduleFor(editingEntry.id); setEditingEntry(null); }}
            onIrrelevant={() => { markIrrelevant(editingEntry.id); setEditingEntry(null); }}
            onThread={() => { setThreadPickerFor(editingEntry.id); setEditingEntry(null); }}
            onMoveToDay={() => { setDayPickerFor(editingEntry.id); setEditingEntry(null); }}
            simple={!!editingEntry.futureKey}
          />
        )}

        {toast && (
          <div className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 px-4 py-2 rounded-full bg-ink text-paper text-sm font-medium shadow-lg animate-fadein">
            {toast}
          </div>
        )}
      </div>
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
        --paper-dim: #EAE4D4;
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
      }
      .font-serif-display { font-family: 'Newsreader', Georgia, serif; }
      .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
      * { -webkit-tap-highlight-color: transparent; }
      input, textarea { font-family: inherit; }

      /* Named color utilities — plain CSS classes rather than Tailwind's
         bg-[var(--x)] arbitrary-value syntax, which doesn't reliably
         generate in this CDN/runtime setup. These are defined once here
         and referenced by ordinary class name everywhere in the app. */
      .bg-paper { background-color: var(--paper); }
      .bg-paper-dim { background-color: var(--paper-dim); }
      .bg-paper-card { background-color: var(--paper-card); }
      .bg-ink { background-color: var(--ink); }
      .bg-rule { background-color: var(--rule); }
      .bg-accent-priority { background-color: var(--accent-priority); }
      .bg-accent-event { background-color: var(--accent-event); }
      .bg-accent-priority-10 { background-color: rgba(139,58,58,.10); }
      .bg-paper-10 { background-color: rgba(246,242,232,.10); }

      .border-rule { border-color: var(--rule); }
      .border-rule-60 { border-color: rgba(222,213,192,.60); }
      .border-rule-70 { border-color: rgba(222,213,192,.70); }
      .border-ink { border-color: var(--ink); }
      .border-accent-priority { border-color: var(--accent-priority); }
      .border-accent-priority-30 { border-color: rgba(139,58,58,.30); }
      .border-accent-event { border-color: var(--accent-event); }
      .border-paper-25 { border-color: rgba(246,242,232,.25); }
      .border-paper-40 { border-color: rgba(246,242,232,.40); }

      .text-ink { color: var(--ink); }
      .text-ink-faint { color: var(--ink-faint); }
      .text-ink-faint-50 { color: rgba(148,140,124,.50); }
      .text-paper { color: var(--paper); }
      .text-accent-priority { color: var(--accent-priority); }
      .text-accent-event { color: var(--accent-event); }
      .text-accent-done { color: var(--accent-done); }

      .ritual-btn:active { background-color: rgba(246,242,232,.10); }
      @media (min-width: 768px) {
        .bujo-root { border: 1px solid var(--rule); }
      }

      @keyframes fadein { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: translateY(0);} }
      .animate-fadein { animation: fadein .22s ease-out; }
      @keyframes sheetup { from { transform: translateY(100%);} to { transform: translateY(0);} }
      .animate-sheetup { animation: sheetup .28s cubic-bezier(.32,.72,0,1); }
      ::-webkit-scrollbar { display: none; }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Backup reminder banner
// ---------------------------------------------------------------------------
function BackupBanner({ days, onExport, onDismiss }) {
  return (
    <div className="shrink-0 mx-4 mb-1 mt-1 rounded-xl bg-accent-priority-10 border border-accent-priority-30 px-3 py-2 flex items-center gap-2">
      <AlertTriangle size={15} className="text-accent-priority shrink-0" />
      <p className="flex-1 text-xs text-ink">
        {days === Infinity ? "You haven't exported a backup yet." : `It's been ${days} days since your last backup.`}
      </p>
      <button onClick={onExport} className="text-xs font-semibold text-accent-priority shrink-0 px-2 py-1">Export</button>
      <button onClick={onDismiss} className="p-1 text-ink-faint shrink-0" style={{ minWidth: 28, minHeight: 28 }}><X size={14} /></button>
    </div>
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
    <header className="shrink-0 pt-3 px-5 pb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {view === "collection" && (
          <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-black/5" style={{ minWidth: 44, minHeight: 44 }}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div>
          <h1 className="font-serif-display text-2xl leading-tight">{titleMap[view]}</h1>
          {view === "daily" && (
            <p className="font-mono text-xs text-ink-faint tracking-wide">
              {activeDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </div>
      <div className="w-2 h-2 rounded-full bg-accent-priority shrink-0" />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation — respects home indicator safe area, normal document flow
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
    <nav className="border-t border-rule bg-paper-card flex items-stretch" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {items.map(({ key, icon: Icon, label }) => {
        const active = view === key || (key === "collections" && view === "collection");
        return (
          <button
            key={key}
            onClick={() => setView(key)}
            className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 active:opacity-60 min-w-0"
            style={{ minHeight: 52 }}
          >
            <Icon size={20} strokeWidth={active ? 2.4 : 1.8} className={active ? "text-ink" : "text-ink-faint"} />
            <span className={`text-[10px] font-mono tracking-wide leading-none whitespace-nowrap ${active ? "text-ink" : "text-ink-faint"}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Rapid Logging Console — bottom docked, in normal flow (no fixed overlap)
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

  const handleChange = (val) => {
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
    <div className="bg-paper-card border-t border-rule px-3 pt-2">
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setType(opt.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 flex items-center gap-1.5 ${
              type === opt.key ? "bg-ink text-paper border-ink" : "bg-transparent text-ink-faint border-rule"
            }`}
            style={{ minHeight: 30 }}
          >
            <span className="font-mono">{opt.glyph}</span>{opt.label}
          </button>
        ))}
        <button
          onClick={() => setPriority((p) => !p)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 flex items-center gap-1 ${
            priority ? "bg-accent-priority text-white border-accent-priority" : "bg-transparent text-ink-faint border-rule"
          }`}
          style={{ minHeight: 30 }}
        >
          <Star size={12} fill={priority ? "white" : "none"} /> Priority
        </button>
      </div>
      <div className="flex items-end gap-2 pb-2">
        <div className="flex-1 min-w-0 flex items-center gap-2 bg-paper rounded-2xl border border-rule px-3" style={{ minHeight: 44 }}>
          <span className="font-mono text-ink-faint w-4 text-center shrink-0">{type === "task" ? "•" : type === "event" ? "○" : "—"}</span>
          <input
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-transparent outline-none py-2.5 text-[15px]"
            enterKeyHint="done"
          />
        </div>
        <button onClick={submit} disabled={!text.trim()} className="shrink-0 rounded-2xl bg-ink text-paper flex items-center justify-center disabled:opacity-30" style={{ width: 44, height: 44 }}>
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable entry list — long-press drag reorder, driven at list level
// ---------------------------------------------------------------------------
function SortableEntryList({ entries, onReorder, renderRow, emptyText }) {
  const [items, setItems] = useState(entries);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const draggingRef = useRef(null); // {id, startY, slots}
  const [dragId, setDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const rowRefs = useRef(new Map());

  useEffect(() => { if (!draggingRef.current) setItems(entries); }, [entries]);

  const measure = () => {
    const slots = [];
    itemsRef.current.forEach((it) => {
      const node = rowRefs.current.get(it.id);
      if (node) {
        const r = node.getBoundingClientRect();
        slots.push({ id: it.id, top: r.top, left: r.left, width: r.width, height: r.height });
      }
    });
    return slots;
  };

  const [dragRect, setDragRect] = useState(null);

  const onLongPressStart = (id, clientY) => {
    haptic(15);
    const slots = measure();
    draggingRef.current = { id, startY: clientY, slots };
    setDragId(id);
    setDragOffset(0);
    setDragRect(slots.find((s) => s.id === id) || null);
  };

  const onDragMove = (clientY) => {
    const d = draggingRef.current;
    if (!d) return;
    const delta = clientY - d.startY;
    setDragOffset(delta);
    const slot = d.slots.find((s) => s.id === d.id);
    if (!slot) return;
    const center = slot.top + slot.height / 2 + delta;
    let targetIdx = d.slots.findIndex((s) => center >= s.top && center < s.top + s.height);
    if (targetIdx === -1) targetIdx = center < d.slots[0]?.top ? 0 : d.slots.length - 1;
    const currentIdx = itemsRef.current.findIndex((it) => it.id === d.id);
    if (targetIdx !== -1 && targetIdx !== currentIdx) {
      setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(currentIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
    }
  };

  const onDragEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    setDragId(null);
    setDragOffset(0);
    setDragRect(null);
    const withOrder = itemsRef.current.map((it, i) => ({ ...it, order: i }));
    setItems(withOrder);
    onReorder(withOrder);
    haptic(8);
  };

  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-faint">{emptyText}</p>;
  }

  return (
    <div>
      {items.map((entry, idx) =>
        renderRow(entry, idx, {
          registerRef: (node) => { if (node) rowRefs.current.set(entry.id, node); else rowRefs.current.delete(entry.id); },
          isDragging: dragId === entry.id,
          dragOffset: dragId === entry.id ? dragOffset : 0,
          dragRect: dragId === entry.id ? dragRect : null,
          onLongPressStart: (y) => onLongPressStart(entry.id, y),
          onDragMove,
          onDragEnd,
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry row — tap opens Edit Sheet · swipe right completes · swipe left reveals
// Delete/Edit · long-press + drag reorders within its list
// ---------------------------------------------------------------------------
function EntryRow({ entry, onToggleTask, onDelete, onEdit, collections, onJumpToCollection, onJumpToFuture, compact, sortable }) {
  const [swipeX, setSwipeX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const touchRef = useRef(null);
  const modeRef = useRef("idle");
  const longPressTimer = useRef(null);

  const thread = entry.threadId ? collections?.find((c) => c.id === entry.threadId) : null;
  const fromFuture = !entry.monthKey && !!entry.futureKey;
  const isMuted = entry.status === "migrated" || entry.status === "scheduled" || entry.status === "irrelevant";
  const isDone = entry.status === "done";

  const clearLP = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };

  const onTouchStart = (e) => {
    if (revealed) { setRevealed(false); return; }
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
    modeRef.current = "idle";
    if (sortable) {
      longPressTimer.current = setTimeout(() => {
        modeRef.current = "drag";
        sortable.onLongPressStart(touchRef.current.y);
      }, 450);
    }
  };

  const onTouchMove = (e) => {
    if (!touchRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;

    if (modeRef.current === "drag") {
      sortable.onDragMove(t.clientY);
      return;
    }
    if (modeRef.current === "idle") {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        clearLP();
        modeRef.current = "swipe";
      } else if (Math.abs(dy) > 10) {
        clearLP();
        modeRef.current = "scroll";
      }
    }
    if (modeRef.current === "swipe") {
      const clamped = Math.max(-140, Math.min(90, dx));
      setSwipeX(clamped);
    }
  };

  const onTouchEnd = () => {
    clearLP();
    if (modeRef.current === "drag") {
      sortable.onDragEnd();
    } else if (modeRef.current === "swipe") {
      if (swipeX > 68 && entry.type === "task" && !isMuted) {
        onToggleTask(entry);
        haptic([10, 30, 10]);
      } else if (swipeX < -68) {
        setRevealed(true);
        haptic(10);
      }
      setSwipeX(0);
    } else if (modeRef.current === "idle") {
      onEdit(entry);
    }
    modeRef.current = "idle";
    touchRef.current = null;
  };

  const translateX = revealed ? -110 : swipeX;
  const isDragging = sortable?.isDragging;
  const rect = sortable?.dragRect;

  // While actively dragged, the row is pulled out of normal document flow and
  // pinned with position:fixed at its live viewport coordinates (rect.top +
  // running offset). This avoids the classic "jump" bug where reordering the
  // underlying array mid-drag shifts the row's in-flow position out from
  // under a still-relative transform.
  const draggingStyle = isDragging && rect
    ? {
        position: "fixed",
        top: rect.top + sortable.dragOffset,
        left: rect.left,
        width: rect.width,
        zIndex: 50,
        boxShadow: "0 10px 24px rgba(0,0,0,.18)",
        borderRadius: 12,
      }
    : undefined;

  return (
    <div ref={sortable?.registerRef} className="relative" style={draggingStyle}>
      {!compact && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-1">
          <button onClick={() => onEdit(entry)} className="w-9 h-9 rounded-full bg-accent-event text-white flex items-center justify-center"><Pencil size={15} /></button>
          <button onClick={() => onDelete(entry.id)} className="w-9 h-9 rounded-full bg-accent-priority text-white flex items-center justify-center"><Trash2 size={15} /></button>
        </div>
      )}
      <div
        data-swipe-row={compact ? undefined : "true"}
        onTouchStart={compact ? undefined : onTouchStart}
        onTouchMove={compact ? undefined : onTouchMove}
        onTouchEnd={compact ? undefined : onTouchEnd}
        onClick={compact ? () => onEdit(entry) : undefined}
        className={`relative flex items-start gap-3 py-2.5 bg-paper-card ${compact ? "" : "border-b border-rule-70"}`}
        style={{ transform: `translateX(${translateX}px)`, transition: modeRef.current === "swipe" && touchRef.current ? "none" : "transform .2s ease" }}
      >
        {sortable && !compact && (
          <span className="mt-1.5 text-ink-faint-50 shrink-0"><GripVertical size={14} /></span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); entry.type === "task" && !isMuted && onToggleTask(entry); }}
          className="mt-0.5 shrink-0 flex items-center justify-center"
          style={{ width: 24, height: 24 }}
        >
          <Signifier entry={entry} />
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-[15px] leading-snug break-words ${isDone || isMuted ? "text-ink-faint" : "text-ink"} ${entry.status === "irrelevant" ? "line-through decoration-1" : ""}`}>
            {entry.priority && <Star size={13} className="inline mr-1 -mt-0.5 text-accent-priority" fill="var(--accent-priority)" />}
            {entry.text}
          </p>
          {thread && (
            <button onClick={(e) => { e.stopPropagation(); onJumpToCollection && onJumpToCollection(thread.id); }} className="mt-1 flex items-center gap-1 text-[11px] font-mono text-accent-event">
              <Link2 size={11} /> {thread.name} <ArrowUpRight size={11} />
            </button>
          )}
          {fromFuture && (
            <button onClick={(e) => { e.stopPropagation(); onJumpToFuture && onJumpToFuture(); }} className="mt-1 flex items-center gap-1 text-[11px] font-mono text-ink-faint">
              <Layers size={11} /> Future Log <ArrowUpRight size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Log
// ---------------------------------------------------------------------------
const MOOD_ICONS = [Cloud, CloudRain, CloudSun, Sun, Sparkles];

function DailyLog({ activeDate, setActiveDate, entries, mood, setMood, onToggleTask, onDelete, onEdit, onReorder, onOpenReflection, collections, onJumpToCollection }) {
  const openTaskCount = entries.filter((e) => e.type === "task" && e.status === "open").length;
  const swipeHandlers = useSwipeNav(
    () => setActiveDate(addDays(activeDate, 1)),
    () => setActiveDate(addDays(activeDate, -1))
  );
  return (
    <div {...swipeHandlers} className="min-h-full flex flex-col">
      <div className="flex items-center justify-between py-2">
        <button onClick={() => setActiveDate(addDays(activeDate, -1))} className="p-2 active:opacity-50" style={{ minWidth: 44, minHeight: 44 }}><ChevronLeft size={20} /></button>
        <button onClick={() => setActiveDate(new Date())} className="font-mono text-xs text-ink-faint px-3 py-1.5 rounded-full border border-rule">Today</button>
        <button onClick={() => setActiveDate(addDays(activeDate, 1))} className="p-2 active:opacity-50" style={{ minWidth: 44, minHeight: 44 }}><ChevronRight size={20} /></button>
      </div>

      <div className="flex items-center justify-center gap-3 py-3">
        {MOOD_ICONS.map((Icon, i) => {
          const val = i + 1;
          const active = mood === val;
          return (
            <button key={val} onClick={() => setMood(val)} style={{ width: 40, height: 40 }} className="flex items-center justify-center rounded-full active:scale-95">
              <Icon size={20} className={active ? "text-accent-event" : "text-ink-faint-50"} strokeWidth={active ? 2.2 : 1.6} />
            </button>
          );
        })}
      </div>

      <div className="mt-2 rounded-2xl bg-paper-card border border-rule px-4 pt-1 overflow-hidden">
        <SortableEntryList
          entries={entries}
          onReorder={onReorder}
          emptyText="A blank page. Log your first bullet below."
          renderRow={(entry, idx, sortable) => (
            <EntryRow key={entry.id} entry={entry} onToggleTask={onToggleTask} onDelete={onDelete} onEdit={onEdit} collections={collections} onJumpToCollection={onJumpToCollection} sortable={sortable} />
          )}
        />
      </div>

      {openTaskCount > 0 && (
        <button onClick={onOpenReflection} className="w-full mt-4 rounded-2xl bg-ink text-paper py-3.5 flex items-center justify-center gap-2 font-medium active:opacity-90">
          <Sparkles size={16} /> End of Day Reflection ({openTaskCount})
        </button>
      )}
      <p className="mt-auto text-center text-[11px] text-ink-faint font-mono pt-4 pb-2">swipe right to complete · swipe left for edit/delete · hold to reorder</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly Log — dual pane: date list + open-ended monthly tasks (now editable
// via the shared rapid-log bar and rollover from last month)
// ---------------------------------------------------------------------------
function MonthlyLog({ activeMonth, setActiveMonth, dayEntries, taskEntries, rolloverCandidates, onRollover, onJumpToDay, onToggleTask, onDelete, onEdit, onReorder, collections, onJumpToCollection, onJumpToFuture }) {
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

  const swipeHandlers = useSwipeNav(
    () => setActiveMonth(addMonths(activeMonth, 1)),
    () => setActiveMonth(addMonths(activeMonth, -1))
  );

  return (
    <div {...swipeHandlers} className="min-h-full flex flex-col">
      <div className="sticky top-0 z-10 -mx-4 px-4 bg-paper flex items-center justify-between py-2 border-b border-rule">
        <button onClick={() => setActiveMonth(addMonths(activeMonth, -1))} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><ChevronLeft size={20} /></button>
        <h2 className="font-serif-display text-xl">{MONTH_NAMES[monthIdx]} {year}</h2>
        <button onClick={() => setActiveMonth(addMonths(activeMonth, 1))} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><ChevronRight size={20} /></button>
      </div>

      <section className="rounded-2xl bg-paper-card border border-rule mb-4 mt-3 overflow-hidden">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-faint px-4 pt-3 pb-1">CALENDAR</h3>
        <div className="px-2 pb-2">
          {rows.map((d) => {
            const date = new Date(year, monthIdx, d);
            const dow = WEEKDAY_LETTERS[date.getDay()];
            const items = entriesByDay[d] || [];
            const dk = toDateKey(date);
            return (
              <button key={d} onClick={() => onJumpToDay(dk)} className="w-full flex items-center gap-3 px-2 py-2 border-b border-rule-60 last:border-b-0 text-left active:bg-black/5" style={{ minHeight: 40 }}>
                <span className="font-mono text-xs text-ink-faint w-8 shrink-0">{d} {dow}</span>
                <div className="flex-1 flex items-center gap-1.5 overflow-hidden min-w-0">
                  {items.length === 0 ? (
                    <span className="text-[13px] text-ink-faint-50">—</span>
                  ) : (
                    items.slice(0, 3).map((it) => (
                      <span key={it.id} className="text-[13px] truncate flex items-center gap-1 min-w-0">
                        <Signifier entry={it} size={11} />
                        <span className="truncate max-w-[90px]">{it.text}</span>
                      </span>
                    ))
                  )}
                  {items.length > 3 && <span className="text-[11px] text-ink-faint shrink-0">+{items.length - 3}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl bg-paper-card border border-rule px-4 pt-1 overflow-hidden">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-faint pt-3 pb-2">MONTHLY TASKS</h3>

        {rolloverCandidates.length > 0 && (
          <button onClick={onRollover} className="w-full mb-3 flex items-center justify-center gap-2 rounded-xl border border-accent-event text-accent-event py-2.5 text-sm font-medium">
            <RotateCcw size={14} /> Roll over {rolloverCandidates.length} unfinished task{rolloverCandidates.length === 1 ? "" : "s"} from {MONTH_NAMES[(monthIdx + 11) % 12]}
          </button>
        )}

        <SortableEntryList
          entries={taskEntries}
          onReorder={onReorder}
          emptyText="No open-ended items this month — log one below."
          renderRow={(entry, idx, sortable) => (
            <EntryRow key={entry.id} entry={entry} onToggleTask={onToggleTask} onDelete={onDelete} onEdit={onEdit} collections={collections} onJumpToCollection={onJumpToCollection} onJumpToFuture={onJumpToFuture} sortable={sortable} />
          )}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Future Log — 12 month grid (overflow-safe cards)
// ---------------------------------------------------------------------------
function FutureLog({ entries, onAdd, onToggleTask, onDelete, onEdit }) {
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
          <div key={fk} className={`rounded-2xl bg-paper-card border border-rule p-3 min-w-0 overflow-hidden ${isOpen ? "col-span-2" : "col-span-1"}`}>
            <button className="w-full flex items-center justify-between mb-1" onClick={() => setOpenMonth(isOpen ? null : fk)}>
              <span className="font-serif-display text-base">{MONTH_NAMES[m.getMonth()]} {isOpen ? m.getFullYear() : ""}</span>
              <span className="font-mono text-[10px] text-ink-faint shrink-0">{items.length}</span>
            </button>
            <div className="space-y-1 mb-2">
              {items.slice(0, isOpen ? undefined : 3).map((it) => (
                <div key={it.id} className="flex items-center gap-1.5 min-w-0 py-0.5">
                  {it.type === "task" ? (
                    <button onClick={() => onToggleTask(it)} className="shrink-0"><Signifier entry={it} size={13} /></button>
                  ) : (
                    <span className="shrink-0 flex items-center justify-center" style={{ width: 13, height: 13 }}><Signifier entry={it} size={13} /></span>
                  )}
                  <button onClick={() => onEdit(it)} className="flex-1 min-w-0 text-left">
                    <span className={`text-[12px] truncate block ${it.status === "done" ? "text-ink-faint line-through" : ""}`}>{it.text}</span>
                  </button>
                  {isOpen && (
                    <button onClick={() => onDelete(it.id)} className="shrink-0 text-ink-faint" style={{ minWidth: 24, minHeight: 24 }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              {!isOpen && items.length > 3 && <p className="text-[10px] text-ink-faint font-mono">+{items.length - 3} more</p>}
            </div>
            {isOpen && (
              <div className="flex items-center gap-1.5 mt-2 min-w-0">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onAdd(fk, draft); setDraft(""); } }}
                  placeholder="Add item…"
                  className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs border border-rule outline-none appearance-none"
                  style={{ backgroundColor: "var(--paper)", color: "var(--ink)", WebkitAppearance: "none" }}
                />
                <button onClick={() => { onAdd(fk, draft); setDraft(""); }} className="shrink-0 rounded-lg bg-ink text-paper flex items-center justify-center" style={{ width: 30, height: 30 }}>
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
          className="flex-1 min-w-0 border border-rule rounded-xl px-3 py-2.5 text-sm outline-none appearance-none"
          style={{ backgroundColor: "var(--paper-card)", color: "var(--ink)", WebkitAppearance: "none" }}
        />
        <button onClick={() => { onCreate(name); setName(""); }} className="shrink-0 rounded-xl bg-ink text-paper flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <Plus size={18} />
        </button>
      </div>

      {collections.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint">No collections yet — create an index page for a project, book list, or anything worth tracking on its own page.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {collections.map((c) => {
            const count = entries.filter((e) => e.collectionId === c.id).length;
            const threadCount = entries.filter((e) => e.threadId === c.id).length;
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-2xl bg-paper-card border border-rule px-4 py-3">
                <button onClick={() => onOpen(c.id)} className="flex-1 min-w-0 text-left">
                  <p className="font-serif-display text-base truncate">{c.name}</p>
                  <p className="font-mono text-[10px] text-ink-faint">{count} item{count !== 1 ? "s" : ""}{threadCount ? ` · linked from ${threadCount}` : ""}</p>
                </button>
                <button onClick={() => onDelete(c.id)} className="shrink-0 p-2 text-ink-faint" style={{ minWidth: 40, minHeight: 40 }}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollectionPage({ collection, entries, onToggleTask, onDelete, onEdit, onReorder, collections }) {
  return (
    <div className="rounded-2xl bg-paper-card border border-rule px-4 pt-1 mt-2 overflow-hidden">
      <SortableEntryList
        entries={entries.slice().sort((a, b) => a.order - b.order)}
        onReorder={onReorder}
        emptyText="This page is empty. Log something below."
        renderRow={(entry, idx, sortable) => (
          <EntryRow key={entry.id} entry={entry} onToggleTask={onToggleTask} onDelete={onDelete} onEdit={onEdit} collections={collections} sortable={sortable} />
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — backup export / import
// ---------------------------------------------------------------------------
function SettingsPage({ onExport, onImport, entryCount, collectionCount, lastExportAt }) {
  const fileRef = useRef(null);
  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-2xl bg-paper-card border border-rule p-4">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-faint mb-2">JOURNAL</h3>
        <p className="text-sm">{entryCount} bullets logged across {collectionCount} collections.</p>
        <p className="text-xs text-ink-faint mt-1">Everything lives in this device's IndexedDB storage — nothing leaves your phone.</p>
      </div>

      <div className="rounded-2xl bg-paper-card border border-rule p-4 space-y-3">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-faint">BACKUP</h3>
        {lastExportAt && <p className="text-xs text-ink-faint">Last exported {new Date(lastExportAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.</p>}
        <button onClick={onExport} className="w-full flex items-center justify-center gap-2 rounded-xl bg-ink text-paper py-3 font-medium"><Download size={16} /> Export backup JSON</button>
        <button onClick={() => fileRef.current?.click()} className="w-full flex items-center justify-center gap-2 rounded-xl border border-rule py-3 font-medium"><Upload size={16} /> Import backup JSON</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
      </div>

      <div className="rounded-2xl bg-paper-card border border-rule p-4">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-faint mb-2">ABOUT</h3>
        <p className="text-xs text-ink-faint leading-relaxed">A digital rendition of the analog bullet journal method. Rapid log, migrate honestly, and let go of what no longer matters.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reflection Mode — full-screen ritual, one task at a time
// ---------------------------------------------------------------------------
function ReflectionMode({ entries, onComplete, onMigrate, onSchedule, onIrrelevant, onClose }) {
  const [index, setIndex] = useState(0);
  const [remaining] = useState(entries);
  const current = remaining[index];

  const advance = () => { if (index >= remaining.length - 1) onClose(); else setIndex((i) => i + 1); };
  const act = (fn) => (id) => { fn(id); advance(); };

  if (!current) {
    return (
      <div className="fixed inset-0 z-50 bg-ink text-paper flex flex-col items-center justify-center px-8">
        <Sparkles size={32} className="mb-4" />
        <p className="font-serif-display text-xl text-center mb-6">Page cleared. Well done.</p>
        <button onClick={onClose} className="px-6 py-3 rounded-full border border-paper-40">Close</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink text-paper flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="font-mono text-xs opacity-60">{index + 1} / {remaining.length}</span>
        <button onClick={onClose} className="p-2" style={{ minWidth: 44, minHeight: 44 }}><X size={20} /></button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <span className="font-mono text-xs uppercase tracking-widest opacity-50 mb-4">Still open</span>
        <p className="font-serif-display text-2xl leading-snug">
          {current.priority && <Star size={16} className="inline mr-2 -mt-1 text-accent-priority" fill="var(--accent-priority)" />}
          {current.text}
        </p>
      </div>
      <div className="px-5 pb-8 grid grid-cols-2 gap-3">
        <RitualButton icon={Check} label="Done" onClick={() => act(onComplete)(current.id)} />
        <RitualButton icon={ArrowRight} label="Migrate → tomorrow" onClick={() => act(onMigrate)(current.id)} />
        <RitualButton icon={ArrowLeft} label="Schedule → future" onClick={() => onSchedule(current.id)} />
        <RitualButton icon={Minus} label="Irrelevant" onClick={() => act(onIrrelevant)(current.id)} />
      </div>
    </div>
  );
}

function RitualButton({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="ritual-btn flex flex-col items-center justify-center gap-2 rounded-2xl border border-paper-25 py-5">
      <Icon size={20} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Edit Sheet — full CRUD bottom sheet (text, type, priority, status, delete)
// ---------------------------------------------------------------------------
function EditSheet({ entry, onClose, onSave, onDelete, onComplete, onReopen, onMigrate, onSchedule, onIrrelevant, onThread, onMoveToDay, simple }) {
  const [text, setText] = useState(entry.text);
  const [type, setType] = useState(entry.type);
  const [priority, setPriority] = useState(!!entry.priority);
  const isMuted = entry.status === "migrated" || entry.status === "scheduled" || entry.status === "irrelevant";
  const typeOptions = simple ? TYPE_OPTIONS.filter((o) => o.key !== "note") : TYPE_OPTIONS;

  const save = () => {
    if (!text.trim()) return;
    const patch = { text: text.trim(), type, priority };
    if (type !== "task") patch.status = undefined;
    else if (entry.type !== "task") patch.status = "open";
    onSave(patch);
  };

  return (
    <ModalShell onClose={onClose} title="Edit bullet">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full border border-rule rounded-xl px-3 py-2 text-[15px] outline-none resize-none mb-2 appearance-none"
        style={{ backgroundColor: "var(--paper)", color: "var(--ink)", WebkitAppearance: "none", boxSizing: "border-box" }}
        autoFocus
      />

      <div className="flex items-center gap-2 mb-2">
        {typeOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setType(opt.key)}
            className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl border ${type === opt.key ? "bg-ink text-paper border-ink" : "border-rule text-ink-faint"}`}
            style={{ height: 42 }}
          >
            <IconSlot>{TYPE_META[opt.key].icon(15)}</IconSlot>
            <span className="text-[10px] font-medium leading-none">{opt.label}</span>
          </button>
        ))}
        {!simple && (
          <button
            onClick={() => setPriority((p) => !p)}
            className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl border ${priority ? "bg-accent-priority border-accent-priority text-white" : "border-rule text-ink-faint"}`}
            style={{ height: 42 }}
          >
            <IconSlot><Star size={15} fill={priority ? "white" : "none"} /></IconSlot>
            <span className="text-[10px] font-medium leading-none">Priority</span>
          </button>
        )}
      </div>

      {!simple && type === "task" && !isMuted && (
        <div className="flex items-center gap-2 mb-2">
          <MiniButton icon={Minus} label="Irrelevant" onClick={onIrrelevant} />
          <MiniButton icon={ArrowRight} label="Migrate" onClick={onMigrate} />
          <MiniButton icon={ArrowLeft} label="Schedule" onClick={onSchedule} />
          {entry.status !== "done" ? (
            <MiniButton icon={Check} label="Done" onClick={onComplete} />
          ) : (
            <MiniButton icon={RotateCcw} label="Reopen" onClick={onReopen} />
          )}
        </div>
      )}

      {!simple && type === "task" && !isMuted && !entry.date && (
        <button onClick={onMoveToDay} className="w-full flex items-center justify-center gap-2 py-1.5 rounded-xl border border-rule mb-2 text-xs font-medium">
          <CalendarDays size={13} /> Move to day
        </button>
      )}

      {!simple && (
        <button onClick={onThread} className="w-full flex items-center justify-center gap-2 py-1.5 rounded-xl border border-rule mb-2 text-xs font-medium">
          <Link2 size={13} /> {entry.threadId ? "Change thread" : "Thread to collection"}
        </button>
      )}

      <div className="flex items-center gap-2">
        <button onClick={save} className="flex-1 py-2.5 rounded-xl bg-ink text-paper font-medium">Save</button>
        <button onClick={onDelete} className="shrink-0 px-4 py-2.5 rounded-xl border border-accent-priority text-accent-priority font-medium flex items-center justify-center" style={{ minWidth: 48 }}>
          <Trash2 size={16} />
        </button>
      </div>
    </ModalShell>
  );
}

function IconSlot({ children }) {
  return <span className="flex items-center justify-center shrink-0" style={{ height: 16 }}>{children}</span>;
}

function MiniButton({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl border border-rule text-ink" style={{ height: 42 }}>
      <IconSlot><Icon size={14} /></IconSlot>
      <span className="text-[10px] font-medium leading-none whitespace-nowrap">{label}</span>
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
            <button key={fk} onClick={() => onPick(fk)} className="rounded-xl border border-rule py-3 text-sm font-medium active:bg-black/5">
              {MONTH_NAMES[m.getMonth()].slice(0, 3)} '{String(m.getFullYear()).slice(2)}
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

function DayPickerModal({ monthKey, onPick, onClose }) {
  const [y, m] = monthKey.split("-").map(Number);
  const total = daysInMonth(y, m - 1);
  const days = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <ModalShell title={`Move to a day in ${MONTH_NAMES[m - 1]}`} onClose={onClose}>
      <div className="grid grid-cols-5 gap-2">
        {days.map((d) => {
          const date = new Date(y, m - 1, d);
          const dk = toDateKey(date);
          const dow = WEEKDAY_LETTERS[date.getDay()];
          return (
            <button key={dk} onClick={() => onPick(dk)} className="rounded-xl border border-rule py-2.5 text-sm font-medium active:bg-black/5 flex flex-col items-center gap-0.5">
              <span>{d}</span>
              <span className="text-[9px] font-mono text-ink-faint">{dow}</span>
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection…" className="flex-1 min-w-0 border border-rule rounded-xl px-3 py-2.5 text-sm outline-none appearance-none" style={{ backgroundColor: "var(--paper)", color: "var(--ink)", WebkitAppearance: "none" }} />
        <button onClick={() => name.trim() && onCreate(name)} className="shrink-0 rounded-xl bg-ink text-paper px-3" style={{ height: 44 }}><Plus size={16} /></button>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1.5">
        {collections.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="w-full text-left px-3 py-2.5 rounded-xl border border-rule text-sm active:bg-black/5">{c.name}</button>
        ))}
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 animate-fadein" />
      <div
        className="relative w-full max-w-md mx-auto bg-paper-card rounded-t-3xl p-4 animate-sheetup max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-rule mx-auto mb-2" />
        <h3 className="font-serif-display text-base mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}
