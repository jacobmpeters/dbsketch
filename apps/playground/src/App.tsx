import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { compile, compileSql } from '@dbsketch/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

type Mode = 'dbml' | 'sql';

const EXAMPLES: { label: string; mode: Mode; value: string }[] = [
  {
    label: 'Blog',
    mode: 'dbml',
    value: `Table users {
  id int [pk]
  email varchar
  created_at timestamp
}

Table posts {
  id int [pk]
  user_id int [ref: > users.id]
  title varchar
  body text
  published_at timestamp
}

Table comments {
  id int [pk]
  post_id int [ref: > posts.id]
  user_id int [ref: > users.id]
  body text
}`,
  },
  {
    label: 'E-commerce',
    mode: 'dbml',
    value: `Table customers {
  id int [pk]
  email varchar
  name varchar
  created_at timestamp
}

Table addresses {
  id int [pk]
  customer_id int [ref: > customers.id]
  line1 varchar
  city varchar
  country varchar
}

Table categories {
  id int [pk]
  name varchar
  parent_id int [ref: > categories.id]
}

Table products {
  id int [pk]
  category_id int [ref: > categories.id]
  name varchar
  price decimal
  stock int
}

Table orders {
  id int [pk]
  customer_id int [ref: > customers.id]
  address_id int [ref: > addresses.id]
  status varchar
  placed_at timestamp
}

Table order_items {
  id int [pk]
  order_id int [ref: > orders.id]
  product_id int [ref: > products.id]
  quantity int
  unit_price decimal
}`,
  },
  {
    label: 'SaaS',
    mode: 'dbml',
    value: `Table organizations {
  id int [pk]
  name varchar
  slug varchar
  created_at timestamp
}

Table users {
  id int [pk]
  org_id int [ref: > organizations.id]
  email varchar
  role varchar
  created_at timestamp
}

Table plans {
  id int [pk]
  name varchar
  price_monthly decimal
  price_annual decimal
}

Table subscriptions {
  id int [pk]
  org_id int [ref: > organizations.id]
  plan_id int [ref: > plans.id]
  status varchar
  current_period_end timestamp
}

Table audit_logs {
  id int [pk]
  org_id int [ref: > organizations.id]
  user_id int [ref: > users.id]
  action varchar
  created_at timestamp
}`,
  },
  {
    label: 'Blog (SQLite)',
    mode: 'sql',
    value: `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  published_at TEXT
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id),
  user_id INTEGER REFERENCES users(id),
  body TEXT
);`,
  },
  {
    label: 'E-commerce (SQLite)',
    mode: 'sql',
    value: `CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  line1 TEXT,
  city TEXT,
  country TEXT
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  price REAL,
  stock INTEGER
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  address_id INTEGER REFERENCES addresses(id),
  status TEXT,
  placed_at TEXT
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER,
  unit_price REAL
);`,
  },
  {
    label: 'SaaS (SQLite)',
    mode: 'sql',
    value: `CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id),
  email TEXT NOT NULL,
  role TEXT,
  created_at TEXT
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly REAL,
  price_annual REAL
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id),
  plan_id INTEGER REFERENCES plans(id),
  status TEXT,
  current_period_end TEXT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),
  action TEXT,
  created_at TEXT
);`,
  },
  {
    label: 'Data warehouse',
    mode: 'dbml',
    value: `Table sales_fact {
  id int [pk]
  date_id int [ref: > date_dim.id]
  product_id int [ref: > product_dim.id]
  customer_id int [ref: > customer_dim.id]
  store_id int [ref: > store_dim.id]
  quantity int
  revenue decimal
}

Table date_dim {
  id int [pk]
  date date
  year int
  quarter int
  month int
}

Table product_dim {
  id int [pk]
  name varchar
  category varchar
  brand varchar
  price decimal
}

Table customer_dim {
  id int [pk]
  name varchar
  email varchar
  region varchar
  segment varchar
}

Table store_dim {
  id int [pk]
  name varchar
  city varchar
  country varchar
  region varchar
}

`,
  },
  {
    label: 'pin',
    mode: 'dbml',
    value: `Table regions {
  id int [pk]
  name varchar
}

Table stores {
  id int [pk]
  region_id int [ref: > regions.id]
  name varchar
  city varchar
}

Table employees {
  id int [pk]
  store_id int [ref: > stores.id]
  name varchar
  role varchar
}

Table shifts {
  id int [pk]
  employee_id int [ref: > employees.id]
  start_time timestamp
  end_time timestamp
}

@layout {
  pin regions at col 0
  pin stores at col 1
  pin employees at col 2
  pin shifts at col 3
}`,
  },
  {
    label: 'center',
    mode: 'dbml',
    value: `Table sales {
  id int [pk]
  date_id int [ref: > dates.id]
  product_id int [ref: > products.id]
  customer_id int [ref: > customers.id]
  store_id int [ref: > stores.id]
  revenue decimal
  units int
}

Table dates {
  id int [pk]
  date date
  year int
  quarter int
}

Table products {
  id int [pk]
  name varchar
  category varchar
  price decimal
}

Table customers {
  id int [pk]
  name varchar
  region varchar
}

Table stores {
  id int [pk]
  name varchar
  city varchar
}

@layout {
  center sales { left: dates, customers right: products, stores }
}`,
  },
  {
    label: 'preserve_order',
    mode: 'dbml',
    value: `Table events {
  id int [pk]
  category_id int [ref: > categories.id]
  name varchar
  user_id int [ref: > users.id]
  metadata text
  created_at timestamp
}

Table categories {
  id int [pk]
  name varchar
  color varchar
}

Table users {
  id int [pk]
  email varchar
  role varchar
}

@layout {
  preserve_order events
}`,
  },
];

