import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Braces,
  FastForward,
  FileCode2,
  Play,
  Pause,
  RotateCcw,
  ShieldAlert,
  Target,
  X,
  Activity,
  Award,
  History,
  Clock,
} from "lucide-react";
import type { BacktestResult, Candle, StrategyParams, Tick, Trade, TradeLogEntry } from "./types";
import {
  DEFAULT_PARAMS,
  PRESETS,
  MarketFeed,
  runBacktest,
  runQuantoraSession,
  fmtMoney,
  fmtPct,
} from "./utils/quantoraEngine";
import BotConfigPanel from "./components/BotConfigPanel";
import MarketChart from "./components/MarketChart";
import EquityAndAnalytics from "./components/EquityAndAnalytics";
import ExecutionConsole from "./components/ExecutionConsole";

const SPEEDS = [1, 5, 20, 100];
const START_BALANCE = 100;

const XML_BLOCK = `<?xml version="1.0" encoding="UTF-8"?>
<quantora_bot name="AI Deriv Bot R_10" market="Volatility 10 Index">
  <input_parameters>
    <stake initial="1.00" martingale_multiplier="2.1" />
    <take_profit value="50" />
    <stop_loss value="40" />
    <candle_interval sec="60" />
    <payout percent="95" />
    <max_loss_streak value="6" />
  </input_parameters>
  <strategy mode="candle_trend" ema_period="14" confirm_bars="3">
    <rule name="entry">
      <!-- Buy CALL when EMA slope up + 3/4 green candles -->
      <if candle_trend="up" confirm_bars="3" then="buy CALL" />
      <if candle_trend="down" confirm_bars="3" then="buy PUT" />
    </rule>
    <rule name="martingale">
      <on loss="true"> stake = initial * multiplier^streak </on>
      <on win="true"> stake = initial; streak = 0 </on>
    </rule>
    <rule name="session_guard">
      <if balance &gt;= start + take_profit then="close session (TP)" />
      <if balance &lt;= start - stop_loss then="close session (SL)" />
      <if streak &gt;= max_loss_streak then="halt trading" />
    </rule>
  </strategy>
</quantora_bot>`;

