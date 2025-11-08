import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { create, all } from "mathjs";

// Use mathjs via named import to avoid bundler issues
const math = create(all, { number: "number", precision: 14 });

// Feature-detection helpers
const hasWindow = typeof window !== "undefined";
const hasLocalStorage = hasWindow && typeof window.localStorage !== "undefined";

// Helper: safe coercion
function toNumberSafe(v) {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return NaN;
  try {
    if (v && typeof v.valueOf === "function") {
      const prim = v.valueOf();
      return Number(prim);
    }
    return Number(v);
  } catch {
    return NaN;
  }
}

// ------------------ Advanced Calculator (with Digital keypad & tests) ------------------
function CalculatorModule({ onPushHistory }) {
  const [expr, setExpr] = useState("");
  const [display, setDisplay] = useState("0");
  const [history, setHistory] = useState([]);
  const [solveVar, setSolveVar] = useState("x");
  const [initialGuess, setInitialGuess] = useState("1");
  const [solveResult, setSolveResult] = useState(null);
  const [showTegna, setShowTegna] = useState(false);
  const [digitalMode, setDigitalMode] = useState(true);

  useEffect(() => {
    if (!hasLocalStorage) return;
    try {
      const raw = localStorage.getItem("calc_history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    if (!hasLocalStorage) return;
    try { localStorage.setItem("calc_history", JSON.stringify(history)); } catch {}
    if (onPushHistory && history.length) onPushHistory(history[0]);
  }, [history]);

  const tegnamantriFormulas = [
    { name: "Akk CM", expr: "area = length * width" },
    { name: "CropYield", expr: "yield = (production / area) * 100" },
    { name: "ROI", expr: "roi = (profit / investment) * 100" },
  ];

  function formatResult(res) {
    try {
      if (typeof res === "string") return res;
      if (Array.isArray(res)) return JSON.stringify(res);
      return math.format(res, { precision: 14 });
    } catch { try { return String(res); } catch { return "[unserializable]"; } }
  }

  function evalExpr(input, scope = {}) {
    try {
      if (input === null || input === undefined) return "";
      const raw = String(input).replace(/,/g, ".").trim();
      if (!raw) return "";
      const eq = raw.indexOf("=");
      const toEval = eq >= 0 ? `(${raw.slice(0, eq)}) - (${raw.slice(eq + 1)})` : raw;
      try {
        const r = math.evaluate(toEval, scope);
        return formatResult(r);
      } catch (_e) {
        const node = math.parse(toEval);
        const code = node.compile();
        const r = code.evaluate(scope);
        return formatResult(r);
      }
    } catch (err) {
      return `Error: ${err && err.message ? err.message : "invalid expression"}`;
    }
  }

  function compute() {
    const input = expr || display;
    const res = evalExpr(input);
    setDisplay(String(res));
    setExpr(String(res));
    setHistory((h) => [`${input} = ${res}`, ...h].slice(0, 50));
  }

  function insert(s) { setExpr((p) => (p ? p + s : s)); }
  function square() { const v = expr || display; if (String(v).startsWith("Error")) return; setExpr(`(${v})^2`); }

  function solveForVariable() {
    const raw = (expr || "").trim();
    if (!raw) { setSolveResult("No expression"); return; }
    const varName = (solveVar || "x").trim();
    if (!varName) { setSolveResult("No variable specified"); return; }

    try {
      const eq = raw.indexOf("=");
      const toParse = eq >= 0 ? `(${raw.slice(0, eq)}) - (${raw.slice(eq + 1)})` : raw;
      const fNode = math.parse(toParse);
      let dfNode;
      try { dfNode = math.derivative(fNode, varName); } catch (e) { setSolveResult(`Derivative error: ${e.message}`); return; }
      const fC = fNode.compile();
      const dfC = dfNode.compile();
      let x = Number(initialGuess);
      if (!isFinite(x)) x = 1;
      let converged = false;
      for (let i = 0; i < 80; i++) {
        const scope = { [varName]: x };
        let fx = fC.evaluate(scope);
        let dfx = dfC.evaluate(scope);
        fx = toNumberSafe(fx);
        dfx = toNumberSafe(dfx);
        if (!isFinite(fx) || !isFinite(dfx)) break;
        if (Math.abs(fx) < 1e-12) { converged = true; break; }
        const dx = dfx === 0 ? 0 : fx / dfx;
        const xNew = x - dx;
        if (!isFinite(xNew)) break;
        if (Math.abs(xNew - x) < 1e-12) { x = xNew; converged = true; break; }
        x = xNew;
      }
      if (converged) {
        const pretty = formatResult(x);
        setSolveResult(`${varName} ≈ ${pretty}`);
        setHistory((h) => [`solve(${raw}) => ${varName}=${pretty}`, ...h].slice(0, 50));
      } else {
        setSolveResult("No convergence — try different initial guess or a bracket-based solver");
      }
    } catch (err) {
      setSolveResult(`Solve error: ${err && err.message ? err.message : "unknown"}`);
    }
  }

  // Digital keypad (simple)
  const digitalKeys = [
    ["7","8","9","/"],
    ["4","5","6","*"],
    ["1","2","3","-"],
    ["0",".","=","+"],
  ];

  function onDigitalKey(k) {
    if (k === "=") { compute(); return; }
    insert(k);
  }

  function clearAll() { setExpr(""); setDisplay("0"); setSolveResult(null); }

  // Test suite (adds to history) — existing tests kept, additional ones added
  function runExamples() {
    const examples = [
      { input: "2+2", expect: 4 },
      { input: "sin(pi/2)", expect: 1 },
      { input: "sqrt(16)", expect: 4 },
      { input: "x^2 - 4", solve: true, guess: 1, expectSolveNear: [2, -2] },
      { input: "a*b + c", scope: "a=2,b=3,c=1", expect: 7 },
      { input: "5/0", expectErrorContains: "Infinity" },
      { input: "unknownVar + 1", expectErrorContains: "undefined" },
      { input: "(1+2)*(3+4)", expect: 21 },
      { input: "log(100,10)", expect: 2 },
      // Additional tests
      { input: "exp(1)", expectNear: Math.E },
      { input: "factorial(5)", expect: 120 },
    ];

    examples.forEach((ex) => {
      if (ex.solve) {
        setExpr(ex.input);
        setInitialGuess(String(ex.guess || 1));
        setTimeout(() => solveForVariable(), 0);
      } else if (ex.scope) {
        setExpr(ex.input);
        setTimeout(() => {
          const r = evaluateWithScope(ex.scope);
          setHistory((h) => [`TEST ${ex.input} with ${ex.scope} => ${r}`, ...h].slice(0, 200));
        }, 0);
      } else {
        const r = evalExpr(ex.input);
        setHistory((h) => [`TEST ${ex.input} => ${r}`, ...h].slice(0, 200));
        setDisplay(String(r));
      }
    });
  }

  function evaluateWithScope(scopeString) {
    try {
      const scope = {};
      (scopeString || "").split(",").map(s=>s.trim()).filter(Boolean).forEach(kv => {
        const [k, v] = kv.split("=");
        if (k && v !== undefined) {
          const parsed = Number(v.trim());
          scope[k.trim()] = isFinite(parsed) ? parsed : v.trim();
        }
      });
      const r = evalExpr(expr || display, scope);
      setDisplay(String(r));
      setHistory((h) => [`${expr} with ${scopeString} = ${r}`, ...h].slice(0, 50));
      return r;
    } catch (err) { return `Error: ${err && err.message ? err.message : "invalid scope"}`; }
  }

  return (
    <div className="module-box wide" style={{ padding:12, borderRadius:8 }}>
      <h2>🧮 Calculator</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <input
          className="calc-input"
          value={expr || display}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="Enter expression (use x, sin(), cos(), log(), sqrt(), ^ )"
          spellCheck={false}
          style={{ padding:8, fontSize:16, width:520 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={digitalMode} onChange={(e) => setDigitalMode(e.target.checked)} /> Digital keypad
          </label>
          <button onClick={clearAll}>Clear</button>
          <button onClick={() => runExamples()}>Run tests</button>
        </div>
      </div>

      <div className="calc-controls" style={{ marginTop: 8 }}>
        <button onClick={() => setExpr(s => (s ? s.slice(0, -1) : ""))}>Del</button>
        <button onClick={compute}>=</button>
        <button onClick={square}>x²</button>
        <button onClick={() => insert("sqrt(")}>√</button>
        <button onClick={() => insert("^")}>^</button>
      </div>

      {digitalMode && (
        <div className="digital-pad" style={{ marginTop: 8 }}>
          {digitalKeys.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {row.map(k => (
                <button key={k} onClick={() => onDigitalKey(k)} style={{ minWidth: 44, minHeight: 40 }}>{k}</button>
              ))}
            </div>
          ))}

          <div style={{ marginTop: 6 }}>
            {["sin(","cos(","tan(","log(","ln(","abs(","exp(","pi","e"].map(f => (
              <button key={f} onClick={() => insert(f)} style={{ marginRight: 6 }}>{f}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <h4>Solve / Formula tools</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label> Variable: <input value={solveVar} onChange={(e) => setSolveVar(e.target.value)} style={{ width: 60 }} /></label>
          <label> Initial guess: <input value={initialGuess} onChange={(e) => setInitialGuess(e.target.value)} style={{ width: 100 }} /></label>
          <button onClick={solveForVariable}>Solve for {solveVar}</button>
          <div style={{ marginLeft: 12 }}>{solveResult}</div>
        </div>
      </div>

      <div className="history" style={{ marginTop: 12 }}>
        <h4>History</h4>
        <ul>
          {history.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ marginRight: 12 }}>
          <input type="checkbox" checked={showTegna} onChange={(e) => setShowTegna(e.target.checked)} /> Show Tegnamantri formulas
        </label>
      </div>

      {showTegna && (
        <div style={{ marginTop: 8, padding: 8, border: '1px dashed #ccc', borderRadius: 6 }}>
          <h4>Tegnamantri formulas</h4>
          <ul>
            {tegnamantriFormulas.map(f => (
              <li key={f.name}><strong>{f.name}:</strong> {f.expr}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------ Calendar ------------------
function CalendarModule() {
  const today = new Date();
  const [date, setDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(null);
  const [fixedLeaves, setFixedLeaves] = useState(() => {
    if (!hasLocalStorage) return [];
    try { return JSON.parse(localStorage.getItem("fixed_leaves") || "[]"); } catch { return []; }
  });
  useEffect(() => { if (!hasLocalStorage) return; try { localStorage.setItem("fixed_leaves", JSON.stringify(fixedLeaves)); } catch {} }, [fixedLeaves]);

  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));

  function formatDateISO(d) { return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10) : null; }

  function addFixedLeave(dateStr) {
    if (!dateStr) return;
    if (!fixedLeaves.includes(dateStr)) setFixedLeaves(s => [dateStr, ...s]);
  }

  function removeFixedLeave(dateStr) { setFixedLeaves(s => s.filter(x => x !== dateStr)); }

  return (
    <div className="module-box" style={{ padding:12, borderRadius:8 }}>
      <h2>📅 Calendar</h2>
      <div className="cal-header" style={{ display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={() => setDate(new Date(year, month - 1, 1))}>◀</button>
        <h3 style={{ margin:0 }}>{date.toLocaleString(undefined, { month: "long" })} {year}</h3>
        <button onClick={() => setDate(new Date(year, month + 1, 1))}>▶</button>
      </div>

      <div className="grid-7" style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6, marginTop:8 }}>
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} style={{ textAlign:'center', fontWeight:600 }}>{d}</div>
        ))}

        {cells.map((c, i) => {
          const iso = c ? formatDateISO(c) : null;
          const isFixedLeave = iso && fixedLeaves.includes(iso);
          const isToday = c && c.toDateString() === (new Date()).toDateString();
          const isSelected = c && selectedDate && c.toDateString() === selectedDate.toDateString();
          const day = c ? c.getDay() : null; // 0 Sun ... 6 Sat
          const weekendClass = day === 0 ? 'sun' : day === 6 ? 'sat' : '';

          return (
            <div
              key={i}
              onClick={() => c && setSelectedDate(c)}
              style={{
                padding:8, minHeight:44, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center',
                background: isFixedLeave ? '#fdecea' : isToday ? 'rgba(75,141,248,0.08)' : '#fff',
                border: isSelected ? '2px solid #4b8df8' : '1px solid rgba(0,0,0,0.06)'
              }}
            >
              {c ? c.getDate() : ''}
            </div>
          );
        })}
      </div>

      <div className="cal-footer" style={{ marginTop:12 }}>
        <div>Selected: {selectedDate ? selectedDate.toDateString() : 'None'}</div>
        <div style={{ marginTop: 8 }}>
          <label>Add fixed leave (ISO yyyy-mm-dd): </label>
          <input id="fixed-leave-input" placeholder={new Date().toISOString().slice(0,10)} />
          <button onClick={() => { if (!hasWindow) return alert('Cannot add fixed leave in this environment'); const el = document.getElementById('fixed-leave-input'); addFixedLeave(el.value); el.value=''; }}>Add</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <strong>Fixed leaves:</strong>
          <ul>
            {fixedLeaves.map(f => (
              <li key={f}>{f} <button onClick={() => removeFixedLeave(f)}>Remove</button></li>
            ))}
        </ul>
        </div>

        <div style={{ marginTop: 6 }}>
          <small>Weekend highlighting: Saturday, Sunday. Fixed leaves appear highlighted.</small>
        </div>
      </div>
    </div>
  );
}

// ------------------ Notes (page-level lock) ------------------
function NotesModule() {
  const [pages, setPages] = useState(() => {
    if (!hasLocalStorage) return [];
    try { return JSON.parse(localStorage.getItem('notes_pages') || '[]'); } catch { return []; }
  });
  const [currentPageId, setCurrentPageId] = useState(() => {
    if (!hasLocalStorage) return null;
    try { return localStorage.getItem('notes_current') || (pages[0] ? pages[0].id : null); } catch { return null; }
  });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState(null);

  useEffect(() => { if (!hasLocalStorage) return; try { localStorage.setItem('notes_pages', JSON.stringify(pages)); } catch {} }, [pages]);
  useEffect(() => { if (!hasLocalStorage) return; try { localStorage.setItem('notes_current', currentPageId || ''); } catch {} }, [currentPageId]);

  function newPage() {
    const id = `p_${Date.now()}`;
    const page = { id, title: 'Untitled', content: '', locked: false, pin: null };
    setPages(s => [page, ...s]);
    setCurrentPageId(id);
    setEditingId(id);
    setTitle(page.title); setContent(page.content);
  }

  function loadPage(id) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    if (p.locked) {
      if (!hasWindow) return alert('Cannot unlock page in this environment');
      const entered = prompt('Page is locked — enter PIN to unlock');
      if (entered !== p.pin) { alert('Wrong PIN'); return; }
    }
    setCurrentPageId(id);
    setEditingId(id);
    setTitle(p.title); setContent(p.content);
  }

  function saveCurrent() {
    if (!editingId) return;
    setPages(s => s.map(pg => pg.id === editingId ? { ...pg, title, content } : pg));
    if (hasWindow) alert('Saved');
  }

  function setPageLock(id) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    if (p.locked) {
      if (!hasWindow) return alert('Cannot unlock page in this environment');
      const entered = prompt('Enter PIN to unlock page');
      if (entered === p.pin) {
        setPages(s => s.map(pg => pg.id === id ? { ...pg, locked: false } : pg));
      } else alert('Wrong PIN');
    } else {
      if (!hasWindow) return alert('Cannot set PIN in this environment');
      const newPin = prompt('Set a 4+ digit PIN to lock this page:');
      if (!newPin) return;
      setPages(s => s.map(pg => pg.id === id ? { ...pg, locked: true, pin: newPin } : pg));
    }
  }

  function removePage(id) { if (hasWindow && !confirm('Delete page?')) return; setPages(s => s.filter(p => p.id !== id)); if (currentPageId === id) { setCurrentPageId(null); setEditingId(null); setTitle(''); setContent(''); } }

  return (
    <div className="module-box" style={{ padding:12, borderRadius:8 }}>
      <h2>🔐 Notes — Page-level lock</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 260 }}>
          <button onClick={newPage}>New page</button>
          <div style={{ marginTop: 8 }}>
            {pages.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <button onClick={() => loadPage(p.id)} style={{ flex: 1 }}>{p.title || 'Untitled'}</button>
                <div>
                  <button onClick={() => setPageLock(p.id)}>{p.locked ? 'Unlock' : 'Lock'}</button>
                  <button onClick={() => removePage(p.id)}>Del</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          {editingId ? (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ width: '100%', marginBottom: 8 }} />
              <textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} style={{ width: '100%' }} />
              <div style={{ marginTop: 8 }}>
                <button onClick={saveCurrent}>Save</button>
                <button onClick={() => { setPages(s => s.map(pg => pg.id === editingId ? { ...pg, content } : pg)); if (hasWindow) alert('Saved (quick)'); }}>Quick Save</button>
                <button onClick={() => setPageLock(editingId)}>{pages.find(p=>p.id === editingId)?.locked ? 'Unlock page' : 'Lock page'}</button>
              </div>
            </>
          ) : (
            <div>Select or create a page to edit</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------ Alarm (clock + trade presets + ringtones) ------------------
function AlarmModule() {
  const [time, setTime] = useState('');
  const [alarms, setAlarms] = useState(() => { 
    if (!hasLocalStorage) return []; 
    try { return JSON.parse(localStorage.getItem('alarms')||'[]'); } catch { return []; } 
  });
  const [clockNow, setClockNow] = useState(new Date());
  const timers = useRef({});
  const [ringtone, setRingtone] = useState('Beep');
  const [recurring, setRecurring] = useState(false);
  
  // Ref to hold the latest ringtone value for setTimeout
  const ringtoneRef = useRef(ringtone);
  useEffect(() => {
    ringtoneRef.current = ringtone;
  }, [ringtone]);

  // 1. Persist alarms to localStorage
  useEffect(() => { 
    if (!hasLocalStorage) return; 
    localStorage.setItem('alarms', JSON.stringify(alarms)); 
  }, [alarms]);

  // 2. Set up clock interval
  useEffect(() => {
    const t = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  function playTone(type = 'Beep') {
    if (!hasWindow) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return console.warn('Audio not supported');
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      if (type === 'Beep') { o.frequency.value = 880; g.gain.value = 0.05; }
      else if (type === 'Chime') { o.frequency.value = 660; g.gain.value = 0.04; }
      else if (type === 'Bell') { o.frequency.value = 520; g.gain.value = 0.06; }
      else { o.frequency.value = 880; g.gain.value = 0.05; }
      o.start();
      setTimeout(() => { try { o.stop(); ctx.close(); } catch {} }, 1400);
    } catch (e) { console.log('Audio error', e); if (hasWindow) alert('Cannot play ringtone in this browser'); }
  }

  function schedule(isoOrObj) {
    if (!hasWindow) return;
    
    const obj = typeof isoOrObj === 'string' ? { iso: isoOrObj, recurring: false } : isoOrObj;
    try {
      if (!obj || !obj.iso) return;

      // Clear existing timer if any
      if (timers.current[obj.iso]) {
        clearTimeout(timers.current[obj.iso]);
        delete timers.current[obj.iso];
      }

      const t = new Date(obj.iso);
      const diff = t - new Date();

      // If the alarm time is in the past
      if (diff <= 0) {
        if (obj.recurring) {
          // Schedule for the next day
          const next = new Date(t.getTime() + 24 * 3600 * 1000).toISOString();
          // Update the alarms list to the next day's time
          setAlarms(s => s.map(a => a.iso === obj.iso ? { ...a, iso: next } : a));
          // Schedule the new alarm time
          schedule({ ...obj, iso: next });
        } else {
          // Remove non-recurring past alarms
          setAlarms(s => s.filter(a => a.iso !== obj.iso));
        }
        return;
      }

      // Schedule the timer
      timers.current[obj.iso] = setTimeout(() => {
        if (hasWindow) alert('⏰ Alarm! ' + t.toLocaleString());
        playTone(ringtoneRef.current);
        
        if (obj.recurring) {
          const next = new Date(t.getTime() + 24 * 3600 * 1000).toISOString();
          // Use functional setAlarms to ensure we have the latest list before updating
          setAlarms(s => [{ iso: next, recurring: true }, ...s.filter(a => a.iso !== obj.iso)]);
          // Re-schedule the alarm for the next day
          schedule({ iso: next, recurring: true });
        } else {
          setAlarms(s => s.filter(a => a.iso !== obj.iso));
        }
        delete timers.current[obj.iso];
      }, diff);
    } catch (e) { console.log('schedule error', e); }
  }

  // 3. Effect to manage system timers when 'alarms' state changes
  useEffect(() => {
    // 1. Clear all existing timers
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    
    // 2. Schedule all alarms in the current state
    alarms.forEach(a => schedule(a));

    // 3. Cleanup function to clear all timers on unmount or re-run
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    };
  }, [alarms]); // Re-run whenever the 'alarms' list is updated

  function add() {
    if (!time) return hasWindow ? alert('Select time') : console.warn('Select time');
    const iso = new Date(time).toISOString();
    const obj = { iso, recurring };

    // Check for exact duplicates
    if (alarms.some(a => a.iso === iso && a.recurring === recurring)) {
      if (hasWindow) alert('Alarm already set for this exact time and recurrence.');
      return;
    }

    setAlarms(s => [obj, ...s]);
    setTime('');
  }

  function remove(a) { 
    try { 
      if (timers.current[a.iso]) clearTimeout(timers.current[a.iso]); 
      delete timers.current[a.iso];
    } catch {} 
    setAlarms(s => s.filter(x => x.iso !== a.iso)); 
  }

  function addTradePreset(kind = 'open') {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    let timeStr, msg;
    
    if (kind === 'open') {
      timeStr = new Date(y, m, d, 9, 15, 0).toISOString();
      msg = 'Added trade open alarm (09:15) — recurring daily';
    } else if (kind === 'close') {
      timeStr = new Date(y, m, d, 15, 30, 0).toISOString();
      msg = 'Added trade close alarm (15:30) — recurring daily';
    }
    
    const obj = { iso: timeStr, recurring: true };

    // Check for duplicates based on time and recurring status
    if (alarms.some(a => new Date(a.iso).getHours() === new Date(obj.iso).getHours() && new Date(a.iso).getMinutes() === new Date(obj.iso).getMinutes() && a.recurring)) {
      if (hasWindow) alert('Trade preset alarm already exists.');
      return;
    }

    setAlarms(s => [obj, ...s]);
    if (hasWindow) alert(msg);
  }

  return (
    <div className="module-box" style={{ padding:12, borderRadius:8 }}>
      <h2>⏰ Alarm & Clock</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ fontSize: 18 }}>
          <strong>Local time:</strong>
          <div style={{ fontSize: 20 }}>{clockNow.toLocaleTimeString()} — {clockNow.toLocaleDateString()}</div>
        </div>

        <div>
          <label>Ringtone: </label>
          <select value={ringtone} onChange={(e) => setRingtone(e.target.value)}>
            <option>Beep</option>
            <option>Chime</option>
            <option>Bell</option>
          </select>
          <button onClick={() => playTone(ringtone)}>Test</button>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        <label style={{ marginLeft: 8 }}><input type="checkbox" checked={recurring} onChange={(e)=>setRecurring(e.target.checked)} /> Recurring</label>
        <button onClick={add}>Add</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Trade presets:</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={() => addTradePreset('open')}>Add Market Open (09:15)</button>
          <button onClick={() => addTradePreset('close')}>Add Market Close (15:30)</button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <h4>Scheduled alarms</h4>
        <ul>
          {alarms.map((a) => (
            <li key={a.iso}>
              {new Date(a.iso).toLocaleString()} {a.recurring ? '(recurring)' : ''}
              <button onClick={() => remove(a)} style={{ marginLeft: 8 }}>Cancel</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ------------------ Main App ------------------
export default function App() {
  const sections = ['Calculator','Calendar','Notes','Alarm'];
  const [bgImage, setBgImage] = useState('');
  const [selectedSection, setSelectedSection] = useState('Calculator');
  const [globalHistory, setGlobalHistory] = useState([]);

  useEffect(() => {
    async function fetchBg() {
      try {
        const res = await axios.get('https://source.unsplash.com/1600x900/?mahadev,shiv,temple,sky,night');
        // only set when in browser
        if (hasWindow && res && res.request) setBgImage(res.request.responseURL || '');
      } catch (e) { console.log('Image fetch error:', e); }
    }
    fetchBg();
  }, []);

  function pushHistory(item) { if (!item) return; setGlobalHistory(s => [item, ...s].slice(0,100)); }

  const renderSection = () => {
    switch (selectedSection) {
      case 'Calculator': return <CalculatorModule onPushHistory={pushHistory} />;
      case 'Calendar': return <CalendarModule />;
      case 'Notes': return <NotesModule />;
      case 'Alarm': return <AlarmModule />;
      default: return null;
    }
  };

  return (
    <div style={{ display:'flex', minHeight:'100vh', backgroundImage: bgImage ? `url(${bgImage})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <aside style={{ width:180, padding:16, background:'rgba(255,255,255,0.9)' }}>
        <h2 style={{ marginTop:0 }}>🪄 Jadugar</h2>
        {sections.map(s => (
          <button key={s} style={{ display:'block', width:'100%', marginBottom:8, padding:8, background: selectedSection === s ? '#4b8df8' : '#fff', color: selectedSection === s ? '#fff' : '#000' }} onClick={() => setSelectedSection(s)}>{s}</button>
        ))}
      </aside>

      <div style={{ flex:1, padding:20, overflow:'auto' }}>{renderSection()}</div>

    </div>
  );
}