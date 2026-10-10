import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorAlert, PageHeader, SegmentedControl, shake, Spinner, SuccessMessage, useApi } from "@/components/common";
import { api } from "@/lib/api";
import { SUGGESTION_TOPICS, topicLabel } from "@shared/validation";

const MAX = 2000;

/** Players send ideas to the moderators and admins, and can see which ones have been read. */
export default function Suggestions() {
  const mine = useApi("/suggestions/mine");
  const form = useRef(null);
  const [topic, setTopic] = useState("feature");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSent(false);
    if (message.trim().length < 10) {
      setFields({ message: "Write at least 10 characters so the team knows what you mean." });
      shake(form.current);
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/suggestions", { method: "POST", body: { topic, message } });
      setSent(true);
      setMessage("");
      mine.reload();
    } catch (err) {
      setFields(err.fields ?? {});
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader title="Suggestions" description="An idea, a missing card, something that didn't work? The moderators and admins read every suggestion." />
      <Card>
        <CardHeader>
          <CardTitle>Send a suggestion</CardTitle>
          <CardDescription>Plain text only. Please don't include passwords or other private details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={form} onSubmit={submit} noValidate className="grid gap-4">
            <ErrorAlert error={error} title="Suggestion not sent" />
            <div className="grid gap-1.5">
              <span className="text-sm font-medium" aria-hidden="true">
                What's it about?
              </span>
              <SegmentedControl label="What's it about?" value={topic} onChange={setTopic} options={SUGGESTION_TOPICS} className="flex-wrap" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="suggestion">Your suggestion</Label>
              <Textarea
                id="suggestion"
                rows={5}
                maxLength={MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-invalid={!!fields.message}
                aria-describedby={fields.message ? "suggestion-error suggestion-count" : "suggestion-count"}
                placeholder="e.g. It would help to filter search by set."
              />
              <div className="flex justify-between gap-4 text-xs">
                <span id="suggestion-error" className="font-medium text-destructive">
                  {fields.message}
                </span>
                <span id="suggestion-count" className="shrink-0 text-muted-foreground tabular-nums">
                  {message.length} / {MAX}
                </span>
              </div>
            </div>
            <Button type="submit" disabled={busy} className="justify-self-start">
              {busy ? "Sending…" : "Send suggestion"}
            </Button>
            {sent && <SuccessMessage>Thanks! Your suggestion is on its way to the moderators.</SuccessMessage>}
          </form>
        </CardContent>
      </Card>

      <section className="mt-10" aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="mb-4 text-xl font-semibold">
          Your suggestions
        </h2>
        <ErrorAlert error={mine.error} onRetry={mine.reload} />
        {mine.loading && !mine.data && <Spinner label="Loading your suggestions" />}
        {mine.data && mine.data.suggestions.length === 0 && <EmptyState title="Nothing sent yet" body="Your suggestions and whether they've been read show up here." />}
        {mine.data && mine.data.suggestions.length > 0 && (
          <ul className="grid gap-3">
            {mine.data.suggestions.map((s, i) => (
              <li key={s.id} className="slide-in rounded-xl border bg-card p-4" style={{ "--i": Math.min(i, 8) }}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{topicLabel(s.topic)}</Badge>
                  <Badge variant="outline" className={s.status === "reviewed" ? "border-primary/30 bg-accent text-accent-foreground" : undefined}>
                    {s.status === "reviewed" ? "Read by the team" : "Waiting to be read"}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{s.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