const INITIAL_DBML = EXAMPLES.find(e => e.label === 'Data warehouse')!.value;

const MONO = '"JetBrains Mono", monospace';
// For the output pane we need a font with guaranteed full box-drawing coverage
// (including arc variants ╭╮╰╯). System terminal fonts carry this by definition.
const OUTPUT_MONO = 'ui-monospace, "Cascadia Code", Menlo, "Courier New", monospace';

type Theme = {
  BG: string; BG2: string; BORDER: string;
  FG: string; FG_DIM: string;
  ACCENT: string; GREEN: string; YELLOW: string;
  ACTIVE_LINE: string; SELECTION: string;
  STRING_COLOR: string; NUMBER_COLOR: string;
  dark: boolean;
};

const DARK: Theme = {
  BG: '#0d1117', BG2: '#161b22', BORDER: '#30363d',
  FG: '#c9d1d9', FG_DIM: '#8b949e',
  ACCENT: '#58a6ff', GREEN: '#3fb950', YELLOW: '#d29922',
  ACTIVE_LINE: '#1c2128', SELECTION: '#264f78',
  STRING_COLOR: '#a5d6ff', NUMBER_COLOR: '#79c0ff',
  dark: true,
};

const LIGHT: Theme = {
  BG: '#ffffff', BG2: '#f6f8fa', BORDER: '#d0d7de',
  FG: '#1f2328', FG_DIM: '#656d76',
  ACCENT: '#0969da', GREEN: '#1a7f37', YELLOW: '#9a6700',
  ACTIVE_LINE: '#eaeef2', SELECTION: '#add6ff',
  STRING_COLOR: '#0a3069', NUMBER_COLOR: '#0550ae',
  dark: false,
};

const ThemeCtx = createContext<Theme>(DARK);

function encodeSchema(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeSchema(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return '';
  }
}

function loadFromHash(): { value: string; mode: Mode } | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const colonIdx = hash.indexOf(':');
  if (colonIdx === -1) return null;
  const modeStr = hash.slice(0, colonIdx);
  const encoded = hash.slice(colonIdx + 1);
  const value = decodeSchema(encoded);
  if (!value) return null;
  return { value, mode: modeStr === 'sql' ? 'sql' : 'dbml' };
}


function BoxBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  const { FG, FG_DIM, BORDER } = useContext(ThemeCtx);
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: MONO,
        fontSize: 12,
        background: 'transparent',
        color: hover ? FG : FG_DIM,
        border: `1px solid ${hover ? BORDER : 'transparent'}`,
        borderRadius: 3,
        padding: '2px 8px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'color 0.1s, border-color 0.1s',
      }}
    >
      {children}
    </button>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const { BG2, ACCENT, FG_DIM } = useContext(ThemeCtx);
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: MONO,
        fontSize: 12,
        background: active ? BG2 : 'transparent',
        color: active ? ACCENT : FG_DIM,
        border: 'none',
        padding: '2px 10px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

