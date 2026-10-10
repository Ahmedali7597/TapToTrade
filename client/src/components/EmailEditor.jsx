import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, Spinner, SuccessMessage, useApi } from "@/components/common";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildEmail, EMAIL_KINDS, NOTE_MAX, previewKind, sampleData } from "@shared/emails";

/**
 * Admin page: add your own text to the site's emails (or to the footer of all of them), see a live preview,
 * and send yourself a test. The site still builds each email, so its links and buttons always work.
 */
export default function EmailEditor() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi("/admin/emails");
  const [key, setKey] = useState(EMAIL_KINDS[0].key);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState(null); // { message } or { error }
  const [busy, setBusy] = useState(null); // "save" | "test"
  const saved = data?.texts[key];
  const kind = EMAIL_KINDS.find((k) => k.key === key);

  // Switching emails (or a fresh load) starts from that email's saved text.
  const savedBody = saved?.body ?? "";
  useEffect(() => setDraft(savedBody), [key, savedBody]);
  useEffect(() => setStatus(null), [key]);

  // The preview shows the draft in place of the saved text, on made-up data.
  const preview = useMemo(() => {
    if (!data) return null;
    const texts = Object.fromEntries(Object.entries(data.texts).map(([k, v]) => [k, v.body]));
    texts[key] = draft;
    const shown = previewKind(key);
    return buildEmail(shown, { ...sampleData(key, data.site, user.username), note: texts[shown], footer: texts.footer });
  }, [data, key, draft, user.username]);

  const run = async (which, fn) => {
    setBusy(which);
    setStatus(null);
    try {
      setStatus({ message: await fn() });
    } catch (err) {
      setStatus({ error: err });
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run("save", async () => {
      await api(`/admin/emails/${key}`, { method: "PUT", body: { body: draft } });
      reload();
      return draft.trim() ? "Saved. New emails include this text." : "Removed. Emails go out without extra text.";
    });
  const test = () => run("test", async () => (await api(`/admin/emails/${key}/test`, { method: "POST", body: { body: draft } })).message);

  return (
    <section className="mt-12" aria-labelledby="emails-heading">
      <div className="mb-4">
        <h2 id="emails-heading" className="text-xl font-semibold">
          Email messages
        </h2>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Add your own words to the emails the site sends, like a thank-you, a tip, or a shout-out to a partner store. The site writes the rest (buttons,
          links, card lists), so they always work.
        </p>
      </div>
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data && <Spinner label="Loading email messages" />}
      {data && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid content-start gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email-kind">Email</Label>
              <NativeSelect id="email-kind" value={key} onChange={(e) => setKey(e.target.value)} className="w-full">
                {EMAIL_KINDS.map((k) => (
                  <NativeSelectOption key={k.key} value={k.key}>
                    {k.label}
                    {data.texts[k.key] ? " (customized)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">{kind.when}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email-text">{key === "footer" ? "Footer text" : "Your text (shown under the message)"}</Label>
              <Textarea
                id="email-text"
                rows={7}
                maxLength={NOTE_MAX}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-describedby="email-text-help"
                placeholder={key === "footer" ? "e.g. Proud partner of The Mana Vault, Hamilton. Trade night is every Friday!" : "e.g. Thanks for joining, {username}! Say hi at our next trade night."}
              />
              <div id="email-text-help" className="flex justify-between gap-4 text-xs text-muted-foreground">
                <span>Plain text. A blank line starts a new paragraph. https:// links and email addresses become clickable; {"{username}"} becomes the player's name.</span>
                <span className="shrink-0 tabular-nums">
                  {draft.length} / {NOTE_MAX}
                </span>
              </div>
            </div>
            {saved && (
              <p className="text-xs text-muted-foreground">
                Last saved {new Date(saved.updatedAt).toLocaleString()}
                {saved.updatedBy ? ` by ${saved.updatedBy}` : ""}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={busy !== null || draft.trim() === savedBody}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={test} disabled={busy !== null}>
                {busy === "test" ? "Sending…" : "Send me a test"}
              </Button>
            </div>
            {status?.message && <SuccessMessage>{status.message}</SuccessMessage>}
            <ErrorAlert error={status?.error} title="That didn't work" />
          </div>
          <div className="grid content-start gap-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Subject:</span> <span className="font-medium">{preview.subject}</span>
            </p>
            {/* sandbox="" : the preview can't run scripts or navigate; it's just a picture of the email. */}
            <iframe title={`Preview of the ${kind.label} email`} sandbox="" srcDoc={preview.html} className="h-[38rem] w-full rounded-xl border bg-white" />
            <p className="text-xs text-muted-foreground">Preview with made-up names and cards.{key === "footer" ? " The footer is shown on the welcome email." : ""}</p>
          </div>
        </div>
      )}
    </section>
  );
}
