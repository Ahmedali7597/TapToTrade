import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, SuccessMessage } from "@/components/common";
import { api } from "@/lib/api";

/** 4.6.1: report a player, or one of their listings when `item` is given. Kept apart from trade actions. */
export default function ReportDialog({ user, item, triggerLabel }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const subject = item ? `${item.printing.name} listed by ${user.username}` : `${user.username}`;

  // Send the report. A listing report only needs the item id; the server works out the owner.
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/reports", { method: "POST", body: item ? { inventoryItemId: item.id, reason } : { reportedUserId: user.id, reason } });
      setDone(true);
      setReason("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      // Reset the "thanks" message when the dialog closes so it can be used again.
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDone(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Flag aria-hidden="true" /> {triggerLabel ?? (item ? "Report listing" : "Report player")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {subject}</DialogTitle>
          <DialogDescription>Moderators review every report. Describe what's wrong without sharing private details.</DialogDescription>
        </DialogHeader>
        {done ? (
          <SuccessMessage className="rounded-md bg-accent p-3 text-foreground">Thanks. Your report was sent to the moderators.</SuccessMessage>
        ) : (
          <form id="report-form" onSubmit={submit} className="grid gap-3">
            <ErrorAlert error={error} title="Report not sent" />
            <div className="grid gap-1.5">
              <Label htmlFor="report-reason">Reason</Label>
              <Textarea
                id="report-reason"
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. The listing shows a proxy as a real card."
              />
            </div>
          </form>
        )}
        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <Button type="submit" form="report-form" disabled={busy || reason.trim().length < 5}>
              {busy ? "Sending…" : "Send report"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
