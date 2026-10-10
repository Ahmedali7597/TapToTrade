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
          <DialogDescription>The reason is stored in the moderation log.</DialogDescription>
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

/** Suggestions from players, for moderators and admins. Marking one reviewed tells its sender it was read. */
function SuggestionInbox() {
  const [status, setStatus] = useState("new");
  const { data, error, loading, reload } = useApi(`/moderation/suggestions?status=${status}`);
  const [done, setDone] = useState(() => new Set());
  const [actionError, setActionError] = useState(null);
  const review = async (id) => {
    setActionError(null);
    try {
      await api(`/moderation/suggestions/${id}/review`, { method: "POST" });
      // Show the green check for a moment, then let the list refresh without it.
      setDone((d) => new Set(d).add(id));
      setTimeout(reload, 900);
    } catch (err) {
      setActionError(err);
    }
  };
  return (
    <>
      <SegmentedControl
        label="Show suggestions"
        value={status}
        onChange={setStatus}
        className="mb-6"
        options={[
          { value: "new", label: "New" },
          { value: "reviewed", label: "Reviewed" },
        ]}
      />
      <ErrorAlert error={error ?? actionError} onRetry={reload} />
      {loading && <Spinner label="Loading suggestions" />}
      {data && data.suggestions.length === 0 && <EmptyState title={status === "new" ? "No new suggestions" : "No reviewed suggestions yet"} />}
      {data && data.suggestions.length > 0 && (
        <ul className="grid gap-4" data-testid="suggestion-list">
          {data.suggestions.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{topicLabel(s.topic)}</Badge>
                    <span>
                      from{" "}
                      <Link className="font-semibold text-primary hover:underline" to={`/u/${s.from}`}>
                        {s.from}
                      </Link>
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{s.message}</p>
                  {status === "new" &&
                    (done.has(s.id) ? (
                      <p className="flex items-center gap-2 text-sm font-medium text-success" role="status">
                        <SuccessMark className="size-5" /> Marked reviewed
                      </p>
                    ) : (
                      <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => review(s.id)}>
                        Mark reviewed
                      </Button>
                    ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 4.6.2–4.6.4: moderators review reports, remove listings and suspend or reinstate accounts. */
export function ModerationPage() {
  const [view, setView] = useState("reports");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageHeader title="Moderation" description="Review reports from the community and read players' suggestions. Every moderation action is logged with your reason." />
      <SegmentedControl
        label="Moderation queue"
        value={view}
        onChange={setView}
        className="mb-4 flex"
        options={[
          { value: "reports", label: "Reports" },
          { value: "suggestions", label: "Suggestions" },
        ]}
      />
      {view === "reports" ? <ReportQueue /> : <SuggestionInbox />}
    </div>
  );
}

/** The report queue: pending, reviewed and dismissed reports, with the actions a moderator can take. */
function ReportQueue() {
  const { user } = useAuth();
  const [status, setStatus] = useState("pending");
  const { data, error, loading, reload } = useApi(`/moderation/reports?status=${status}`);
  const [action, setAction] = useState(null);

  // Small wrapper so each button below reads as one line.
  const post = (path, body, method = "POST") => api(path, { method, body });
  // Same rule as the server (shared outranks), so we never show a button that would only get a 403.
  const canActOn = (target) => outranks(user.role, target.role);

  return (
    <>
      {/* Switching tabs changes the URL useApi fetches, which reloads the list. */}
      <SegmentedControl
        label="Show reports"
        value={status}
        onChange={setStatus}
        className="mb-6"
        options={[
          { value: "pending", label: "Pending" },
          { value: "reviewed", label: "Reviewed" },
          { value: "dismissed", label: "Dismissed" },
        ]}
      />
      <ErrorAlert error={error} onRetry={reload} />
      {loading && <Spinner label="Loading reports" />}
      {data && data.reports.length === 0 && <EmptyState title={`No ${status} reports`} />}
      {data && data.reports.length > 0 && (
        <ul className="grid gap-4" data-testid="report-list">
          {data.reports.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">#{r.id}</Badge>
                    <span>
                      Against{" "}
                      <Link className="font-semibold text-primary hover:underline" to={`/u/${r.target.username}`}>
                        {r.target.username}
                      </Link>{" "}
                      ({r.target.city})
                    </span>
                    {r.target.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      by {r.reporter ?? "deleted user"} · {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {r.item && (
                    <p className="text-sm">
                      Listing: <strong>{r.item.label}</strong> {r.item.id == null && <span className="text-muted-foreground">(already removed)</span>}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{r.reason}</p>
                  {/* Actions only make sense on reports that are still open. */}
                  {status === "pending" && (
                    <div className="flex flex-wrap gap-2">
                      {r.item?.id != null && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setAction({
                              title: `Remove ${r.item.label}?`,
                              confirm: "Remove listing",
                              destructive: true,
                              run: (reason) => post(`/moderation/inventory/${r.item.id}`, { reason, reportId: r.id }, "DELETE"),
                            })
                          }
                        >
                          Remove listing
                        </Button>
                      )}
                      {r.target.status === "active" && canActOn(r.target) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setAction({
                              title: `Suspend ${r.target.username}?`,
                              confirm: "Suspend account",
                              destructive: true,
                              run: (reason) => post(`/moderation/users/${r.target.id}/suspend`, { reason, reportId: r.id }),
                            })
                          }
                        >
                          Suspend account
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setAction({ title: "Mark as reviewed", confirm: "Mark reviewed", run: (reason) => post(`/moderation/reports/${r.id}/resolve`, { status: "reviewed", reason }) })
                        }
                      >
                        Mark reviewed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAction({ title: "Dismiss this report", confirm: "Dismiss", run: (reason) => post(`/moderation/reports/${r.id}/resolve`, { status: "dismissed", reason }) })
                        }
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {/* Reinstating is offered on any tab, since the suspension might come from an older report. */}
                  {r.target.status === "suspended" && canActOn(r.target) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="justify-self-start"
                      onClick={() =>
                        setAction({ title: `Reinstate ${r.target.username}?`, confirm: "Reinstate", run: (reason) => post(`/moderation/users/${r.target.id}/unsuspend`, { reason }) })
                      }
                    >
                      Reinstate account
                    </Button>
                  )}
                </CardContent>
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
