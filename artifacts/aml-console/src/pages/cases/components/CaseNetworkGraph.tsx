import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import {
  useGetCaseNetwork,
  getGetCaseNetworkQueryKey,
  type NetworkNode,
  type NetworkEdge,
} from '@workspace/api-client-react';
import { Crosshair, LocateFixed, ShieldAlert, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type GNode = NetworkNode & { pulsePhase: number };
type GLink = NetworkEdge;
type FGMethods = ForceGraphMethods<NodeObject<GNode>, LinkObject<GNode, GLink>>;

interface CaseNetworkGraphProps {
  caseId: number;
  height?: number | string;
  /** Extra buttons rendered at the right end of the control bar. */
  actions?: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Palette (kept in sync with the console's cyber theme)               */
/* ------------------------------------------------------------------ */

const KIND_COLORS: Record<string, string> = {
  account: '#22d3ee',
  name: '#7aa2f7',
  account_ref: '#a78bfa',
  instapay_ref: '#2dd4bf',
  cash: '#fbbf24',
};
const FLAG_COLOR = '#f87171';

const EDGE_RGB: Record<'in' | 'out' | 'internal' | 'flagged', string> = {
  in: '52,211,153',
  out: '251,146,60',
  internal: '34,211,238',
  flagged: '248,113,113',
};

function withAlpha(hex: string, a: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function fmtKwd(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(v >= 100 ? 0 : 1);
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
}

function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 6283;
  return h / 1000;
}

const idOf = (v: string | number | NodeObject<GNode>): string =>
  typeof v === 'object' ? String(v.id) : String(v);

/* ------------------------------------------------------------------ */
/* Container size hook                                                 */
/* ------------------------------------------------------------------ */

function useContainerSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref: the measured div mounts only after loading/empty states
  // clear, so a mount-time effect would observe nothing and the size would
  // stay 0x0 forever. Attaching on ref delivery handles late mounts.
  const ref = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  return { ref, size };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function CaseNetworkGraph({ caseId, height = 640, actions }: CaseNetworkGraphProps) {
  const { data, isLoading, error } = useGetCaseNetwork(caseId, {
    query: { queryKey: getGetCaseNetworkQueryKey(caseId), staleTime: 60_000 },
  });

  const fgRef = useRef<FGMethods | undefined>(undefined);
  const { ref: boxRef, size } = useContainerSize();
  const tickCountRef = useRef(0);
  const userTouchedRef = useRef(false);

  const [minPct, setMinPct] = useState(0);
  const [showIn, setShowIn] = useState(true);
  const [showOut, setShowOut] = useState(true);
  const [showInternal, setShowInternal] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [query, setQuery] = useState('');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const accountIds = useMemo(
    () => new Set((data?.nodes ?? []).filter((n) => n.type === 'subject_account').map((n) => n.id)),
    [data],
  );

  const maxEdge = useMemo(
    () => Math.max(1, ...(data?.edges ?? []).map((e) => e.valueKwd)),
    [data],
  );
  const minValue = useMemo(
    () => (minPct <= 0 ? 0 : Math.pow(maxEdge + 1, minPct / 100) - 1),
    [maxEdge, minPct],
  );

  const classOfRaw = useCallback(
    (e: NetworkEdge): 'in' | 'out' | 'internal' =>
      e.kind === 'internal' ? 'internal' : accountIds.has(e.target) ? 'in' : 'out',
    [accountIds],
  );

  /** Filtered graph + adjacency; link/node objects are copies because the
   *  physics engine mutates them in place. */
  const gd = useMemo(() => {
    const srcNodes = data?.nodes ?? [];
    const srcEdges = data?.edges ?? [];
    const byId = new Map(srcNodes.map((n) => [n.id, n]));
    const links: GLink[] = [];
    for (const e of srcEdges) {
      if (e.valueKwd < minValue) continue;
      const cls = classOfRaw(e);
      if (cls === 'in' && !showIn) continue;
      if (cls === 'out' && !showOut) continue;
      if (cls === 'internal' && !showInternal) continue;
      if (flaggedOnly) {
        const sn = byId.get(e.source);
        const tn = byId.get(e.target);
        const touches =
          (sn?.flaggedCount ?? 0) > 0 || (tn?.flaggedCount ?? 0) > 0 || (e.flaggedCount ?? 0) > 0;
        if (!touches) continue;
      }
      links.push({ ...e });
    }
    const used = new Set<string>();
    for (const l of links) {
      used.add(l.source);
      used.add(l.target);
    }
    const nodes: GNode[] = srcNodes
      .filter((n) => used.has(n.id) || n.type === 'subject_account')
      .map((n) => ({ ...n, pulsePhase: phaseOf(n.id) }));
    const adj = new Map<string, Set<string>>();
    for (const l of links) {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source)!.add(l.target);
      adj.get(l.target)!.add(l.source);
    }
    return { nodes, links, adj, byId: new Map(nodes.map((n) => [n.id, n])) };
  }, [data, minValue, showIn, showOut, showInternal, flaggedOnly, classOfRaw]);

  const fgData = useMemo(() => ({ nodes: gd.nodes, links: gd.links }), [gd]);

  const centerId = hoverId ?? selectedId;
  const focusSet = useMemo(() => {
    if (!centerId) return null;
    const s = new Set<string>([centerId]);
    for (const n of gd.adj.get(centerId) ?? []) s.add(n);
    return s;
  }, [centerId, gd]);

  const stats = useMemo(() => {
    let vIn = 0;
    let vOut = 0;
    let vInternal = 0;
    for (const l of gd.links) {
      const cls = l.kind === 'internal' ? 'internal' : accountIds.has(idOf(l.source)) ? 'out' : 'in';
      if (cls === 'in') vIn += l.valueKwd;
      else if (cls === 'out') vOut += l.valueKwd;
      else vInternal += l.valueKwd;
    }
    return { entities: gd.nodes.length, flows: gd.links.length, vIn, vOut, vInternal };
  }, [gd, accountIds]);

  const selected = selectedId ? gd.byId.get(selectedId) ?? null : null;
  const selectedFlows = useMemo(() => {
    if (!selectedId) return [];
    return gd.links
      .filter((l) => idOf(l.source) === selectedId || idOf(l.target) === selectedId)
      .map((l) => {
        const outbound = idOf(l.source) === selectedId;
        const otherId = outbound ? idOf(l.target) : idOf(l.source);
        return {
          outbound,
          internal: l.kind === 'internal',
          otherId,
          otherLabel: gd.byId.get(otherId)?.label ?? otherId,
          valueKwd: l.valueKwd,
          txnCount: l.txnCount,
          flagged: (l.flaggedCount ?? 0) > 0,
        };
      })
      .sort((a, b) => b.valueKwd - a.valueKwd)
      .slice(0, 8);
  }, [selectedId, gd]);

  /* -------------------------- physics tuning -------------------------- */

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as { strength?: (v: number) => void } | undefined;
    charge?.strength?.(-190);
    const link = fg.d3Force('link') as
      | { distance?: (fn: (l: GLink) => number) => void }
      | undefined;
    link?.distance?.((l: GLink) =>
      l.kind === 'internal' ? 115 : 55 + 16 * Math.log10(1 + (l.valueKwd ?? 0)),
    );
  }, [fgData]);

  const didFitRef = useRef(false);
  useEffect(() => {
    didFitRef.current = false;
    tickCountRef.current = 0;
    userTouchedRef.current = false;
  }, [caseId]);

  /* ----------------------------- painters ----------------------------- */

  const paintNode = useCallback(
    (node: NodeObject<GNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const dimmed = focusSet !== null && !focusSet.has(node.id);
      const vol = (node.totalInKwd ?? 0) + (node.totalOutKwd ?? 0);
      const isAccount = node.type === 'subject_account';
      const r = isAccount
        ? Math.max(9, Math.min(16, 6 + 2.4 * Math.log10(1 + vol)))
        : Math.max(3.2, Math.min(13, 2.6 + 2.0 * Math.log10(1 + vol)));
      const base = KIND_COLORS[node.kind ?? 'name'] ?? KIND_COLORS.name;
      const flagged = (node.flaggedCount ?? 0) > 0;
      const active = selectedId === node.id || hoverId === node.id;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.12 : 1;
      ctx.shadowColor = flagged ? FLAG_COLOR : base;
      ctx.shadowBlur = dimmed ? 0 : active ? 22 : 9;

      if (isAccount) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(8,18,28,0.92)';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = base;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.72, 0, 2 * Math.PI);
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = withAlpha(base, 0.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.4, 0, 2 * Math.PI);
        ctx.fillStyle = base;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = withAlpha(base, 0.92);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(8,16,26,0.9)';
        ctx.stroke();
      }

      if (flagged) {
        const pulse = 0.5 + 0.35 * Math.sin(Date.now() / 320 + node.pulsePhase);
        ctx.beginPath();
        ctx.arc(x, y, r + 2.6 + 1.3 * pulse, 0, 2 * Math.PI);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = withAlpha(FLAG_COLOR, dimmed ? 0.12 : 0.25 + 0.55 * pulse);
        ctx.stroke();
      }

      const showLabel =
        labelsOn &&
        (isAccount || active || globalScale >= 1.4 || (focusSet?.has(node.id) ?? false));
      if (showLabel) {
        const fontSize = Math.max(isAccount ? 3.6 : 3, Math.min(12, (isAccount ? 12.5 : 11) / globalScale));
        ctx.font = `${isAccount ? 600 : 400} ${fontSize}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = dimmed
          ? 'rgba(148,163,184,0.25)'
          : flagged
            ? '#fca5a5'
            : isAccount
              ? '#a5f3fc'
              : 'rgba(203,213,225,0.92)';
        ctx.fillText(truncateLabel(node.label, 26), x, y + r + 2.4);
        if (isAccount && node.accountTail) {
          ctx.font = `400 ${fontSize * 0.82}px "JetBrains Mono", monospace`;
          ctx.fillStyle = withAlpha('#67e8f9', dimmed ? 0.2 : 0.6);
          ctx.fillText(`ACCT \u00B7\u00B7\u00B7${node.accountTail}`, x, y + r + 2.4 + fontSize * 1.2);
        }
      }
      ctx.restore();
    },
    [focusSet, labelsOn, selectedId, hoverId],
  );

  const paintPointerArea = useCallback(
    (node: NodeObject<GNode>, color: string, ctx: CanvasRenderingContext2D) => {
      const vol = (node.totalInKwd ?? 0) + (node.totalOutKwd ?? 0);
      const isAccount = node.type === 'subject_account';
      const r = isAccount
        ? Math.max(9, Math.min(16, 6 + 2.4 * Math.log10(1 + vol)))
        : Math.max(3.2, Math.min(13, 2.6 + 2.0 * Math.log10(1 + vol)));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r + 5, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  const linkClass = useCallback(
    (l: LinkObject<GNode, GLink>): 'in' | 'out' | 'internal' =>
      l.kind === 'internal' ? 'internal' : accountIds.has(idOf(l.target as never)) ? 'in' : 'out',
    [accountIds],
  );

  const linkFocused = useCallback(
    (l: LinkObject<GNode, GLink>): boolean => {
      if (!centerId) return true;
      return idOf(l.source as never) === centerId || idOf(l.target as never) === centerId;
    },
    [centerId],
  );

  const linkColor = useCallback(
    (l: LinkObject<GNode, GLink>): string => {
      const focused = linkFocused(l);
      const flagged = (l.flaggedCount ?? 0) > 0;
      const rgb = flagged ? EDGE_RGB.flagged : EDGE_RGB[linkClass(l)];
      const a = !focused ? 0.05 : flagged ? 0.55 : l.kind === 'internal' ? 0.55 : 0.32;
      return `rgba(${rgb},${a})`;
    },
    [linkClass, linkFocused],
  );

  const linkWidth = useCallback(
    (l: LinkObject<GNode, GLink>): number =>
      Math.max(0.4, Math.min(6, 0.9 * Math.log10(1 + (l.valueKwd ?? 0)))),
    [],
  );

  const linkParticles = useCallback(
    (l: LinkObject<GNode, GLink>): number =>
      linkFocused(l) ? Math.max(1, Math.min(5, Math.round(Math.log2(1 + (l.txnCount ?? 0))))) : 0,
    [linkFocused],
  );

  const linkParticleSpeed = useCallback(
    (l: LinkObject<GNode, GLink>): number =>
      Math.max(0.002, Math.min(0.009, 0.002 * Math.log10(1 + (l.valueKwd ?? 0)))),
    [],
  );

  /* ---------------------------- interactions --------------------------- */

  const handleSearch = useCallback(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = gd.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (!hit) return;
    setSelectedId(hit.id);
    const fg = fgRef.current;
    const nx = (hit as NodeObject<GNode>).x;
    const ny = (hit as NodeObject<GNode>).y;
    if (fg && typeof nx === 'number' && typeof ny === 'number') {
      fg.centerAt(nx, ny, 600);
      fg.zoom(2.6, 600);
    }
  }, [query, gd]);

  const toggleFreeze = useCallback(() => setFrozen((f) => !f), []);
  useEffect(() => {
    const nodes = gd.nodes as Array<NodeObject<GNode>>;
    if (frozen) {
      for (const n of nodes) {
        n.fx = n.x;
        n.fy = n.y;
      }
    } else {
      let hadPins = false;
      for (const n of nodes) {
        if (n.fx != null) hadPins = true;
        n.fx = undefined;
        n.fy = undefined;
      }
      if (hadPins) fgRef.current?.d3ReheatSimulation();
    }
  }, [frozen, gd]);

  const fitView = useCallback(() => fgRef.current?.zoomToFit(500, 60), []);

  /* ------------------------------ chrome ------------------------------- */

  const chip = (active: boolean) =>
    `px-2 py-0.5 rounded-sm border text-[10px] font-mono uppercase tracking-wider transition-colors ${
      active
        ? 'border-primary/50 bg-primary/10 text-primary'
        : 'border-border bg-transparent text-muted-foreground hover:text-foreground'
    }`;

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center border border-border rounded-sm bg-card"
        style={{ height }}
      >
        <span className="font-mono text-xs uppercase tracking-widest text-primary animate-pulse">
          Resolving network topology...
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="flex items-center justify-center border border-destructive/40 rounded-sm bg-card"
        style={{ height }}
      >
        <span className="font-mono text-xs uppercase tracking-widest text-destructive">
          Network map unavailable
        </span>
      </div>
    );
  }
  if (!data || data.nodes.length === 0 || data.edges.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 border border-border rounded-sm bg-card cyber-grid"
        style={{ height }}
      >
        <Crosshair className="h-6 w-6 text-muted-foreground" />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No network data
        </span>
        <span className="text-xs text-muted-foreground">
          Upload bank statements to map transaction flows.
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative border border-border rounded-sm overflow-hidden bg-background cyber-grid"
      style={{ height }}
      data-testid="network-graph"
      onPointerDownCapture={() => {
        userTouchedRef.current = true;
      }}
      onWheelCapture={() => {
        userTouchedRef.current = true;
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.06),transparent_65%)]" />

      {/* control bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/75 px-3 py-2 backdrop-blur">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          placeholder="FIND PARTY..."
          className="h-6 w-40 rounded-sm border border-border bg-transparent px-2 font-mono text-[10px] uppercase tracking-wider text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
          data-testid="input-network-search"
        />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">Min</span>
          <input
            type="range"
            min={0}
            max={96}
            value={minPct}
            onChange={(e) => setMinPct(Number(e.target.value))}
            className="h-1 w-28 accent-[hsl(190,90%,50%)]"
            data-testid="slider-min-value"
          />
          <span className="w-14 font-mono text-[10px] text-primary">
            {minValue > 0 ? `${fmtKwd(minValue)} KD` : 'ALL'}
          </span>
        </div>
        <button type="button" className={chip(showIn)} onClick={() => setShowIn((v) => !v)} data-testid="toggle-inflows">
          In
        </button>
        <button type="button" className={chip(showOut)} onClick={() => setShowOut((v) => !v)} data-testid="toggle-outflows">
          Out
        </button>
        <button type="button" className={chip(showInternal)} onClick={() => setShowInternal((v) => !v)} data-testid="toggle-internal">
          Internal
        </button>
        <button type="button" className={chip(flaggedOnly)} onClick={() => setFlaggedOnly((v) => !v)} data-testid="toggle-flagged">
          Flagged
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={chip(labelsOn)} onClick={() => setLabelsOn((v) => !v)}>
          Labels
        </button>
        <button type="button" className={chip(frozen)} onClick={toggleFreeze}>
          Freeze
        </button>
        <button type="button" className={chip(false)} onClick={fitView} data-testid="button-fit-view">
          <span className="inline-flex items-center gap-1">
            <LocateFixed className="h-3 w-3" />
            Fit
          </span>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:inline">
            {stats.entities} entities {'\u00B7'} {stats.flows} flows {'\u00B7'} in {fmtKwd(stats.vIn)}{' '}
            {'\u00B7'} out {fmtKwd(stats.vOut)}
            {stats.vInternal > 0 ? ` \u00B7 self ${fmtKwd(stats.vInternal)}` : ''}
          </span>
          {actions}
        </div>
      </div>

      {/* graph canvas */}
      <div ref={boxRef} className="absolute inset-0 pt-10">
        {size.width > 4 && size.height > 4 && (
          <ForceGraph2D
            ref={fgRef as MutableRefObject<FGMethods>}
            width={size.width}
            height={size.height}
            graphData={fgData}
            autoPauseRedraw={false}
            cooldownTime={12_000}
            d3VelocityDecay={0.28}
            minZoom={0.35}
            maxZoom={9}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintPointerArea}
            nodeLabel={() => ''}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkLineDash={(l) => (l.kind === 'internal' ? [4, 3] : null)}
            linkDirectionalArrowLength={3.4}
            linkDirectionalArrowRelPos={0.58}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalParticles={linkParticles}
            linkDirectionalParticleSpeed={linkParticleSpeed}
            linkDirectionalParticleWidth={2.2}
            linkDirectionalParticleColor={linkColor}
            onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
            onNodeClick={(n) => setSelectedId((cur) => (cur === n.id ? null : String(n.id)))}
            onNodeDragEnd={(n) => {
              n.fx = n.x;
              n.fy = n.y;
            }}
            onBackgroundClick={() => setSelectedId(null)}
            onEngineTick={() => {
              // Early fits: pull the settling constellation into view right
              // away instead of waiting for the engine to cool down. Stops
              // the moment the analyst takes over the viewport.
              tickCountRef.current++;
              if (
                (tickCountRef.current === 35 || tickCountRef.current === 150) &&
                !userTouchedRef.current
              ) {
                fgRef.current?.zoomToFit(400, 80);
              }
            }}
            onEngineStop={() => {
              if (!didFitRef.current && !userTouchedRef.current) {
                didFitRef.current = true;
                fgRef.current?.zoomToFit(500, 70);
              }
            }}
          />
        )}
      </div>

      {/* legend */}
      <div className="absolute bottom-2 left-2 z-20 rounded-sm border border-border/60 bg-background/75 p-2 backdrop-blur">
        <div className="grid grid-cols-1 gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border" style={{ borderColor: KIND_COLORS.account, background: 'rgba(8,18,28,0.9)' }} />
            Subject account
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS.name }} />
            Counterparty
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS.account_ref }} />
            Masked ref
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS.instapay_ref }} />
            Instapay ref
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS.cash }} />
            Cash
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full ring-1" style={{ background: 'transparent', boxShadow: `0 0 0 1px ${FLAG_COLOR}` }} />
            Rule-flagged
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: `rgba(${EDGE_RGB.in},0.8)` }} />
            Inflow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: `rgba(${EDGE_RGB.out},0.8)` }} />
            Outflow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: `repeating-linear-gradient(90deg, rgba(${EDGE_RGB.internal},0.9) 0 4px, transparent 4px 7px)` }} />
            Own-account move
          </span>
        </div>
      </div>

      {/* dossier */}
      {selected && (
        <div
          className="cyber-panel absolute bottom-3 right-3 top-12 z-20 w-72 overflow-y-auto rounded-sm border border-primary/25 p-3"
          data-testid="panel-node-dossier"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                {selected.type === 'subject_account'
                  ? 'Subject account'
                  : `Counterparty \u00B7 ${(selected.kind ?? 'name').replace('_', ' ')}`}
              </div>
              <div className="mt-0.5 break-words font-mono text-sm font-semibold text-foreground">
                {selected.label}
              </div>
              {selected.type === 'subject_account' && selected.accountTail && (
                <div className="font-mono text-[10px] text-primary/80">{`ACCT \u00B7\u00B7\u00B7${selected.accountTail}`}</div>
              )}
              {selected.country && (
                <div className="font-mono text-[10px] uppercase text-muted-foreground">
                  {selected.country}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-close-dossier"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-sm border border-border bg-background/60 p-2">
              <div className="font-mono text-[9px] uppercase text-muted-foreground">Received</div>
              <div className="font-mono text-sm text-emerald-400">
                {selected.totalInKwd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[9px] text-muted-foreground">KWD</div>
            </div>
            <div className="rounded-sm border border-border bg-background/60 p-2">
              <div className="font-mono text-[9px] uppercase text-muted-foreground">Sent</div>
              <div className="font-mono text-sm text-orange-400">
                {selected.totalOutKwd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[9px] text-muted-foreground">KWD</div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>{selected.txnCount} transactions</span>
            {(selected.flaggedCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-red-400">
                <ShieldAlert className="h-3 w-3" />
                {selected.flaggedCount} flagged
              </span>
            )}
          </div>

          {(selected.flagIds ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(selected.flagIds ?? []).map((f) => (
                <span
                  key={f}
                  className="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-red-400"
                >
                  {f}
                </span>
              ))}
            </div>
          )}

          {selectedFlows.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Top flows
              </div>
              <div className="space-y-1">
                {selectedFlows.map((f) => (
                  <button
                    key={`${f.outbound ? 'o' : 'i'}:${f.otherId}`}
                    type="button"
                    onClick={() => setSelectedId(f.otherId)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/50 px-2 py-1 text-left hover:border-primary/40"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                      <span className={f.outbound ? 'text-orange-400' : 'text-emerald-400'}>
                        {f.outbound ? '\u2192' : '\u2190'}
                      </span>{' '}
                      {f.otherLabel}
                      {f.internal && <span className="text-primary">{' \u00B7 self'}</span>}
                    </span>
                    <span className={`font-mono text-[10px] ${f.flagged ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {fmtKwd(f.valueKwd)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
