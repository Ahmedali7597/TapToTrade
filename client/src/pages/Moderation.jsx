import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorAlert, PageHeader, SegmentedControl, Spinner, SuccessMark, useApi } from "@/components/common";
import { outranks, topicLabel } from "@shared/validation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Small wrapper so each moderator action below reads as one line.
const post = (path, body, method = "POST") => api(path, { method, body });
const when = (date) => new Date(date).toLocaleString();
const profileLink = (username) => (
  <Link className="font-semibold text-primary hover:underline" to={`/u/${username}`}>
    {username}
  </Link>
);
/** Lifting a suspension, from a report, the ban list or an accepted appeal (the server closes any open appeal). */
const reinstate = (u, confirm = "Reinstate") => ({
  title: `Reinstate ${u.username}?`,
  confirm,
  run: (reason) => post(`/moderation/users/${u.id}/unsuspend`, { reason }),
});

/** Asks for the reason every moderator action records (5.2.3), then runs it. */
function ReasonDialog({ action, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  // `action` carries its own API call, so this dialog works for every moderator button.
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action.run(reason);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          <DialogDescription>The reason goes in the moderation log.</DialogDescription>
        </DialogHeader>
        <form id="reason-form" onSubmit={run} className="grid gap-3">
          <ErrorAlert error={error} />
          <Label htmlFor="mod-reason">Reason</Label>
          <Textarea id="mod-reason" minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reason-form" variant={action.destructive ? "destructive" : "default"} disabled={busy || reason.trim().length < 5}>
            {busy ? "Working…" : action.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One moderation queue: an optional status filter, the loading, error and empty states, then a card per item.
 * `actions(open)` lets each card's buttons open the reason dialog; the list reloads after an action.
 */
function Queue({ path, list, filters, empty, testId, children }) {
  const [status, setStatus] = useState(filters?.[0].value);
  const { data, error, loading, reload } = useApi(filters ? `${path}?status=${status}` : path);
  const [action, setAction] = useState(null);
  const items = data?.[list];
  return (
    <>
      {/* Switching the filter changes the URL useApi fetches, which reloads the list. */}
      {filters && <SegmentedControl label={`Show ${list}`} value={status} onChange={setStatus} className="mb-6" options={filters} />}
      <ErrorAlert error={error} onRetry={reload} />
      {loading && <Spinner label={`Loading ${list}`} />}
      {items?.length === 0 && <EmptyState title={empty(status)} />}
      {items?.length > 0 && (
        <ul className="grid gap-4" data-testid={testId}>
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="grid gap-3">{children(item, { status, open: setAction, reload })}</CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {/* Keyed by title so the reason box starts empty for each new action. */}
      <ReasonDialog
        key={action?.title}
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          reload();
        }}
      />
    </>
  );
}

/** A small button that opens the reason dialog for `action`. */
const ActionButton = ({ open, action, label = action.confirm, variant = "outline", className }) => (
  <Button size="sm" variant={variant} className={className} onClick={() => open(action)}>
    {label}
  </Button>
);

const Note = ({ children }) => <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{children}</p>;
const Meta = ({ children }) => <span className="ml-auto text-xs text-muted-foreground">{children}</span>;

/** The report queue: pending, reviewed and dismissed reports, with the actions a moderator can take. */
function ReportQueue() {
  const { user } = useAuth();
  // Same rule as the server (shared outranks), so we never show a button that would only get a 403.
  const canActOn = (target) => outranks(user.role, target.role);
  return (
    <Queue
      path="/moderation/reports"
      list="reports"
      testId="report-list"
      empty={(status) => `No ${status} reports`}
      filters={[
        { value: "pending", label: "Pending" },
        { value: "reviewed", label: "Reviewed" },
        { value: "dismissed", label: "Dismissed" },
      ]}
    >
      {(r, { status, open }) => (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">#{r.id}</Badge>
            <span>
              Against {profileLink(r.target.username)} ({r.target.city})
            </span>
            {r.target.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
            <Meta>
              by {r.reporter ?? "deleted user"} · {when(r.createdAt)}
            </Meta>
          </div>
          {r.item && (
            <p className="text-sm">
              Listing: <strong>{r.item.label}</strong> {r.item.id == null && <span className="text-muted-foreground">(already removed)</span>}
            </p>
          )}
          <Note>{r.reason}</Note>
          {/* Actions only make sense on open reports, and only on players you outrank (the server checks too). */}
          {status === "pending" && canActOn(r.target) && (
            <div className="flex flex-wrap gap-2">
              {r.item?.id != null && (
                <ActionButton
                  open={open}
                  variant="destructive"
                  action={{
                    title: `Remove ${r.item.label}?`,
                    confirm: "Remove listing",
                    destructive: true,
                    run: (reason) => post(`/moderation/inventory/${r.item.id}`, { reason, reportId: r.id }, "DELETE"),
                  }}
                />
              )}
              {r.target.status === "active" && (
                <ActionButton
                  open={open}
                  action={{
                    title: `Suspend ${r.target.username}?`,
                    confirm: "Suspend account",
                    destructive: true,
                    run: (reason) => post(`/moderation/users/${r.target.id}/suspend`, { reason, reportId: r.id }),
                  }}
                />
              )}
              <ActionButton
                open={open}
                variant="secondary"
                action={{ title: "Mark as reviewed", confirm: "Mark reviewed", run: (reason) => post(`/moderation/reports/${r.id}/resolve`, { status: "reviewed", reason }) }}
              />
              <ActionButton
                open={open}
                variant="ghost"
                action={{ title: "Dismiss this report", confirm: "Dismiss", run: (reason) => post(`/moderation/reports/${r.id}/resolve`, { status: "dismissed", reason }) }}
              />
            </div>
          )}
          {/* Reinstating is offered on any tab, since the suspension might come from an older report. */}
          {r.target.status === "suspended" && canActOn(r.target) && (
            <ActionButton open={open} label="Reinstate account" className="justify-self-start" action={reinstate(r.target)} />
          )}
        </>
      )}
    </Queue>
  );
}

/** Bans: every suspended account, who suspended it and why, with a way to lift it. */
function BanList() {
  const { user } = useAuth();
  return (
    <Queue path="/moderation/suspended" list="users" testId="ban-list" empty={() => "No suspended accounts"}>
      {(u, { open }) => (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{u.username}</span>
            <span className="text-muted-foreground">({u.city})</span>
            <Badge variant="destructive">Suspended</Badge>
            {u.appealPending && <Badge variant="secondary">Appeal waiting</Badge>}
            <Meta>{u.suspendedAt ? `by ${u.suspendedBy ?? "a moderator"} · ${when(u.suspendedAt)}` : "suspended outside the app"}</Meta>
          </div>
          {u.reason && <Note>{u.reason}</Note>}
          {outranks(user.role, u.role) && <ActionButton open={open} label="Reinstate account" className="justify-self-start" action={reinstate(u)} />}
        </>
      )}
    </Queue>
  );
}

/** Appeals from suspended players. Accepting one reinstates the account; rejecting keeps the suspension. */
function AppealQueue() {
  const { user } = useAuth();
  return (
    <Queue
      path="/moderation/appeals"
      list="appeals"
      testId="appeal-list"
      empty={(status) => `No ${status} appeals`}
      filters={[
        { value: "pending", label: "Pending" },
        { value: "accepted", label: "Accepted" },
        { value: "rejected", label: "Rejected" },
      ]}
    >
      {(a, { status, open }) => (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">#{a.id}</Badge>
            <span>
              from <span className="font-semibold">{a.user.username}</span> ({a.user.city})
            </span>
            {a.user.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
            <Meta>{status === "pending" ? when(a.createdAt) : `answered by ${a.reviewedBy ?? "a moderator"} · ${when(a.reviewedAt)}`}</Meta>
          </div>
          <Note>{a.message}</Note>
          {status === "pending" && outranks(user.role, a.user.role) && (
            <div className="flex flex-wrap gap-2">
              <ActionButton open={open} variant="default" label="Accept and reinstate" action={reinstate(a.user, "Accept appeal")} />
              <ActionButton
                open={open}
                variant="ghost"
                action={{ title: `Reject ${a.user.username}'s appeal?`, confirm: "Reject appeal", destructive: true, run: (reason) => post(`/moderation/appeals/${a.id}/reject`, { reason }) }}
              />
            </div>
          )}
        </>
      )}
    </Queue>
  );
}

/** Suggestions from players. Marking one reviewed tells its sender it was read; it isn't a moderation action. */
function SuggestionInbox() {
  const [done, setDone] = useState(() => new Set());
  const [actionError, setActionError] = useState(null);
  return (
    <>
      <ErrorAlert error={actionError} />
      <Queue
        path="/moderation/suggestions"
        list="suggestions"
        testId="suggestion-list"
        empty={(status) => (status === "new" ? "No new suggestions" : "No reviewed suggestions yet")}
        filters={[
          { value: "new", label: "New" },
          { value: "reviewed", label: "Reviewed" },
        ]}
      >
        {(s, { status, reload }) => {
          const review = async () => {
            setActionError(null);
            try {
              await api(`/moderation/suggestions/${s.id}/review`, { method: "POST" });
              // Show the green check for a moment, then let the list refresh without it.
              setDone((d) => new Set(d).add(s.id));
              setTimeout(reload, 900);
            } catch (err) {
              setActionError(err);
            }
          };
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{topicLabel(s.topic)}</Badge>
                <span>from {profileLink(s.from)}</span>
                <Meta>{when(s.createdAt)}</Meta>
              </div>
              <Note>{s.message}</Note>
              {status === "new" &&
                (done.has(s.id) ? (
                  <p className="flex items-center gap-2 text-sm font-medium text-success" role="status">
                    <SuccessMark className="size-5" /> Marked reviewed
                  </p>
                ) : (
                  <Button size="sm" variant="secondary" className="justify-self-start" onClick={review}>
                    Mark reviewed
                  </Button>
                ))}
            </>
          );
        }}
      </Queue>
    </>
  );
}

const VIEWS = { reports: ReportQueue, bans: BanList, appeals: AppealQueue, suggestions: SuggestionInbox };

/** 4.6.2–4.6.4: moderators review reports, remove listings, suspend or reinstate accounts and answer appeals. */
export function ModerationPage() {
  const [view, setView] = useState("reports");
  const View = VIEWS[view];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageHeader title="Moderation" description="Review reports and appeals, manage bans and read suggestions. Every action you take here is logged with your reason." />
      <SegmentedControl
        label="Moderation queue"
        value={view}
        onChange={setView}
        className="mb-4 flex"
        options={[
          { value: "reports", label: "Reports" },
          { value: "bans", label: "Bans" },
          { value: "appeals", label: "Appeals" },
          { value: "suggestions", label: "Suggestions" },
        ]}
      />
      <View />
    </div>
  );
}
