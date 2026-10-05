import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ScrollText, Download, Volume2, VolumeX, Terminal } from "lucide-react";
import type { TradeLogEntry } from "../types";

interface Props {
  logs: TradeLogEntry[];
  soundOn: boolean;
  onToggleSound: () => void;
}

type Filter = "ALL" | "TRADE" | "BOT" | "ALERT";

const toneColor: Record<TradeLogEntry["tone"], string> = {
  info: "text-cyan-300",
  win: "text-emerald-400",
  loss: "text-red-400",
  warn: "text-amber-400",
  system: "text-zinc-500",
};

const toneDot: Record<TradeLogEntry["tone"], string> = {
  info: "bg-cyan-400",
  win: "bg-emerald-400",
  loss: "bg-red-400",
  warn: "bg-amber-400",
  system: "bg-zinc-600",
};

function exportCsv(logs: TradeLogEntry[]) {
  const rows = [
    ["time", "category", "tone", "message"],
    ...logs.map((l) => [
      new Date(l.time).toISOString(),
      l.category,
      l.tone,
      `"${l.message.replace(/"/g, '""')}"`,
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join(String.fromCharCode(10));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quantora-r10-execution-log.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExecutionConsole({ logs, soundOn, onToggleSound }: Props) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, filter]);

  const visible = filter === "ALL" ? logs : logs.filter((l) => l.category === filter);

  return (
    <div className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.5} />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">Execution Log</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleSound}
            title="Toggle sound"
            className="rounded border border-zinc-700 bg-zinc-800/60 p-1 text-zinc-400 transition hover:text-zinc-200 active:scale-[0.95]"
          >
            {soundOn ? <Volume2 className="h-3 w-3" strokeWidth={1.5} /> : <VolumeX className="h-3 w-3" strokeWidth={1.5} />}
          </button>
          <button
            onClick={() => exportCsv(logs)}
            title="Export CSV"
            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1 text-[10px] font-medium text-zinc-400 transition hover:text-zinc-200 active:scale-[0.95]"
          >
            <Download className="h-3 w-3" strokeWidth={1.5} /> CSV
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-800/70 px-2 py-1.5">
        {(["ALL", "TRADE", "BOT", "ALERT"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold transition active:scale-[0.97] ${
              filter === f ? "bg-cyan-500/15 text-cyan-300" : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto p-2 font-mono text-[10px] leading-snug">
        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center text-zinc-600">
            <Terminal className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
            No events yet. Start the bot to begin streaming.
          </div>
        )}
        {visible.map((l) => (
          <motion.div
            key={l.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex gap-2 rounded px-1 py-0.5 transition-colors hover:bg-zinc-900/70"
          >
            <span className="shrink-0 text-zinc-600">
              {new Date(l.time).toLocaleTimeString("en-US", { hour12: false })}
            </span>
            <span className="mt-[5px] shrink-0 self-center">
              <span className={`block h-1 w-1 rounded-full ${toneDot[l.tone]}`} />
            </span>
            <span className={`shrink-0 font-semibold ${toneColor[l.tone]}`}>{l.category}</span>
            <span className="break-words text-zinc-400">{l.message}</span>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-1 font-mono text-[9px] text-zinc-600">
        <span>{visible.length} lines</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
        </span>
      </div>
    </div>
  );
}