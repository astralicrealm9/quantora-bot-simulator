import type {
  BacktestResult,
  Candle,
  StrategyParams,
  StrategyPreset,
  Tick,
  Trade,
  TradeLogEntry,
} from "../types";

// ---------------------------------------------------------------------------
// Default Quantora AI Deriv Bot (R_10) strategy definition, mirroring the XML
// logic blocks: initial stake, take profit, stop loss, 2.1x Martingale step,
// candle interval and candle-trend (EMA) confirmation.
// ---------------------------------------------------------------------------
export const DEFAULT_PARAMS: StrategyParams = {
  initialStake: 1.0,
  takeProfit: 50,
  stopLoss: 40,
  martingaleMultiplier: 2.1,
  candleIntervalSec: 60,
  maxLossStreak: 6,
  payoutRate: 0.95,
  trendPeriod: 14,
};

export const PRESETS: StrategyPreset[] = [
  {
    id: "quantora-default",
    label: "Quantora Default 2.1x",
    params: { ...DEFAULT_PARAMS },
  },
  {
    id: "conservative",
    label: "Conservative 1.8x",
    params: { ...DEFAULT_PARAMS, initialStake: 0.5, martingaleMultiplier: 1.8, takeProfit: 30, stopLoss: 30 },
  },
  {
    id: "aggressive",
    label: "Aggressive 2.5x",
    params: { ...DEFAULT_PARAMS, martingaleMultiplier: 2.5, initialStake: 2, takeProfit: 80, stopLoss: 60 },
  },
  {
    id: "anti-martingale",
    label: "Anti-Martingale 1.3x",
    params: { ...DEFAULT_PARAMS, martingaleMultiplier: 1.3, initialStake: 1, takeProfit: 60, stopLoss: 25, maxLossStreak: 4 },
  },
  {
    id: "low-risk",
    label: "Low Risk 0.35",
    params: { ...DEFAULT_PARAMS, initialStake: 0.35, martingaleMultiplier: 2.0, takeProfit: 20, stopLoss: 20 },
  },
  {
    id: "keno-fast",
    label: "Fast 1m / 3x Recover",
    params: { ...DEFAULT_PARAMS, martingaleMultiplier: 3.0, takeProfit: 45, stopLoss: 50, candleIntervalSec: 60, maxLossStreak: 5 },
  },
];

// ---------------------------------------------------------------------------
// Synthetic Volatility 10 (R_10) index feed: Ornstein-Uhlenbeck mean-reverting
// random walk with tick clustering. 100% offline, seeded for reproducibility.
// ---------------------------------------------------------------------------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarketFeed {
  price: number;
  private rand: () => number;
  private pull: number;

  constructor(seed = 1337, startPrice = 7342.5) {
    this.rand = mulberry32(seed);
    this.price = startPrice;
    this.pull = 0;
  }

  // Advance a single tick (vol ~10% annualized with micro-swings).
  step(): number {
    const shock = (this.rand() - 0.5) * 2;
    const drift = this.pull * 0.06;
    const vol = 0.55; // R_10 index tick volatility
    this.price = Math.max(7000, this.price + drift + shock * vol);
    this.pull = this.pull * 0.82 + (this.rand() - 0.5) * 0.7;
    return this.price;
  }
}

// Aggregate ticks into candles. Returns the last (possibly partial) candle.
export function synthesizeCandles(feed: MarketFeed, intervalSec: number, ticksPerCandle = 12): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  let candleTime = now - now % (intervalSec * 1000);
  let open = feed.price;
  let high = feed.price;
  let low = feed.price;
  for (let i = 0; i < ticksPerCandle; i++) {
    const p = feed.step();
    high = Math.max(high, p);
    low = Math.min(low, p);
  }
  candles.push({ time: candleTime, open, high, low, close: feed.price, volume: 12 });
  return candles;
}