const FONT_SIZE = 14;
const PAD = 20;

function DiagramCanvas({ diagram, autofit }: { diagram: string; autofit: boolean }) {
  const { BG, FG, YELLOW } = useContext(ThemeCtx);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const lines = useMemo(() => diagram.split('\n'), [diagram]);
  const cols  = useMemo(() => Math.max(...lines.map(l => l.length)), [lines]);
  const rows  = lines.length;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    // Measure character width at base font size
    const probe = canvas.getContext('2d')!;
    probe.font = `${FONT_SIZE}px ${OUTPUT_MONO}`;
    const baseCw = probe.measureText('M').width;

    // In autofit mode, compute a cell size that fills the container
    let cw = baseCw;
    let ch = FONT_SIZE;
    let canvasW: number;
    let canvasH: number;
    let padX = PAD;
    let padY = PAD;

    if (autofit && containerSize.w > 0 && containerSize.h > 0) {
      const scaleX = containerSize.w / (cols * baseCw + PAD * 2);
      const scaleY = containerSize.h / (rows * FONT_SIZE + PAD * 2);
      const s = Math.min(scaleX, scaleY);
      cw = baseCw * s;
      ch = FONT_SIZE * s;
      canvasW = containerSize.w;
      canvasH = containerSize.h;
      padX = Math.max(0, (containerSize.w - cols * cw) / 2);
      padY = Math.max(0, (containerSize.h - rows * ch) / 2);
    } else {
      canvasW = cols * cw + PAD * 2;
      canvasH = rows * ch + PAD * 2;
    }

    canvas.width  = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width  = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.font = `${cw / baseCw * FONT_SIZE}px ${OUTPUT_MONO}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = diagram.startsWith('-- error') ? YELLOW : FG;
    lines.forEach((line, row) => {
      [...line].forEach((char, col) => {
        ctx.fillText(char, padX + col * cw, padY + row * ch);
      });
    });
  }, [diagram, lines, cols, rows, autofit, containerSize, BG, FG, YELLOW]);

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, background: BG, overflow: autofit ? 'hidden' : 'auto' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { FG, FG_DIM, GREEN } = useContext(ThemeCtx);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: MONO, fontSize: 12, color: checked ? FG : FG_DIM, userSelect: 'none' }}>
      <span style={{ color: checked ? GREEN : FG_DIM }}>{checked ? '[x]' : '[ ]'}</span>
      {label}
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
    </label>
  );
}

export default function App() {
  const initial = loadFromHash();
  const [mode, setMode]         = useState<Mode>(initial?.mode ?? 'dbml');
  const [source, setSource]     = useState(initial?.value ?? INITIAL_DBML);
  const [noTypes, setNoTypes]   = useState(false);
  const [noColumns, setNoColumns] = useState(false);
  const [lightMode, setLightMode] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);

  const [autofit, setAutofit]   = useState(true);
  const [copyLabel, setCopyLabel]   = useState('copy');
  const [linkLabel, setLinkLabel]   = useState('link');
  const [splitPct, setSplitPct]     = useState(33);
  const splitDragRef  = useRef<{ startX: number; startPct: number; containerW: number } | null>(null);
  const panesRef      = useRef<HTMLDivElement>(null);

  const theme = lightMode ? LIGHT : DARK;
  const { BG, BG2, BORDER, FG, FG_DIM, ACCENT, GREEN, YELLOW,
          ACTIVE_LINE, SELECTION, STRING_COLOR, NUMBER_COLOR } = theme;

  const terminalTheme = useMemo(() => EditorView.theme({
    '&': { background: BG, color: FG, fontFamily: MONO, fontSize: '13px', width: '100%', textAlign: 'left' },
    '.cm-content': { caretColor: ACCENT, padding: '16px 0', textAlign: 'left' },
    '.cm-cursor': { borderLeftColor: ACCENT },
    '.cm-gutters': { background: BG2, color: FG_DIM, borderRight: `1px solid ${BORDER}` },
    '.cm-gutterElement': { paddingLeft: '8px', paddingRight: '8px' },
    '.cm-activeLineGutter': { background: ACTIVE_LINE },
    '.cm-activeLine': { background: ACTIVE_LINE },
    '.cm-selectionBackground, ::selection': { background: `${SELECTION} !important` },
    '.cm-line': { paddingLeft: '12px' },
    '.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: MONO },
  }, { dark: theme.dark }), [theme]);

  const syntaxTheme = useMemo(() => syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword,                              color: ACCENT },
    { tag: [tags.typeName, tags.standard(tags.name)], color: GREEN },
    { tag: tags.string,                               color: STRING_COLOR },
    { tag: tags.comment,                              color: FG_DIM, fontStyle: 'italic' },
    { tag: [tags.operator, tags.punctuation],         color: YELLOW },
    { tag: tags.number,                               color: NUMBER_COLOR },
    { tag: [tags.name, tags.variableName, tags.propertyName, tags.attributeName], color: FG },
  ])), [theme]);

  useEffect(() => {
    const encoded = encodeSchema(source);
    window.history.replaceState(null, '', `#${mode}:${encoded}`);
  }, [source, mode]);

  const diagram = useMemo(() => {
    if (!source.trim()) return '';
    try {
      const opts = {
        glyphs: 'unicode' as const,
        showTypes: !noTypes,
        showColumns: !noColumns,
      };
      const raw = mode === 'sql'
        ? compileSql(source, 'postgres', opts)
        : compile(source, opts);
      return raw.replace(/\r/g, '').trimEnd();
    } catch (e) {
      return `-- error: ${(e as Error).message}`;
    }
  }, [source, mode, noTypes, noColumns]);

  const lineCount   = source.split('\n').length;
  const outputLines = diagram ? diagram.split('\n').length : 0;

  const copyDiagram = useCallback(async () => {
    await navigator.clipboard.writeText(diagram);
    setCopyLabel('copied!');
    setTimeout(() => setCopyLabel('copy'), 2000);
  }, [diagram]);

  const downloadFile = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadSource = useCallback(() => {
    downloadFile(source, mode === 'sql' ? 'schema.sql' : 'schema.dbml');
  }, [source, mode, downloadFile]);

  const downloadMarkdown = useCallback(() => {
    const ext = mode === 'sql' ? 'sql' : 'dbml';
    const md = [
      `<!-- dbsketch src="schema.${ext}" -->`,
      '',
      '```dbsketch-rendered',
      diagram,
      '```',
      '',
    ].join('\n');
    downloadFile(md, 'schema.md');
  }, [mode, diagram, downloadFile]);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setLinkLabel('copied!');
    setTimeout(() => setLinkLabel('link'), 2000);
  }, []);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const containerW = panesRef.current?.offsetWidth ?? window.innerWidth;
    splitDragRef.current = { startX: e.clientX, startPct: splitPct, containerW };
    const onMouseMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return;
      const { startX, startPct, containerW } = splitDragRef.current;
      const delta = ev.clientX - startX;
      setSplitPct(Math.max(20, Math.min(80, startPct + (delta / containerW) * 100)));
    };
    const onMouseUp = () => {
      splitDragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [splitPct]);

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: FG, fontFamily: MONO }}>

      {/* Title bar */}
      <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12, background: BG2 }}>
        <a
          href="https://github.com/jacobmpeters/dbsketch"
          target="_blank"
          rel="noreferrer"
          style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, textDecoration: 'none', color: FG, letterSpacing: '-0.3px' }}
        >
          dbsketch
        </a>
        <span style={{ color: BORDER }}>│</span>
        <span style={{ color: FG_DIM, fontSize: 12 }}>schema → diagram</span>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '4px 12px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: BG }}>

        {/* Mode toggle */}
        <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
          <ToggleBtn active={mode === 'dbml'} onClick={() => setMode('dbml')}>DBML</ToggleBtn>
          <span style={{ width: 1, background: BORDER }} />
          <ToggleBtn active={mode === 'sql'}  onClick={() => setMode('sql')}>SQL</ToggleBtn>
        </div>

        <span style={{ color: BORDER }}>│</span>

        {/* Examples */}
        <select
          value=""
          onChange={e => {
            const ex = EXAMPLES.find(x => x.label === e.target.value);
            if (ex) { setSource(ex.value); setMode(ex.mode); }
          }}
          style={{ fontFamily: MONO, fontSize: 12, background: BG2, color: FG_DIM, border: `1px solid ${BORDER}`, borderRadius: 3, padding: '2px 6px', cursor: 'pointer', outline: 'none', colorScheme: lightMode ? 'light' : 'dark' }}
        >
          <option value="" disabled>examples</option>
          <optgroup label="DBML">
            {EXAMPLES.filter(ex => ex.mode === 'dbml' && !['pin', 'center', 'preserve_order'].includes(ex.label)).map(ex => <option key={ex.label} value={ex.label}>{ex.label}</option>)}
          </optgroup>
          <optgroup label="Layout hints">
            {EXAMPLES.filter(ex => ['pin', 'center', 'preserve_order'].includes(ex.label)).map(ex => <option key={ex.label} value={ex.label}>@layout: {ex.label}</option>)}
          </optgroup>
          <optgroup label="SQL">
            {EXAMPLES.filter(ex => ex.mode === 'sql').map(ex => <option key={ex.label} value={ex.label}>{ex.label}</option>)}
          </optgroup>
        </select>

        <span style={{ color: BORDER }}>│</span>

        <CheckBox label="no-types"   checked={noTypes}   onChange={setNoTypes} />
        <CheckBox label="no-columns" checked={noColumns} onChange={setNoColumns} />

        <CheckBox label="autofit"    checked={autofit}   onChange={setAutofit} />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <BoxBtn onClick={() => setLightMode(v => !v)} title="Toggle light/dark mode">[{lightMode ? 'dark' : 'light'}]</BoxBtn>
          <BoxBtn onClick={copyDiagram}    title="Copy rendered diagram">[{copyLabel}]</BoxBtn>
          <BoxBtn onClick={downloadSource} title={`Download .${mode === 'sql' ? 'sql' : 'dbml'} file`}>[↓ {mode.toUpperCase()}]</BoxBtn>
          <BoxBtn onClick={downloadMarkdown} title="Download as .md with rendered block">[↓ .md]</BoxBtn>
          <BoxBtn onClick={copyLink}       title="Copy shareable link">[{linkLabel}]</BoxBtn>
        </div>
      </div>

      {/* Pane label row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, background: BG2, fontSize: 11, color: FG_DIM, fontFamily: MONO }}>
        <div style={{ width: `${splitPct}%`, flexShrink: 0, padding: '3px 16px' }}>
          ── source ({lineCount} lines)
        </div>
        <div style={{ width: 5, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '3px 16px' }}>
          ── diagram ({outputLines} lines)
        </div>
      </div>

      {/* Panes */}
      <div ref={panesRef} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Editor — CodeMirror manages its own scroll */}
        <div style={{ width: `${splitPct}%`, flexShrink: 0, minWidth: 0, overflow: 'hidden', background: BG }}>
          <CodeMirror
            value={source}
            height="100%"
            theme="none"
            extensions={[sql(), terminalTheme, syntaxTheme]}
            onChange={setSource}
            style={{ height: '100%' }}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
          />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDividerMouseDown}
          style={{ width: 5, flexShrink: 0, background: BORDER, cursor: 'col-resize', zIndex: 1 }}
        />

        {/* Output — canvas renderer for pixel-perfect monospace alignment */}
        <DiagramCanvas diagram={diagram} autofit={autofit} />
      </div>

      {/* Status bar */}
      <div style={{ padding: '2px 16px', borderTop: `1px solid ${BORDER}`, background: BG2, fontSize: 11, color: FG_DIM, fontFamily: MONO, display: 'flex', gap: 16 }}>
        <span>dbsketch.dev</span>
        <span style={{ marginLeft: 'auto' }}>
          <a href="https://github.com/jacobmpeters/dbsketch" target="_blank" rel="noreferrer" style={{ color: FG_DIM, textDecoration: 'none' }}>github</a>
          {'  '}·{'  '}
          <a href="https://www.npmjs.com/package/@dbsketch/core" target="_blank" rel="noreferrer" style={{ color: FG_DIM, textDecoration: 'none' }}>npm</a>
        </span>
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
