import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftRight, Info, MapPin, Star } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardImage, ConditionBadge, EmptyState, ErrorAlert, FinishBadge, PageHeader, PageMessage, Spinner, StatusBadge, SuccessMark, useApi } from "@/components/common";
import ReportDialog from "@/components/ReportDialog";
import TradeComposer from "@/components/TradeComposer";
import TradeSentDialog from "@/components/TradeSentDialog";
import { fmtDate, perspective, TradeSummary } from "@/components/TradeSummary";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import LazyMap from "@/components/LazyMap";
import { meetupArea } from "@shared/cities";

// List of summaries with a quick staggered fade-in (capped so long lists don't crawl in).
function TradeList({ trades, viewerId, empty }) {
  if (!trades.length) return <EmptyState title={empty} />;
  return (
    <ul className="grid gap-3">
      {trades.map((t, i) => (
        <li key={t.id} className="slide-in" style={{ "--i": Math.min(i, 10) }}>
          <TradeSummary trade={t} viewerId={viewerId} />
        </li>
      ))}
    </ul>
  );
}

/** 4.5.6: sent and received requests, including what was requested and offered. */
export function TradesPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi("/trades");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageHeader title="Trades" description="Proposals you've received and sent. Only the player who received a pending proposal can respond." />
      <ErrorAlert error={error} title="Couldn't load trades" onRetry={reload} />
      {loading && <Spinner label="Loading trades" />}
      {/* Received first, since those are the ones that might need a reply. */}
      {data && (
        <Tabs defaultValue="received">
          <TabsList>
            <TabsTrigger value="received">Received ({data.received.length})</TabsTrigger>
            <TabsTrigger value="sent">Sent ({data.sent.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="received" className="mt-4">
            <TradeList trades={data.received} viewerId={user.id} empty="No proposals received yet." />
          </TabsContent>
          <TabsContent value="sent" className="mt-4">
            <TradeList trades={data.sent} viewerId={user.id} empty="You haven't sent any proposals yet." />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// The cards on one side of a proposal, read from the snapshot saved when it was sent.
function LineList({ lines, emptyText }) {
  if (!lines.length) return <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid gap-2">
      {lines.map((l) => (
        <li key={l.id} className="group flex items-center gap-3 rounded-lg border bg-background/60 p-2">
          <CardImage
            name={l.cardName}
            setCode={l.setCode}
            imageUrl={l.imageUrl}
            finish={l.finish}
            printingId={l.printingId}
            siblings={lines.map((x) => x.printingId)}
            className="w-12 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{l.cardName}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {l.setCode.toUpperCase()} #{l.collectorNumber} <ConditionBadge condition={l.condition} /> <FinishBadge finish={l.finish} />
              {l.inventoryItemId == null && <span>(listing since removed)</span>}
            </p>
          </div>
          <span className="text-lg font-bold tabular-nums" aria-label={`quantity ${l.quantity}`}>
            ×{l.quantity}
          </span>
        </li>
      ))}
    </ul>
  );
}

// "You give" and "You receive" side by side, always from the viewer's point of view.
function ProposalPanels({ trade, viewerId }) {
  const p = perspective(trade, viewerId);
  const emptyText = trade.offered.length === 0 ? "No cards were offered in return. This is a request-only proposal." : "Nothing.";
  // Both halves look the same apart from the title and the lines, so build them from one template.
  const panel = (title, lines) => (
    <section className="pocket p-5 pt-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <LineList lines={lines} emptyText={emptyText} />
    </section>
  );
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
      {panel("You give", p.give)}
      <span className="mx-auto hidden size-10 items-center justify-center self-center rounded-full bg-primary text-primary-foreground shadow-md md:flex" aria-hidden="true">
        <ArrowLeftRight className="size-5" />
      </span>
      {panel("You receive", p.receive)}
    </div>
  );
}

/**
 * After an accepted trade: did it happen, and how was the other player? One answer, final. "It happened"
 * with stars adds to their completed trades and rating, and swaps the cards in this player's inventory (gave
 * out, got in); "It didn't happen" is kept private and changes nothing.
 */
function TradeFeedback({ trade, other, feedback, onSent }) {
  const [rating, setRating] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (feedback) {
    return (
      <p className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
        <SuccessMark className="size-5" />
        {feedback.completed ? `Thanks! You rated ${other.username} ${feedback.rating} out of 5.` : "Thanks. You told us this trade didn't happen."}
      </p>
    );
  }
  const send = async (body) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/trades/${trade.id}/feedback`, { method: "POST", body });
      onSent();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t pt-4">
      <fieldset>
        <legend className="font-semibold">Did you meet and trade? Rate {other.username}</legend>
        <p className="text-sm text-muted-foreground">
          Ratings build each player's trade record on their profile. Saying you traded also updates your inventory: the cards
          you gave are removed and the cards you got are added. You can only answer once.
        </p>
        {/* Native radios (visually hidden) keep arrow keys and screen readers working; the stars are the labels. */}
        <div className="mt-3 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded-md p-1 transition-transform hover:scale-110 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name={`rating-${trade.id}`} value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <Star className={cn("size-7", n <= rating ? "fill-rare-ink text-rare-ink" : "text-muted-foreground")} aria-hidden="true" />
              <span className="sr-only">
                {n} star{n === 1 ? "" : "s"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="mt-2 text-sm font-medium text-destructive">{error.message}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button size="sm" disabled={!rating || busy} onClick={() => send({ completed: true, rating })}>
          We traded, send rating
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => send({ completed: false })}>
          It didn't happen
        </Button>
      </div>
    </div>
  );
}

/**
 * "Where to meet": both players at their cities' centres, partner stores near the viewer, and other game stores
 * around the halfway point (Google map only). Shown while a trade is pending or accepted.
 */
function MeetupMap({ trade, viewerId }) {
  const p = perspective(trade, viewerId);
  const me = p.iAmSender ? trade.sender : trade.receiver;
  const stores = useApi(`/stores${qs({ city: me.city, radius: 100 })}`);
  const area = meetupArea(me.city, p.other.city);
  // Memoized so the map only redraws (and re-zooms) when what it shows changes.
  const shown = useMemo(() => {
    const partners = stores.data?.stores ?? [];
    // The chosen meetup spot always shows, even if it's further than 100 km from the viewer.
    return trade.meetupSpot && !partners.some((s) => s.id === trade.meetupSpot.id) ? [...partners, trade.meetupSpot] : partners;
  }, [stores.data, trade.meetupSpot]);
  const people = useMemo(
    () => (me.city === p.other.city ? [{ city: me.city, label: `You and ${p.other.username}` }] : [{ city: me.city, label: "You" }, { city: p.other.city, label: p.other.username }]),
    [me.city, p.other.city, p.other.username],
  );
  return (
    <section className="mt-8" aria-labelledby="meet-heading">
      <h2 id="meet-heading" className="flex items-center gap-1.5 text-lg font-bold">
        <MapPin className="size-5 text-primary" aria-hidden="true" /> Where to meet
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Game stores between {me.city === p.other.city ? "you" : `${me.city} and ${p.other.city}`} are good public places to trade. Tap a pin for
        details.
      </p>
      <LazyMap people={people} stores={shown} spotsNear={area} className="h-80 lg:h-96" label={`Map of meetup spots near you and ${p.other.username}`} />
    </section>
  );
}

// One proposal, its action buttons and the full back-and-forth history.
export function TradeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/trades/${id}`);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner label="Loading proposal" />;
  if (error?.status === 404) return <PageMessage title="Proposal not found" body="It may not exist, or you're not one of its two players." />;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-10"><ErrorAlert error={error} onRetry={reload} /></div>;

  // The URL might point at an older version in the thread, so work out both the one being viewed and the newest.
  const trade = data.thread.find((t) => t.id === data.currentId);
  const latest = data.thread.at(-1);
  const p = perspective(trade, user.id);
  const canRespond = !p.iAmSender && trade.status === "pending";

  // Accept or decline, then reload so the status and buttons update.
  const act = async (action) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/trades/${trade.id}/${action}`, { method: "POST" });
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageHeader title={`Proposal with ${p.other.username}`} description={`${p.other.city} · ${p.iAmSender ? "You sent this" : "You received this"} ${fmtDate(trade.createdAt)}`}>
        <StatusBadge status={trade.status} />
      </PageHeader>

      {/* Viewing an old version: point to the current one. */}
      {latest.id !== trade.id && (
        <Alert className="mb-6">
          <Info aria-hidden="true" />
          <AlertDescription>
            <span>
              This is an earlier version. <Link className="font-medium text-primary underline" to={`/trades/${latest.id}`}>View the current proposal</Link>.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <ErrorAlert error={actionError} title="Action didn't go through" />
      <ProposalPanels trade={trade} viewerId={user.id} />

      {trade.meetupSpot && (
        <Card className="mt-4 gap-2 border-rare-ink/25 bg-rare/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm text-rare-ink">
              <MapPin className="size-4" aria-hidden="true" /> Suggested meetup spot (partner store)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold">{trade.meetupSpot.name}</p>
            <p className="text-sm text-muted-foreground">
              {trade.meetupSpot.address}, {trade.meetupSpot.city}
            </p>
            {trade.meetupSpot.website && (
              <a className="text-sm font-medium text-primary underline" href={trade.meetupSpot.website} target="_blank" rel="noopener noreferrer">
                Store website
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {trade.message && (
        <Card className="mt-4 gap-2">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Message from {trade.sender.username}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{trade.message}</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 rounded-xl border bg-card p-5">
        {/* Only the receiver of a pending version gets buttons. Decline asks for confirmation first. */}
        {canRespond && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => act("accept")} disabled={busy}>
              Accept offer
            </Button>
            <Button variant="outline" onClick={() => navigate(`/trades/${trade.id}/counter`)} disabled={busy}>
              Counter-offer
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-muted-foreground" disabled={busy}>
                  Decline
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Decline this proposal?</AlertDialogTitle>
                  <AlertDialogDescription>{p.other.username} will see it as declined. You can't undo this.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => act("decline")}>Decline</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        {p.iAmSender && trade.status === "pending" && <p>Waiting for {p.other.username} to accept, decline or counter.</p>}
        {trade.status === "accepted" && (
          <p className="flex items-start gap-3">
            <SuccessMark className="size-7" />
            <span>
              <strong>Offer accepted.</strong> Agree on a public place and time. Accepting means you've both agreed to meet; it
              doesn't mean the trade is complete, and no cards are held for you. After you meet, tell us below: the cards you
              gave come off your inventory and the cards you got are added (as private, until you share them).
            </span>
          </p>
        )}
        {trade.status === "accepted" && <TradeFeedback trade={trade} other={p.other} feedback={data.feedback} onSent={reload} />}
        {trade.status === "declined" && <p>This proposal was declined.</p>}
        {trade.status === "countered" && <p>This version was answered with a counter-offer.</p>}
        {canRespond && (
          <p className="mt-3 text-xs text-muted-foreground">
            Listed stock can change until you meet. Accepting rechecks that every card is still listed.
          </p>
        )}
      </div>

      {(trade.status === "pending" || trade.status === "accepted") && <MeetupMap trade={trade} viewerId={user.id} />}

      {/* Timeline of every version, when there has been at least one counter. */}
      {data.thread.length > 1 && (
        <section className="mt-8" aria-labelledby="history-heading">
          <h2 id="history-heading" className="mb-3 text-lg font-semibold">
            Negotiation history
          </h2>
          <ol className="grid gap-2">
            {data.thread.map((v, i) => (
              <li key={v.id}>
                <Link
                  to={`/trades/${v.id}`}
                  aria-current={v.id === trade.id ? "page" : undefined}
                  className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:bg-accent/40 aria-[current=page]:border-primary"
                >
                  <span className="font-medium">{i === 0 ? "Original request" : `Counter ${i}`}</span>
                  <span className="text-muted-foreground">by {v.sender.username}</span>
                  <StatusBadge status={v.status} />
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDate(v.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-8 flex justify-end">
        <ReportDialog user={p.other} />
      </div>
    </div>
  );
}

/** Loads both inventories and renders the composer; shared by new requests and counter-offers. */
function ComposerPage({ title, description, counterpart, initialRequested, initialOffered, initialMeetupStoreId, submit, counter }) {
  const { user } = useAuth();
  const theirs = useApi(counterpart ? `/users/${encodeURIComponent(counterpart.username)}` : null);
  const mine = useApi("/inventory");
  // Partner stores within 100 km of you, nearest first. Optional, so a failure here never blocks the trade.
  const stores = useApi(`/stores${qs({ city: user.city, radius: 100 })}`);
  const [sent, setSent] = useState(null);
  const navigate = useNavigate();

  // Their profile 404s if the player is suspended or gone.
  if (theirs.error?.status === 404) return <PageMessage title="Player not found" body="They may have left or been suspended." />;
  const error = theirs.error ?? mine.error;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title={title} description={description} />
      <ErrorAlert
        error={error}
        onRetry={() => {
          theirs.reload();
          mine.reload();
        }}
      />
      {(theirs.loading || mine.loading) && <Spinner label="Loading inventories" />}
      {theirs.data && mine.data && (
        <TradeComposer
          counterpart={theirs.data.user}
          theirItems={theirs.data.inventory}
          myItems={mine.data.items}
          initialRequested={initialRequested}
          initialOffered={initialOffered}
          stores={stores.data?.stores ?? []}
          initialMeetupStoreId={initialMeetupStoreId}
          submitLabel={counter ? "Send counter-offer" : "Tap to trade"}
          onSubmit={async (proposal) => setSent((await submit({ ...proposal, receiverId: theirs.data.user.id })).trade)}
        />
      )}
      {/* Shows once the proposal is sent; closing it moves on to the next sensible page. */}
      <TradeSentDialog trade={sent} counter={counter} onClose={() => navigate(counter ? "/trades" : "/search")} />
    </div>
  );
}

// "12,15" -> { 12: 1, 15: 1 }: listings to pre-pick, one of each.
const pickIds = (value) => Object.fromEntries((value ?? "").split(",").filter((id) => /^\d+$/.test(id)).map((id) => [id, 1]));

// New trade page. Search results link here with ?to=username and optionally &item=listingId to pre-pick a card;
// want-list matches pass several (&item=1,2) and the viewer's own cards they want (&offer=3,4).
export function NewTrade() {
  const [params] = useSearchParams();
  const to = params.get("to");
  if (!to) return <PageMessage title="Choose a listing first" body="Start a trade from a search result or a player's profile." />;
  return (
    <ComposerPage
      title={`Trade with ${to}`}
      description="Build a proposal with one player at a time. Choose what you'd like, and optionally what you'll give."
      counterpart={{ username: to }}
      initialRequested={pickIds(params.get("item"))}
      initialOffered={pickIds(params.get("offer"))}
      submit={(proposal) => api("/trades", { method: "POST", body: proposal })}
    />
  );
}

// Counter-offer page. Only the receiver of a pending version can use it.
export function CounterTrade() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading } = useApi(`/trades/${id}`);
  if (loading) return <Spinner label="Loading proposal" />;
  if (error) return <PageMessage title="Proposal not found" body={error.message} />;
  const trade = data.thread.find((t) => t.id === data.currentId);
  if (trade.receiver.id !== user.id || trade.status !== "pending") {
    return <PageMessage title="Can't counter this proposal" body="Only the player who received a pending proposal can counter it." />;
  }
  // Start from the current terms, flipped: what they offered becomes what you request, and vice versa.
  const pick = (lines) => Object.fromEntries(lines.filter((l) => l.inventoryItemId).map((l) => [l.inventoryItemId, l.quantity]));
  return (
    <ComposerPage
      counter
      title={`Counter ${trade.sender.username}'s proposal`}
      description="Adjust the cards and quantities. Sending this marks their version as countered."
      counterpart={trade.sender}
      initialRequested={pick(trade.offered)}
      initialOffered={pick(trade.requested)}
      initialMeetupStoreId={trade.meetupSpot?.id ?? ""}
      submit={(proposal) => api(`/trades/${trade.id}/counter`, { method: "POST", body: proposal })}
    />
  );
}