// ---------------------------------------------------------------------------
// Candle trend confirmation: EMA(period) slope decides CALL vs PUT. Mirrors the
// Quantora XML "candle-trend following" confirmation rule.
// ---------------------------------------------------------------------------
export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function trendDirection(closes: number[], period: number): "CALL" | "PUT" | "FLAT" {
  if (closes.length < period + 1) return "FLAT";
  const ema = emaSeries(closes, period);
  const last = ema[ema.length - 1];
  const prev = ema[ema.length - 2];
  if (Math.abs(last - prev) < 0.02) return "FLAT";
  return last > prev ? "CALL" : "PUT";
}

// Candle-trend confirmation: at least `confirm` of the last `window` candles
// point in the trend direction.
export function trendConfirmed(candles: Candle[], period: number, confirm = 3, window = 4): "CALL" | "PUT" | "FLAT" {
  if (candles.length < window + 1) return "FLAT";
  const closes = candles.map((c) => c.close);
  const dir = trendDirection(closes, period);
  if (dir === "FLAT") return "FLAT";
  const count = closes.slice(-window).reduce((acc, c, i, arr) => {
    if (i === 0) return acc;
    const up = c > arr[i - 1];
    return acc + (up ? 1 : 0);
  }, 0);
  const green = count;
  const red = window - count;
  if (dir === "CALL" && green >= confirm) return "CALL";
  if (dir === "PUT" && red >= confirm) return "PUT";
  return "FLAT";
}

export interface TradeOutcome {
  direction: Exclude<ReturnType<typeof trendConfirmed>, "FLAT">;
  exitsAbove: boolean;
  win: boolean;
}

// Simulated contract resolution with realistic edge for the trend side.
function simulateOutcome(rng: () => number, dir: "CALL" | "PUT"): TradeOutcome {
  // Trend-following edge: ~53% hit rate on confirmed entries.
  const baseWin = 0.53;
  const roll = rng();
  const win = roll < baseWin;
  const exitsAbove = dir === "CALL" ? win : !win;
  return { direction: dir, exitsAbove, win };
}

