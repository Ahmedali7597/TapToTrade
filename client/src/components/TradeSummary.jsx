import { Link } from "react-router";
import { MapPin } from "lucide-react";
import { StatusBadge } from "@/components/common";
import { cn } from "@/lib/utils";

// A trade proposal as one row, shown in the trades inbox and on the dashboard.

// e.g. "Oct 3, 2026, 4:15 PM" in the viewer's own locale.
export const fmtDate = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// Total cards across a set of lines (quantities added up, not just the number of lines).
const count = (lines) => lines.reduce((n, l) => n + l.quantity, 0);

/** The viewer's perspective, always phrased as "You give / You receive" (mockup 6 direction). */
export function perspective(trade, viewerId) {
  const iAmSender = trade.sender.id === viewerId;
  return {
    iAmSender,
    other: iAmSender ? trade.receiver : trade.sender,
    give: iAmSender ? trade.offered : trade.requested,
    receive: iAmSender ? trade.requested : trade.offered,
  };
}

/** One proposal as a clickable summary row. */
export function TradeSummary({ trade, viewerId }) {
  const p = perspective(trade, viewerId);
  // Highlight proposals waiting on this user.
  const needsAction = !p.iAmSender && trade.status === "pending";
  return (
    <Link
      to={`/trades/${trade.id}`}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-primary/50 hover:bg-accent/40",
        needsAction && "border-rare-ink/30 bg-rare/40",
      )}
    >
      <StatusBadge status={trade.status} />
      <span className="font-semibold">{p.other.username}</span>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden="true" /> {p.other.city}
      </span>
      <span className="text-sm">
        You give <strong>{count(p.give)}</strong>, you receive <strong>{count(p.receive)}</strong>
      </span>
      {trade.parentId && <span className="text-xs text-muted-foreground">counter-offer</span>}
      <span className="ml-auto text-xs text-muted-foreground">{fmtDate(trade.createdAt)}</span>
      {needsAction && <span className="w-full text-sm font-semibold text-rare-ink sm:w-auto">Needs your response</span>}
    </Link>
  );
}
