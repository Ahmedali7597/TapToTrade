import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";
import { notificationText } from "@shared/notifications";

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
};

// System notifications (the browser's own pop-ups) need the player to say yes once; the browser remembers.
// iPhones only offer them to the site added to the Home Screen, so the button hides where they're unavailable.
const canAlert = () => typeof window !== "undefined" && "Notification" in window;

/**
 * The bell in the header: a red count of unread notifications, the newest 30 in a menu (opening it marks them
 * read), and, if the player allows it, a system notification when one arrives while the tab is in the background.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [state, setState] = useState({ notifications: [], unread: 0 });
  const [seenIds, setSeenIds] = useState(() => new Set()); // shown as new until the menu closes
  const [permission, setPermission] = useState(() => (canAlert() ? Notification.permission : "unsupported"));

  const load = () => api("/notifications").then(setState, () => {});
  useEffect(() => {
    load();
  }, []);

  useLive({
    notification: (n) => {
      setState((s) => ({ notifications: [n, ...s.notifications.filter((x) => x.id !== n.id)].slice(0, 30), unread: s.unread + (s.notifications.some((x) => x.id === n.id && !x.read) ? 0 : 1) }));
      if (canAlert() && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const alert = new Notification("Tap to Trade", { body: notificationText(n), icon: "/brand/icon-512.png", tag: `trade-${n.threadId}` });
        alert.onclick = () => {
          window.focus();
          navigate(`/trades/${n.tradeId}`);
          alert.close();
        };
      }
    },
    reconnect: load,
  });

  const openChange = (open) => {
    if (open && state.unread) {
      setSeenIds(new Set(state.notifications.filter((n) => !n.read).map((n) => n.id)));
      api("/notifications/read", { method: "POST", body: {} }).then(setState, () => {});
    }
    if (!open) setSeenIds(new Set());
  };
  const allowAlerts = async () => setPermission(await Notification.requestPermission());

  const count = state.unread > 9 ? "9+" : String(state.unread);
  return (
    <DropdownMenu onOpenChange={openChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={state.unread ? `Notifications, ${state.unread} unread` : "Notifications"}>
          {state.unread ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />}
          {state.unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.65rem] leading-none font-bold text-white ring-2 ring-background"
              aria-hidden="true"
              data-testid="notification-count"
            >
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <DropdownMenuLabel className="px-3 py-2.5 text-sm font-semibold">Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-[min(24rem,60dvh)] overflow-y-auto py-1" data-testid="notification-list">
          {state.notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. Trade requests, answers, messages and meetups show up here.</p>
          ) : (
            state.notifications.map((n) => (
              <DropdownMenuItem key={n.id} onSelect={() => navigate(`/trades/${n.tradeId}`)} className="mx-1 items-start gap-2.5 px-2 py-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", seenIds.has(n.id) || !n.read ? "bg-red-600" : "bg-transparent")} aria-hidden="true" />
                <span className="grid min-w-0 gap-0.5">
                  <span className={cn("text-sm leading-snug", (seenIds.has(n.id) || !n.read) && "font-semibold")}>{notificationText(n)}</span>
                  <span className="text-xs text-muted-foreground">{ago(n.createdAt)}</span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
        {permission !== "unsupported" && permission !== "granted" && (
          <>
            <DropdownMenuSeparator className="my-0" />
            <div className="px-3 py-2.5 text-xs text-muted-foreground">
              {permission === "denied" ? (
                "Alerts on this device are blocked. You can allow them in your browser's site settings."
              ) : (
                <Button variant="outline" size="sm" className="w-full" onClick={allowAlerts}>
                  Show alerts on this device
                </Button>
              )}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
