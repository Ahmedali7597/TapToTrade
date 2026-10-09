import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, SuccessMark } from "@/components/common";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

// Matches the server's body limit for imports.
const MAX_BYTES = 3 * 1024 * 1024;

/** Import a collection export (CSV) from another site, or a pasted list. Calls onImported() when done. */
export default function ImportCollection({ onImported }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => {
    setText("");
    setFileName("");
    setError(null);
    setResult(null);
  };
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) return setError(new Error("That file is over 3 MB. Split it and import it in parts."));
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api("/inventory/import", { method: "POST", body: { text, available } }));
      onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="size-4" aria-hidden="true" /> Import collection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import your collection</DialogTitle>
          <DialogDescription>
            Bring cards over from Moxfield, Archidekt, ManaBox, Deckbox, TCGplayer, Dragon Shield, MTGGoldfish or TopDecked using their collection
            CSV export, or paste a list like <code>4 Lightning Bolt (M10) 146</code>.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3" role="status">
            <p className="flex items-center gap-2 font-medium">
              <SuccessMark />
              Imported {result.cards} card{result.cards === 1 ? "" : "s"} into {result.listings} listing{result.listings === 1 ? "" : "s"}
              {!["CSV", "Text list"].includes(result.format) && ` from your ${result.format} export`}.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.nameOnly > 0 && <li>{result.nameOnly} card(s) had no set, so the newest printing was used. Edit them if yours differ.</li>}
              {result.adjustedFinish > 0 && <li>{result.adjustedFinish} card(s) were listed in a finish their printing doesn't come in, so it was corrected.</li>}
              <li>Cards you already listed in the same printing, condition and finish were added to those listings.</li>
            </ul>
            {result.skippedCount > 0 && (
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {result.skippedCount} row{result.skippedCount === 1 ? "" : "s"} skipped
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {result.skipped.map((s) => (
                    <li key={`${s.line}-${s.name}`}>
                      Line {s.line}
                      {s.name && <> · {s.name}</>}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <ErrorAlert error={error} title="Import didn't work" />
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">Collection file (.csv or .txt)</Label>
              <input
                id="import-file"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={pickFile}
                className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
              <p className="text-xs text-muted-foreground">Tip: keep the Scryfall ID or set and collector number columns in your export so the exact printing is matched.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="import-text">{fileName ? `Contents of ${fileName}` : "…or paste your list"}</Label>
              <Textarea id="import-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"4 Lightning Bolt (M10) 146\n1 Sol Ring (C21) 263\n2 Opt (ELD) 59 *F*"} className="font-mono text-xs" />
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Switch id="import-share" checked={available} onCheckedChange={setAvailable} />
              <Label htmlFor="import-share">Share new listings for trade (you can hide any card later)</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !text.trim()}>
                {busy ? "Importing… this can take a minute" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
