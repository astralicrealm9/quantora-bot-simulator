import { useMemo } from "react";
import { RotateCcw, Settings, SlidersHorizontal } from "lucide-react";
import type { StrategyParams } from "../types";
import { PRESETS } from "../utils/quantoraEngine";

interface Props {
  params: StrategyParams;
  onChange: (next: StrategyParams) => void;
  onReset: () => void;
}

function Field({
  label,
  value,
  min,
  max,
  step,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</label>
        <span className="font-mono text-[11px] text-cyan-400">
          {prefix}
          {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-500"
      />
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-zinc-600">
        <span>
          {prefix}
          {min.toLocaleString("en-US", { maximumFractionDigits: min < 1 ? 2 : 0 })}
          {suffix}
        </span>
        <span>
          {prefix}
          {max.toLocaleString("en-US")}
          {suffix}
        </span>
      </div>
    </div>
  );
}

export default function BotConfigPanel({ params, onChange, onReset }: Props) {
  const activePreset = useMemo(
    () =>
      PRESETS.find(
        (p) =>
          p.params.initialStake === params.initialStake &&
          p.params.martingaleMultiplier === params.martingaleMultiplier &&
          p.params.takeProfit === params.takeProfit &&
          p.params.stopLoss === params.stopLoss,
      ) ?? null,
    [params],
  );

  const set = (patch: Partial<StrategyParams>) => onChange({ ...params, ...patch });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Settings className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.5} />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">Bot Configuration</h2>
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[10px] font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 active:scale-[0.98]"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
          Reset
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-3">
        {/* Presets */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <SlidersHorizontal className="h-3 w-3 text-zinc-500" strokeWidth={1.5} />
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Strategy Preset</span>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {PRESETS.map((p) => {
              const active = activePreset?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onChange({ ...params, ...p.params })}
                  className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition active:scale-[0.99] ${
                    active
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <span className="text-[12px] font-medium">{p.label}</span>
                  <span className="font-mono text-[10px] text-zinc-500">x{p.params.martingaleMultiplier.toFixed(1)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Core XML parameters */}
        <div className="rounded-md border border-zinc-800/80 bg-zinc-900/40 p-2.5">
          <p className="mb-2.5 font-mono text-[10px] text-zinc-600">
            {"<input_parameters> // Quantora R_10 XML parse"}
          </p>
          <div className="space-y-3.5">
            <Field
              label="Initial Stake"
              prefix="$"
              min={0.35}
              max={1000}
              step={0.05}
              value={params.initialStake}
              onChange={(v) => set({ initialStake: v })}
            />
            <Field
              label="Take Profit"
              prefix="$"
              min={5}
              max={200}
              step={1}
              value={params.takeProfit}
              onChange={(v) => set({ takeProfit: v })}
            />
            <Field
              label="Stop Loss"
              prefix="$"
              min={5}
              max={200}
              step={1}
              value={params.stopLoss}
              onChange={(v) => set({ stopLoss: v })}
            />
            <Field
              label="Martingale Multiplier"
              suffix="x"
              min={1}
              max={3}
              step={0.05}
              value={params.martingaleMultiplier}
              onChange={(v) => set({ martingaleMultiplier: v })}
            />
            <Field
              label="Candle Interval"
              suffix="s"
              min={10}
              max={300}
              step={5}
              value={params.candleIntervalSec}
              onChange={(v) => set({ candleIntervalSec: v })}
            />
            <Field
              label="Max Loss Streak"
              min={2}
              max={10}
              step={1}
              value={params.maxLossStreak}
              onChange={(v) => set({ maxLossStreak: Math.round(v) })}
            />
            <Field
              label="Payout Rate"
              suffix="%"
              min={80}
              max={100}
              step={1}
              value={params.payoutRate * 100}
              onChange={(v) => set({ payoutRate: v / 100 })}
            />
            <Field
              label="EMA Trend Period"
              min={5}
              max={50}
              step={1}
              value={params.trendPeriod}
              onChange={(v) => set({ trendPeriod: Math.round(v) })}
            />
          </div>
        </div>

        {/* XML summary */}
        <div className="rounded-md border border-zinc-800/80 bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-500">
          <p className="text-emerald-500/80">{"<!-- strategy.xml -->"}</p>
          <p>
            <span className="text-zinc-600">{"<stake"}</span>{" "}
            <span className="text-amber-400/90">initial</span>=
            <span className="text-cyan-400/90">"{params.initialStake.toFixed(2)}"</span>
            <span className="text-amber-400/90"> martingale</span>=
            <span className="text-cyan-400/90">"{params.martingaleMultiplier.toFixed(1)}"</span>
            <span className="text-zinc-600">{">"}</span>
          </p>
          <p>
            <span className="text-zinc-600">{"<take_profit"}</span>{" "}
            <span className="text-amber-400/90">value</span>=
            <span className="text-cyan-400/90">"{params.takeProfit}"</span>
            <span className="text-zinc-600">{"/>"}</span>
          </p>
          <p>
            <span className="text-zinc-600">{"<stop_loss"}</span>{" "}
            <span className="text-amber-400/90">value</span>=
            <span className="text-cyan-400/90">"{params.stopLoss}"</span>
            <span className="text-zinc-600">{"/>"}</span>
          </p>
          <p>
            <span className="text-zinc-600">{"<candle_interval"}</span>{" "}
            <span className="text-amber-400/90">sec</span>=
            <span className="text-cyan-400/90">"{params.candleIntervalSec}"</span>
            <span className="text-zinc-600">{"/>"}</span>
          </p>
          <p className="text-zinc-700">{"<strategy mode=" + String.fromCharCode(34) + "candle_trend" + String.fromCharCode(34) + " ema_period=" + String.fromCharCode(34) + "" + `${params.trendPeriod}` + "" + String.fromCharCode(34) + "/>"}</p>
        </div>
      </div>
    </div>
  );
}