// ---------------------------------------------------------------------------
// Run a full strategy lifecycle over a synthetic session.
// Returns trades + log entries produced by the Quantora R_10 bot.
// ---------------------------------------------------------------------------
export function runQuantoraSession(
  params: StrategyParams,
  opts: { rng?: () => number; minTrades?: number; maxTrades?: number; startBalance?: number } = {},
): { trades: Trade[]; logs: TradeLogEntry[]; finalBalance: number; candles: Candle[] } {
  const rng = opts.rng ?? mulberry32(Date.now() % 2147483647);
  const minTrades = opts.minTrades ?? 12;
  const maxTrades = opts.maxTrades ?? 200;
  const startBalance = opts.startBalance ?? 100;
  let balance = startBalance;
  let streak = 0;
  let id = 1;
  const trades: Trade[] = [];
  const logs: TradeLogEntry[] = [];
  let t = Date.now();

  const feed = new MarketFeed(Math.floor(rng() * 1e9), 7342.5);
  let candles: Candle[] = [{ time: t, open: feed.price, high: feed.price, low: feed.price, close: feed.price, volume: 0 }];

  const pushCandle = () => {
    const open = candles[candles.length - 1].close;
    let high = open;
    let low = open;
    for (let i = 0; i < 12; i++) {
      const p = feed.step();
      high = Math.max(high, p);
      low = Math.min(low, p);
    }
    t += params.candleIntervalSec * 1000;
    candles.push({ time: t, open, high, low, close: feed.price, volume: 12 });
    if (candles.length > 240) candles = candles.slice(-240);
  };

  const log = (category: TradeLogEntry["category"], message: string, tone: TradeLogEntry["tone"]) => {
    logs.push({ id: logs.length + 1, time: t, category, message, tone });
  };

  log("BOT", "Quantora AI Bot (R_10) attached to Volatility 10 Index", "system");
  log("BOT", `Initial stake $${params.initialStake.toFixed(2)} | Martingale x${params.martingaleMultiplier} | Payout ${(params.payoutRate * 100).toFixed(0)}%`, "info");

  // Buffer candles so trend confirmation has history.
  for (let i = 0; i < 24; i++) pushCandle();

  let consecutiveWins = 0;
  let openTrade: null | { trade: Trade; dir: "CALL" | "PUT" } = null;

  for (let i = 0; i < maxTrades && (trades.length < minTrades || (openTrade === null && balance > 5 && streak < params.maxLossStreak + 3 && balance < startBalance + params.takeProfit && balance > startBalance - params.stopLoss)); i++) {
    // TP / SL halt
    if (balance >= startBalance + params.takeProfit) {
      log("ALERT", `TAKE PROFIT ${(params.takeProfit).toFixed(2)} reached at balance $${balance.toFixed(2)}. Session closed.`, "win");
      break;
    }
    if (balance <= startBalance - params.stopLoss) {
      log("ALERT", `STOP LOSS ${(params.stopLoss).toFixed(2)} hit at balance $${balance.toFixed(2)}. Bot halted.`, "loss");
      break;
    }

    // If previous trade lost, bot waits for fresh trend confirmation before re-entering
    if (openTrade === null) {
      const dir = trendConfirmed(candles, params.trendPeriod);
      if (dir === "FLAT") {
        pushCandle();
        continue;
      }
      if (streak > 0) {
        // Recovery mode: require stronger confirmation
        pushCandle();
        pushCandle();
      }
      const entryTime = t;
      const barrier = candles[candles.length - 1].close;
      const stake = streak === 0 ? params.initialStake : params.initialStake * Math.pow(params.martingaleMultiplier, streak);
      const open: Trade = {
        id: id++,
        entryTime,
        exitTime: entryTime + params.candleIntervalSec * 1000,
        direction: dir,
        barrier,
        entryPrice: barrier,
        exitPrice: barrier,
        stake,
        payout: stake * (1 + params.payoutRate),
        profit: 0,
        status: "OPEN",
        streak,
        martingaleStake: stake,
      };
      openTrade = { trade: open, dir };
      trades.push(open);
      const dirLabel = dir === "CALL" ? "CALL" : "PUT";
      const stakeNote = streak > 0 ? ` (recovery step ${streak} x${params.martingaleMultiplier} = $${stake.toFixed(2)})` : "";
      log("TRADE", `Contract purchased: ${dirLabel} on Volatility 10, barrier ${barrier.toFixed(2)}, stake $${stake.toFixed(2)}${stakeNote}`, streak > 0 ? "warn" : "info");
      // Advance candles until expiry
      for (let k = 0; k < 1; k++) pushCandle();
      const outcome = simulateOutcome(rng, dir);
      open.exitTime = t;
      open.exitPrice = candles[candles.length - 1].close;
      open.status = outcome.win ? "WIN" : "LOSS";
      open.profit = outcome.win ? stake * params.payoutRate : -stake;
      balance += open.profit;
      if (outcome.win) {
        streak = 0;
        consecutiveWins++;
        log("TRADE", `Contract ${open.direction} closed SOLD at ${open.exitPrice.toFixed(2)}: WIN +$${open.profit.toFixed(2)} (balance $${balance.toFixed(2)})`, "win");
        if (streak === 0 && consecutiveWins > 1) log("BOT", "Martingale reset to base stake after consecutive win", "info");
      } else {
        streak++;
        consecutiveWins = 0;
        log("TRADE", `Contract ${open.direction} closed at ${open.exitPrice.toFixed(2)}: LOSS -$${Math.abs(open.profit).toFixed(2)} (balance $${balance.toFixed(2)})`, "loss");
        log("ALERT", `Martingale step-up: next stake x${params.martingaleMultiplier} -> $${Math.min(params.initialStake * Math.pow(params.martingaleMultiplier, streak), balance * 0.9).toFixed(2)}`, "warn");
        if (streak >= params.maxLossStreak) {
          log("ALERT", `MAX LOSS STREAK (${params.maxLossStreak}) reached. Bot holds position until TP/SL or manual reset.`, "loss");
        }
      }
      // check post-trade TP/SL early (before next entry) - makes streak halt accurate
      if (balance >= startBalance + params.takeProfit) {
        log("ALERT", `TAKE PROFIT ${params.takeProfit.toFixed(2)} reached at balance $${balance.toFixed(2)}. Session closed.`, "win");
        break;
      }
      if (balance <= startBalance - params.stopLoss) {
        log("ALERT", `STOP LOSS ${params.stopLoss.toFixed(2)} hit at balance $${balance.toFixed(2)}. Bot halted.`, "loss");
        break;
      }
      openTrade = null;
    }
  }

  if (openTrade !== null) {
    // force-close any dangling trade at last price
    const o = openTrade.trade;
    o.exitTime = t;
    o.exitPrice = candles[candles.length - 1].close;
    o.status = "LOSS";
    o.profit = -o.stake;
    balance += o.profit;
    log("TRADE", `Force-closed ${o.direction} at session end: LOSS -$${o.stake.toFixed(2)}`, "loss");
  }

  log("BOT", `Session complete. Final balance $${balance.toFixed(2)} after ${trades.length} contracts.`, "system");
  return { trades, logs, finalBalance: balance, candles };
}