export default function App() {
  const [params, setParams] = useState<StrategyParams>({ ...DEFAULT_PARAMS });
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [soundOn, setSoundOn] = useState(false);
  const [showXml, setShowXml] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<TradeLogEntry[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [balance, setBalance] = useState(START_BALANCE);
  const [lastTrade, setLastTrade] = useState<Trade | undefined>(undefined);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [runsInput, setRunsInput] = useState(1000);

  const feedRef = useRef(new MarketFeed(Date.now() % 999999, 7342.5));
  const candleRef = useRef<Candle[]>([]);
  const tickRef = useRef<Tick[]>([]);
  const tradesRef = useRef<Trade[]>([]);
  const logsRef = useRef<TradeLogEntry[]>([]);
  const balanceRef = useRef(START_BALANCE);
  const streakRef = useRef(0);
  const nextTradeId = useRef(1);
  const seedRef = useRef(42);
  const pendingToast = useRef<Trade | null>(null);

  const resetSim = useCallback((p: StrategyParams = params) => {
    seedRef.current += 1;
    feedRef.current = new MarketFeed(seedRef.current * 7919, 7342.5);
    candleRef.current = [];
    tickRef.current = [];
    tradesRef.current = [];
    logsRef.current = [];
    balanceRef.current = START_BALANCE;
    streakRef.current = 0;
    nextTradeId.current = 1;
    pendingToast.current = null;
    // Bootstrap candle history
    const now = Date.now();
    const base: Candle[] = [];
    let price = 7342.5;
    for (let i = 0; i < 40; i++) {
      const time = now - (40 - i) * p.candleIntervalSec * 1000;
      const open = price;
      let high = open;
      let low = open;
      for (let k = 0; k < 12; k++) {
        price = feedRef.current.step();
        high = Math.max(high, price);
        low = Math.min(low, price);
      }
      base.push({ time, open, high, low, close: price, volume: 12 });
    }
    candleRef.current = base;
    logsRef.current = [
      {
        id: logsRef.current.length + 1,
        time: Date.now(),
        category: "BOT",
        message: `Quantora AI Bot (R_10) reset. Strategy: ${p.martingaleMultiplier.toFixed(1)}x Martingale, stake $${p.initialStake.toFixed(2)}.`,
        tone: "system",
      },
      {
        id: logsRef.current.length + 2,
        time: Date.now(),
        category: "ALERT",
        message: `TP $${p.takeProfit} | SL $${p.stopLoss} armed. Balance $${START_BALANCE.toFixed(2)}.`,
        tone: "info",
      },
    ];
    setTrades([]);
    setLogs(logsRef.current);
    setCandles(base);
    setTicks([]);
    setBalance(START_BALANCE);
    setLastTrade(undefined);
    pendingToast.current = null;
  }, [params]);

  // Initial bootstrap
  useEffect(() => {
    resetSim(DEFAULT_PARAMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitLog = (category: TradeLogEntry["category"], message: string, tone: TradeLogEntry["tone"]) => {
    const entry: TradeLogEntry = {
      id: logsRef.current.length + 1,
      time: Date.now(),
      category,
      message,
      tone,
    };
    logsRef.current = [...logsRef.current.slice(-400), entry];
    setLogs(logsRef.current);
  };

  const evaluateMarket = useCallback(
    (p: StrategyParams) => {
      const feed = feedRef.current;
      const now = Date.now();
      // Advance a new candle
      const last = candleRef.current[candleRef.current.length - 1];
      const open = last ? last.close : feed.price;
      let high = open;
      let low = open;
      const newTicks: Tick[] = [];
      for (let k = 0; k < 12; k++) {
        const price = feed.step();
        high = Math.max(high, price);
        low = Math.min(low, price);
        newTicks.push({ time: now - (12 - k), price });
      }
      const candle: Candle = {
        time: last ? last.time + p.candleIntervalSec * 1000 : now,
        open,
        high,
        low,
        close: feed.price,
        volume: 12,
      };
      candleRef.current = [...candleRef.current.slice(-199), candle];
      tickRef.current = [...tickRef.current.slice(-500), ...newTicks];
      setCandles(candleRef.current);
      setTicks(tickRef.current);

      // Trend confirmation over last candles
      const closes = candleRef.current.map((c) => c.close);
      const period = p.trendPeriod;
      if (closes.length < period + 1) return;
      const ema = closes.slice(0).reduce<number[]>((acc, v, i) => {
        const k = 2 / (period + 1);
        acc.push(i === 0 ? v : v * k + acc[i - 1] * (1 - k));
        return acc;
      }, []);
      const dir =
        ema[ema.length - 1] - ema[ema.length - 2] > 0.02
          ? "CALL"
          : ema[ema.length - 2] - ema[ema.length - 1] > 0.02
            ? "PUT"
            : null;

      // TP/SL guard
      if (balanceRef.current >= START_BALANCE + p.takeProfit) {
        emitLog("ALERT", `TAKE PROFIT $${p.takeProfit} reached: balance $${balanceRef.current.toFixed(2)}. Bot paused.`, "win");
        setRunning(false);
        return;
      }
      if (balanceRef.current <= START_BALANCE - p.stopLoss) {
        emitLog("ALERT", `STOP LOSS $${p.stopLoss} hit: balance $${balanceRef.current.toFixed(2)}. Bot halted.`, "loss");
        setRunning(false);
        return;
      }
      if (streakRef.current >= p.maxLossStreak) {
        emitLog("ALERT", `Max loss streak (${p.maxLossStreak}) reached. Bot waits for manual reset or TP/SL.`, "loss");
        setRunning(false);
        return;
      }

      if (dir === null) return;

      const stake =
        streakRef.current === 0
          ? p.initialStake
          : p.initialStake * Math.pow(p.martingaleMultiplier, streakRef.current);

      const trade: Trade = {
        id: nextTradeId.current++,
        entryTime: now,
        exitTime: now + p.candleIntervalSec * 1000,
        direction: dir,
        barrier: feed.price,
        entryPrice: feed.price,
        exitPrice: feed.price,
        stake,
        payout: stake * (1 + p.payoutRate),
        profit: 0,
        status: "OPEN",
        streak: streakRef.current,
        martingaleStake: stake,
      };
      tradesRef.current = [...tradesRef.current, trade];
      setTrades(tradesRef.current);

      // Resolve outcome with trend edge (~53%)
      const rng = Math.random();
      const win = rng < 0.53;
      trade.status = win ? "WIN" : "LOSS";
      trade.exitPrice = feed.price * (1 + (Math.random() - 0.5) * 0.002);
      trade.profit = win ? stake * p.payoutRate : -stake;
      balanceRef.current += trade.profit;
      setBalance(balanceRef.current);
      setLastTrade(trade);
      pendingToast.current = trade;

      const dirLabel = dir === "CALL" ? "CALL" : "PUT";
      const stakeNote = streakRef.current > 0 ? ` (recovery step ${streakRef.current} x${p.martingaleMultiplier} = $${stake.toFixed(2)})` : "";
      emitLog("TRADE", `Buy ${dirLabel} V10 @ ${trade.entryPrice.toFixed(2)} | stake $${stake.toFixed(2)}${stakeNote}`, streakRef.current > 0 ? "warn" : "info");
      if (win) {
        streakRef.current = 0;
        emitLog("TRADE", `Contract ${dirLabel} closed WIN +$${trade.profit.toFixed(2)} (balance $${balanceRef.current.toFixed(2)})`, "win");
      } else {
        streakRef.current += 1;
        emitLog("TRADE", `Contract ${dirLabel} closed LOSS -$${Math.abs(trade.profit).toFixed(2)} (balance $${balanceRef.current.toFixed(2)})`, "loss");
        emitLog("ALERT", `Martingale step-up: next stake x${p.martingaleMultiplier} -> $${(p.initialStake * Math.pow(p.martingaleMultiplier, streakRef.current)).toFixed(2)}`, "warn");
      }
      void soundOn;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soundOn],
  );

  // Simulation loop
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => evaluateMarket(params), 700 / speed);
    return () => window.clearInterval(interval);
  }, [running, speed, params, evaluateMarket]);

  // Toast popup for latest trade
  useEffect(() => {
    if (pendingToast.current) {
      const t = pendingToast.current;
      pendingToast.current = null;
      const timer = window.setTimeout(() => setLastTrade((cur) => (cur && cur.id === t.id ? undefined : cur)), 2600);
      return () => window.clearTimeout(timer);
    }
  }, [trades.length]);

  useEffect(() => {
    if (lastTrade && soundOn) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = lastTrade.status === "WIN" ? 880 : 220;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } catch {
        /* audio unavailable */
      }
    }
  }, [lastTrade, soundOn]);

  const startBacktest = useCallback(
    (runs: number) => {
      setBacktestRunning(true);
      // Run synchronously (fast math) but keep UI responsive via setTimeout
      window.setTimeout(() => {
        const result = runBacktest(params, runs);
        setBacktest(result);
        setBacktestRunning(false);
        setBacktestOpen(true);
      }, 30);
    },
    [params],
  );

  const activePreset = useMemo(
    () =>
      PRESETS.find(
        (p) =>
          p.params.initialStake === params.initialStake &&
          p.params.martingaleMultiplier === params.martingaleMultiplier &&
          p.params.takeProfit === params.takeProfit &&
          p.params.stopLoss === params.stopLoss,
      ) ?? PRESETS[0],
    [params],
  );

  const currentPrice = candles.length ? candles[candles.length - 1].close : 0;
  const net = balance - START_BALANCE;

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/10">
              <Bot className="h-4.5 w-4.5 text-cyan-400" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-none tracking-tight">
                Quantora <span className="text-cyan-400">R_10</span>
              </h1>
              <p className="font-mono text-[9px] text-zinc-500">AI Deriv Bot Strategy Simulator / Backtester</p>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 lg:flex">
            {PRESETS.slice(0, 4).map((p) => {
              const active = activePreset.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    const next = { ...params, ...p.params };
                    setParams(next);
                    resetSim(next);
                  }}
                  className={`rounded border px-2 py-1 text-[10px] font-semibold transition active:scale-[0.97] ${
                    active
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Run controls */}
            <button
              onClick={() => setRunning((r) => !r)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold transition active:scale-[0.98] ${
                running
                  ? "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                  : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              }`}
            >
              {running ? <Pause className="h-3.5 w-3.5" strokeWidth={2} /> : <Play className="h-3.5 w-3.5" strokeWidth={2} />}
              {running ? "Pause" : "Run Bot"}
            </button>
            <button
              onClick={() => resetSim()}
              title="Reset simulation"
              className="rounded-md border border-zinc-700 bg-zinc-800/70 p-1.5 text-zinc-400 transition hover:text-zinc-200 active:scale-[0.95]"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* Speed selector */}
            <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-900/70">
              <span className="hidden px-1.5 text-[9px] font-semibold uppercase text-zinc-500 sm:block">Speed</span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`flex items-center gap-0.5 px-2 py-1.5 font-mono text-[11px] font-bold transition ${
                    speed === s
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s === 100 && <FastForward className="h-3 w-3" strokeWidth={2} />}
                  {s}x
                </button>
              ))}
            </div>

            {/* Instant backtest */}
            <button
              onClick={() => startBacktest(runsInput)}
              className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-bold text-cyan-300 transition hover:bg-cyan-500/20 active:scale-[0.98]"
            >
              <ZapIcon />
              Instant Backtest
            </button>

            <button
              onClick={() => setShowXml(true)}
              className="hidden items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:border-zinc-600 active:scale-[0.98] sm:flex"
            >
              <FileCode2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              XML
            </button>
          </div>
        </div>
      </header>

      {/* Balance strip */}
      <div className="mx-auto max-w-[1800px] px-4 pt-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusCell label="Session Balance" value={fmtMoney(balance)} tone={net >= 0 ? "up" : "down"} icon={<Activity className="h-3.5 w-3.5" strokeWidth={1.5} />} />
          <StatusCell label="Net P&L" value={fmtMoney(net)} tone={net >= 0 ? "up" : "down"} icon={<Award className="h-3.5 w-3.5" strokeWidth={1.5} />} />
          <StatusCell label="Contracts" value={`${trades.length}`} tone="neutral" icon={<History className="h-3.5 w-3.5" strokeWidth={1.5} />} />
          <StatusCell label="Active Preset" value={activePreset.label} tone="neutral" icon={<Target className="h-3.5 w-3.5" strokeWidth={1.5} />} />
        </div>
      </div>

      {/* Main cockpit */}
      <main className="mx-auto max-w-[1800px] grid grid-cols-1 gap-2 px-4 py-3 lg:grid-cols-12">
        {/* Left: config */}
        <section className="lg:col-span-3">
          <BotConfigPanel params={params} onChange={setParams} onReset={() => { setParams({ ...DEFAULT_PARAMS }); resetSim({ ...DEFAULT_PARAMS }); }} />
        </section>

        {/* Center: chart */}
        <section className="lg:col-span-6">
          <MarketChart candles={candles} ticks={ticks} trades={trades} currentPrice={currentPrice} intervalSec={params.candleIntervalSec} />
        </section>

        {/* Right: analytics */}
        <section className="lg:col-span-3">
          <EquityAndAnalytics trades={trades} balance={balance} startBalance={START_BALANCE} paramsTakeProfit={params.takeProfit} paramsStopLoss={params.stopLoss} />
        </section>

        {/* Bottom: log */}
        <section className="lg:col-span-12">
          <ExecutionConsole logs={logs} soundOn={soundOn} onToggleSound={() => setSoundOn((s) => !s)} />
        </section>
      </main>

      {/* footer */}
      <footer className="mx-auto max-w-[1800px] px-4 pb-6 font-mono text-[10px] text-zinc-600">
        Quantora AI Deriv Bot (R_10) - offline strategy simulator. Volatility 10 synthetic feed, 2.1x Martingale recovery, candle-trend EMA 14 confirmation. Not financial advice.
      </footer>

      {/* Trade toast */}
      <AnimatePresence>
        {lastTrade && (
          <motion.div
            key={lastTrade.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 shadow-lg ${
              lastTrade.status === "WIN"
                ? "border-emerald-500/50 bg-emerald-950/95 text-emerald-300"
                : "border-red-500/50 bg-red-950/95 text-red-300"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            <span className="font-mono text-xs font-bold">
              {lastTrade.direction} {lastTrade.status} {fmtMoney(lastTrade.profit)}
            </span>
            <span className="font-mono text-[10px] opacity-70">stake {fmtMoney(lastTrade.stake)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* XML viewer dialog */}
      <AnimatePresence>
        {showXml && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setShowXml(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Braces className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
                  <h2 className="text-sm font-bold">Quantora R_10 Strategy XML</h2>
                </div>
                <button
                  onClick={() => setShowXml(false)}
                  className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto bg-black/60 p-4">
                <pre className="font-mono text-[11px] leading-relaxed text-zinc-300">
                  {XML_BLOCK.split(String.fromCharCode(10)).map((line, i) => (
                    <div key={i} className="flex">
                      <span className="mr-3 inline-block w-8 select-none text-right text-zinc-700">{i + 1}</span>
                      <span className={line.includes("<!--") ? "text-zinc-600" : line.includes("<strategy") ? "text-amber-300" : line.includes("martingale") ? "text-cyan-300" : ""}>{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
              <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.5} />
                <p className="text-[10px] text-zinc-500">This XML mirrors the extracted logic of the Quantora AI Deriv Bot (R_10).</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backtest dialog */}
      <AnimatePresence>
        {backtestOpen && backtest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setBacktestOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
                  <h2 className="text-sm font-bold">Instant Backtest Report</h2>
                </div>
                <button
                  onClick={() => setBacktestOpen(false)}
                  className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <div className="max-h-[62vh] overflow-auto p-4">
                {/* Run controls */}
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    value={runsInput}
                    min={100}
                    max={10000}
                    step={100}
                    onChange={(e) => setRunsInput(Math.max(10, parseInt(e.target.value) || 100))}
                    className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-cyan-300 outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={() => startBacktest(runsInput)}
                    disabled={backtestRunning}
                    className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50"
                  >
                    {backtestRunning ? "Running..." : "Re-run"}
                  </button>
                  <span className="font-mono text-[10px] text-zinc-500">100 - 10,000 Monte Carlo sessions</span>
                </div>

                {backtestRunning ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
                      <span className="font-mono text-xs">Running {runsInput.toLocaleString()} simulations...</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <BacktestCell label="Runs" value={backtest.runs.toLocaleString()} sub="sessions" />
                    <BacktestCell label="Total Contracts" value={backtest.totalTrades.toLocaleString()} sub={`${(backtest.totalTrades / Math.max(1, backtest.runs)).toFixed(1)} / run`} />
                    <BacktestCell label="Win Rate" value={fmtPct(backtest.winRate)} sub="trend edge" tone={backtest.winRate >= 0.5 ? "up" : "down"} />
                    <BacktestCell label="Net Return" value={fmtMoney(backtest.netProfit)} sub="avg / run" tone={backtest.netProfit >= 0 ? "up" : "down"} />
                    <BacktestCell label="Max Drawdown" value={fmtMoney(backtest.maxDrawdown)} sub="avg peak-trough" tone="down" />
                    <BacktestCell label="Max Loss Streak" value={`${backtest.maxConsecutiveLosses}`} sub="martingale depth" tone={backtest.maxConsecutiveLosses >= 4 ? "warn" : "neutral"} />
                    <BacktestCell label="Profit Factor" value={backtest.profitFactor >= 99 ? "∞" : backtest.profitFactor.toFixed(2)} sub="gross ratio" tone={backtest.profitFactor >= 1 ? "up" : "down"} />
                    <BacktestCell label="Risk of Ruin" value={fmtPct(backtest.riskOfRuin)} sub="-50% blowup" tone={backtest.riskOfRuin > 0.02 ? "warn" : "neutral"} />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusCell({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
  icon: React.ReactNode;
}) {
  const color =
    tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <span className="text-zinc-500">{icon}</span>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className={`font-mono text-sm font-bold tabular-nums ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function BacktestCell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "warn" | "neutral";
}) {
  const color =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-red-400"
        : tone === "warn"
          ? "text-amber-400"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[9px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function ZapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}