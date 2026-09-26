import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Table2 } from 'lucide-react';

/** Paleta categórica validada (ordem fixa; nunca reciclar cores). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#eef0f3', axis: '#cbd5e1' };

/** Arredonda o máximo do eixo para um número "limpo" e gera os ticks. */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export interface Series { key: string; name: string; color?: string }

/** Largura real do contêiner, para o SVG desenhar em pixels 1:1 (texto não escala com o card). */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Colunas agrupadas: marcas finas, ponta arredondada, base reta, tooltip por grupo e visão em tabela. */
export function ColumnChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  format,
  height = 240,
  ariaLabel,
}: {
  data: T[];
  xKey: keyof T;
  series: Series[];
  format: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const colors = series.map((s, i) => s.color ?? SERIES[i]);
  const max = Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] || 1;
  const [box, W] = useWidth<HTMLDivElement>();
  const padL = 64, padR = 8, padT = 12, padB = 28;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, (band * 0.7 - 2 * (series.length - 1)) / series.length);
  const groupW = barW * series.length + 2 * (series.length - 1);
  const y = (v: number) => padT + plotH - (v / top) * plotH;

  const column = (x: number, v: number) => {
    const h = Math.max(0, (v / top) * plotH);
    if (h < 0.5) return '';
    const r = Math.min(4, h, barW / 2);
    const b = padT + plotH;
    return `M${x},${b} V${b - h + r} Q${x},${b - h} ${x + r},${b - h} H${x + barW - r} Q${x + barW},${b - h} ${x + barW},${b - h + r} V${b} Z`;
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.length > 1 && series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="size-2.5 rounded-sm" style={{ background: colors[i] }} />
            {s.name}
          </span>
        ))}
        <button onClick={() => setTable((t) => !t)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          <Table2 className="size-3.5" /> {table ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1.5 pr-4 font-medium" />{series.map((s) => <th key={s.key} className="py-1.5 pr-4 text-right font-medium">{s.name}</th>)}</tr></thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 text-slate-700">{String(d[xKey])}</td>
                  {series.map((s) => <td key={s.key} className="py-1.5 pr-4 text-right text-slate-800 tabular">{format(Number(d[s.key]) || 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block max-w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK.muted} className="tabular">{format(t).replace(',00', '')}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = padL + band * i + (band - groupW) / 2;
              return (
                <g key={i}>
                  {hover === i && <rect x={padL + band * i + 2} y={padT} width={band - 4} height={plotH} fill="#f1f5f9" rx={4} />}
                  {series.map((s, j) => (
                    <path key={s.key} d={column(x0 + j * (barW + 2), Number(d[s.key]) || 0)} fill={colors[j]} />
                  ))}
                  <text x={padL + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize="11" fill={INK.secondary}>{String(d[xKey])}</text>
                  <rect x={padL + band * i} y={padT} width={band} height={plotH + padB} fill="transparent" tabIndex={0} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${String(d[xKey])}: ${series.map((s) => `${s.name} ${format(Number(d[s.key]) || 0)}`).join(', ')}`} />
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `clamp(0px, calc(${((padL + band * hover + band / 2) / W) * 100}% - 80px), calc(100% - 170px))` }}
            >
              <p className="mb-1 font-medium text-slate-500">{String(data[hover][xKey])}</p>
              {series.map((s, j) => (
                <p key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded" style={{ background: colors[j] }} />
                  <span className="font-semibold text-slate-900 tabular">{format(Number(data[hover][s.key]) || 0)}</span>
                  <span className="text-slate-500">{s.name}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Barra de progresso de meta: trilho num tom claro da mesma cor. */
export function Meter({ value, projected, tone = 'brand' }: { value: number; projected?: number | null; tone?: 'brand' | 'good' | 'warning' }) {
  const pct = Math.max(0, Math.min(1, value));
  const proj = projected != null ? Math.max(0, Math.min(1, projected)) : null;
  const fill = tone === 'good' ? '#0ca30c' : tone === 'warning' ? '#eda100' : '#1f7a70';
  const track = tone === 'good' ? '#dcfce7' : tone === 'warning' ? '#fef3c7' : '#d5f2ec';
  return (
    <div className="relative h-2 overflow-hidden rounded-full" style={{ background: track }}>
      {proj !== null && proj > pct && <div className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${proj * 100}%`, background: fill }} />}
      <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct * 100}%`, background: fill }} />
    </div>
  );
}

/** Barras horizontais simples (uma série, cor do slot 1), com valor na ponta. */
export function HBarList({ items, format }: { items: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="shrink-0 font-medium text-slate-900 tabular">{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className={clsx('h-2 rounded-full')} style={{ width: `${(i.value / max) * 100}%`, background: SERIES[0] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