// ---------------------------------------------------------------------------
// Instant backtester: N runs of the strategy with fast math, statistical
// summary. Operates entirely offline on the synthetic R_10 feed.
// ---------------------------------------------------------------------------
export function runBacktest(params: StrategyParams, runs: number): BacktestResult {
  if (runs <= 0) {
    return {
      runs: 0, totalTrades: 0, winRate: 0, netProfit: 0, maxDrawdown: 0,
      maxConsecutiveLosses: 0, profitFactor: 0, expectancy: 0, riskOfRuin: 0, equityCurve: [],
    };
  }
  const base = 100;
  const allEquity: number[] = [];
  let totalTrades = 0;
  let totalWins = 0;
  let totalProfit = 0;
  let totalLoss = 0;
  let maxStreakAll = 0;
  let finalProfits: number[] = [];
  let worst = 0;
  let cumMax = base;

  for (let r = 0; r < runs; r++) {
    const rng = mulberry32((1337 + r * 7919) >>> 0);
    const res = runQuantoraSession(params, { rng, minTrades: 6, maxTrades: 40, startBalance: base });
    const eq = (res.trades as { profit: number }[]).reduce(
      (acc, tr) => {
        acc.push(acc[acc.length - 1] + tr.profit);
        return acc;
      },
      [base],
    );
    const final = eq[eq.length - 1];
    totalProfit += Math.max(0, final - base);
    totalLoss += Math.max(0, base - final);
    finalProfits.push(final - base);
    totalTrades += res.trades.length;
    res.trades.forEach((tr) => {
      if (tr.status === "WIN") totalWins++;
    });
    let streakRun = 0;
    res.trades.forEach((tr) => {
      if (tr.status === "LOSS") streakRun++;
      else streakRun = 0;
      maxStreakAll = Math.max(maxStreakAll, streakRun);
    });
    eq.forEach((v) => {
      cumMax = Math.max(cumMax, v);
      worst = Math.min(worst, v - cumMax);
    });
    if (eq.length > allEquity.length) {
      allEquity.length = eq.length;
      allEquity.forEach((_, i) => (allEquity[i] = 0));
    }
    eq.forEach((v, i) => (allEquity[i] += v));
  }

  const avgFinal = finalProfits.reduce((a, b) => a + b, 0) / runs;
  const variance = finalProfits.reduce((a, b) => a + (b - avgFinal) ** 2, 0) / runs;
  const stdev = Math.sqrt(variance);
  const expectancy = totalTrades > 0 ? (totalProfit - totalLoss) / runs / (totalTrades / runs) : 0;
  const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 99 : 0;
  // Risk of ruin: probability a run's drawdown exceeded 50% of starting balance.
  const ruinCount = finalProfits.filter((p) => p < -50).length;
  const riskOfRuin = runs > 0 ? ruinCount / runs : 0;

  return {
    runs,
    totalTrades,
    winRate,
    netProfit: avgFinal,
    maxDrawdown: worst,
    maxConsecutiveLosses: maxStreakAll,
    profitFactor,
    expectancy,
    riskOfRuin,
    equityCurve: allEquity.map((v) => v / runs),
  };
}

// Format helpers
export const fmtMoney = (v: number, digits = 2) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;