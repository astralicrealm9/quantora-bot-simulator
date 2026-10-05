import { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Crosshair, Timer } from "lucide-react";
import type { Candle, Tick, Trade } from "../types";
import { emaSeries } from "../utils/quantoraEngine";

interface Props {
  candles: Candle[];
  ticks: Tick[];
  trades: Trade[];
  currentPrice: number;
  intervalSec: number;
}

const W = 660;
const H = 300;
const PAD = { top: 14, right: 16, bottom: 22, left: 52 };

function priceScale(lo: number, hi: number) {
  const span = Math.max(hi - lo, 1e-6);
  return (p: number) => PAD.bottom + ((hi - p) / span) * (H - PAD.top - PAD.bottom);
}

function timeScale(candles: Candle[]) {
  const first = candles[0]?.time ?? 0;
  const last = candles[candles.length - 1]?.time ?? first + 1;
  const span = Math.max(last - first, 1);
  return (t: number) => PAD.left + ((t - first) / span) * (W - PAD.left - PAD.right);
}

export default function MarketChart({ candles, ticks, trades, currentPrice, intervalSec }: Props) {
  const { y, xOf, ema, gridLines, lo, hi } = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const lo = Math.min(...closes, currentPrice) * 0.9995;
    const hi = Math.max(...closes, currentPrice) * 1.0005;
    const y = priceScale(lo, hi);
    const xOf = timeScale(candles);
    const ema = emaSeries(closes, 14);
    const gridLines = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    return { y, xOf, ema, gridLines, lo, hi };
  }, [candles, currentPrice]);

  if (candles.length < 2) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/80">
        <div className="text-center">
          <Crosshair className="mx-auto mb-2 h-6 w-6 animate-pulse text-cyan-500/60" strokeWidth={1.5} />
          <p className="text-xs text-zinc-500">Waiting for market feed...</p>
        </div>
      </div>
    );
  }

  const bw = Math.max(4, (W - PAD.left - PAD.right) / candles.length / 2.6);
  const px = candles.length > 0 ? (W - PAD.left - PAD.right) / candles.length : 10;
  const timeLabels = [0, 1, 2, 3].map((i) => {
    const idx = Math.floor((candles.length - 1) * (i / 3));
    return { idx, x: xOf(candles[idx].time), label: new Date(candles[idx].time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) };
  });

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
            <Timer className="h-3 w-3" strokeWidth={1.5} /> V10
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">
            Volatility 10 Index (R_10)
          </h2>
          <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">| 1m candle | EMA 14</span>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-cyan-300">{currentPrice.toFixed(2)}</span>
      </div>

      <div className="relative flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
          {/* grid */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="#18181b" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end" className="fill-zinc-600 font-mono text-[9px]">
                {g.toFixed(2)}
              </text>
            </g>
          ))}

          {/* EMA trend line */}
          <polyline
            fill="none"
            stroke="#06b6d4"
            strokeWidth={1.4}
            strokeOpacity={0.85}
            points={ema.map((v, i) => `${xOf(candles[i].time)},${y(v)}`).join(" ")}
          />

          {/* candles */}
          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const color = up ? "#10b981" : "#ef4444";
            const cx = xOf(c.time);
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} strokeOpacity={0.7} />
                <rect
                  x={cx - bw / 2}
                  y={y(Math.max(c.open, c.close))}
                  width={bw}
                  height={Math.max(1, Math.abs(y(c.open) - y(c.close)))}
                  fill={color}
                  opacity={0.9}
                />
              </g>
            );
          })}

          {/* trade markers */}
          {trades.map((tr) => {
            const cx = xOf(tr.entryTime);
            if (cx < PAD.left || cx > W - PAD.right) return null;
            const win = tr.status === "WIN";
            const color = win ? "#10b981" : "#ef4444";
            return (
              <g key={tr.id}>
                <line x1={cx} x2={cx} y1={PAD.top} y2={H - PAD.bottom} stroke={color} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.45} />
                <motion.circle
                  initial={{ r: 2, opacity: 0 }}
                  animate={{ r: 5, opacity: 1 }}
                  cx={cx}
                  cy={y(tr.entryPrice)}
                  fill={tr.direction === "CALL" ? "#10b981" : "#ef4444"}
                />
                <text x={cx + 3} y={y(tr.entryPrice) - 4} className="font-mono text-[8px]" fill={win ? "#34d399" : "#f87171"}>
                  {win ? "WIN" : "LOSS"}
                </text>
              </g>
            );
          })}

          {/* time labels */}
          {timeLabels.map((t) => (
            <text key={t.idx} x={t.x} y={H - 6} textAnchor="middle" className="fill-zinc-600 font-mono text-[9px]">
              {t.label}
            </text>
          ))}
        </svg>

        {/* live tick pulse */}
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          <span className="font-mono text-[9px] text-cyan-400">{ticks.length} ticks</span>
        </motion.div>

        {/* header chips */}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
            <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} /> CALL
          </span>
          <span className="flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">
            <TrendingDown className="h-2.5 w-2.5" strokeWidth={2} /> PUT
          </span>
        </div>
      </div>
    </div>
  );
}