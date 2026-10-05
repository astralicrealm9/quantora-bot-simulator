export type MarketDirection = "CALL" | "PUT";

export type TradeStatus = "OPEN" | "WIN" | "LOSS";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  time: number;
  price: number;
}

export interface Trade {
  id: number;
  entryTime: number;
  exitTime: number;
  direction: MarketDirection;
  barrier: number;
  entryPrice: number;
  exitPrice: number;
  stake: number;
  payout: number; // gross payout on win
  profit: number; // net pnl (+ profit / - stake)
  status: TradeStatus;
  streak: number; // consecutive loss streak at entry
  martingaleStake: number; // stake used for this trade
}

export interface TradeLogEntry {
  id: number;
  time: number;
  category: "TRADE" | "BOT" | "ALERT";
  message: string;
  tone: "info" | "win" | "loss" | "warn" | "system";
}

export interface StrategyParams {
  initialStake: number;
  takeProfit: number;
  stopLoss: number;
  martingaleMultiplier: number;
  candleIntervalSec: number;
  maxLossStreak: number;
  payoutRate: number; // 0.95 = 95%
  trendPeriod: number; // EMA lookback for trend confirmation
}

export interface BacktestResult {
  runs: number;
  totalTrades: number;
  winRate: number;
  netProfit: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  profitFactor: number;
  expectancy: number;
  riskOfRuin: number;
  equityCurve: number[];
}

export type RunMode = "STOPPED" | "RUNNING";

export interface EngineSnapshot {
  balance: number;
  trades: Trade[];
  candles: Candle[];
  ticks: Tick[];
  mode: RunMode;
  speed: number;
  lastTrade?: Trade;
}

export interface StrategyPreset {
  id: string;
  label: string;
  params: StrategyParams;
}

export const QUANTORA_XML_LOGO = `Q u a n t o r a   R_10`;