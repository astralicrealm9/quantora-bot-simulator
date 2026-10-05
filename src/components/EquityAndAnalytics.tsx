import { useMemo } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, TrendingUp, TrendingDown, ShieldAlert, Flame, Wallet, Percent } from "lucide-react";
import type { Trade } from "../types";
import { fmtMoney, fmtPct } from "../utils/quantoraEngine";

interface Props {
  trades: Trade[];
  balance: number;
  startBalance: number;
  paramsTakeProfit: number;
  paramsStopLoss: number;
}

interface KpiCard {
  label: string;
  value: string;
  sub: string;
  tone: "up" | "down" | "warn" | "neutral";
  icon: React.ReactNode;
}

function computeMetrics(trades: Trade[], startBalance: number) {
  const wins = trades.filter((t) => t.status === "WIN").length;
  const losses = trades.filter((t) => t.status === "LOSS").length;
  const grossWin = trades.filter((t) => t.profit > 0).reduce((a, t) => a + t.profit, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.profit < 0).reduce((a, t) => a + t.profit, 0));
  let eq = startBalance;
  let peak = startBalance;
  let maxDD = 0;
  let maxStreak = 0;
  let streak = 0;
  const curve = [{ eq: startBalance }];
  trades.forEach((t) => {
    eq += t.profit;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq - peak);
    if (t.status === "LOSS") streak++;
    else streak = 0;
    maxStreak = Math.max(maxStreak, streak);
    curve.push({ eq: Math.round(eq * 100) / 100 });
  });
  return {
    wins,
    losses,
    grossWin,
    grossLoss,
    maxDD,
    maxStreak,
    curve,
    net: eq - startBalance,
    winRate: trades.length ? wins / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
  };
}

export default function EquityAndAnalytics({ trades, balance, startBalance, paramsTakeProfit, paramsStopLoss }: Props) {
  const m = useMemo(() => computeMetrics(trades, startBalance), [trades, startBalance]);
  const net = balance - startBalance;

  const kpis: KpiCard[] = [
    {
      label: "Net P&L",
      value: fmtMoney(net),
      sub: `${trades.length} contracts`,
      tone: net >= 0 ? "up" : "down",
      icon: <Wallet className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      label: "Win Rate",
      value: fmtPct(m.winRate),
      sub: `${m.wins}W / ${m.losses}L`,
      tone: m.winRate >= 0.5 ? "up" : "down",
      icon: <Percent className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      label: "Profit Factor",
      value: m.profitFactor >= 99 ? "∞" : m.profitFactor.toFixed(2),
      sub: "gross win / gross loss",
      tone: m.profitFactor >= 1 ? "up" : "down",
      icon: <Activity className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      label: "Max Drawdown",
      value: fmtMoney(m.maxDD),
      sub: "peak to trough",
      tone: "down",
      icon: <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      label: "Max Loss Streak",
      value: `${m.maxStreak}`,
      sub: "martingale depth",
      tone: m.maxStreak >= 4 ? "warn" : "neutral",
      icon: <Flame className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
    {
      label: "Session Guard",
      value: `${fmtMoney(paramsTakeProfit)} / ${fmtMoney(paramsStopLoss)}`,
      sub: "TP / SL",
      tone: "neutral",
      icon: <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.5} />,
    },
  ];

  const toneStyles = {
    up: "border-emerald-500/30 text-emerald-400",
    down: "border-red-500/30 text-red-400",
    warn: "border-amber-500/30 text-amber-400",
    neutral: "border-zinc-700/60 text-zinc-300",
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.5} />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">Equity & Analytics</h2>
        </div>
        <span className="font-mono text-[10px] text-zinc-500">
          Bal <span className={net >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtMoney(balance)}</span>
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-1.5 px-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <motion.div
            key={k.label}
            whileHover={{ y: -1 }}
            className={`rounded-md border bg-zinc-900/50 px-2 py-1.5 ${toneStyles[k.tone]}`}
          >
            <div className="flex items-center gap-1 text-zinc-500">
              {k.icon}
              <span className="text-[9px] font-medium uppercase tracking-wider">{k.label}</span>
            </div>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">{k.value}</p>
            <p className="text-[9px] text-zinc-500">{k.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Equity curve */}
      <div className="min-h-[130px] flex-1 px-1.5 pb-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={m.curve} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="eq" hide />
            <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
            <Tooltip
              contentStyle={{
                background: "#09090b",
                border: "1px solid #3f3f46",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "monospace",
                color: "#e4e4e7",
              }}
              formatter={(v) => [fmtMoney(Number(v)), "Equity"]}
            />
            <Area type="monotone" dataKey="eq" stroke="#06b6d4" strokeWidth={1.6} fill="url(#eqGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-800 px-3 py-1.5 font-mono text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-emerald-500" strokeWidth={1.5} /> {m.wins} wins
        </span>
        <span className="flex items-center gap-1">
          <TrendingDown className="h-3 w-3 text-red-500" strokeWidth={1.5} /> {m.losses} losses
        </span>
        <span className="ml-auto">EV/trade {trades.length ? fmtMoney(m.net / trades.length) : "$0.00"}</span>
      </div>
    </div>
  );
}