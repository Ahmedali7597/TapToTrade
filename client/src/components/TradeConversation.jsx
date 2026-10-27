import { useEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarPlus, Clock, MapPin, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, Field, SuccessMark, useApi } from "@/components/common";
import { api, qs } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { timeZoneFor } from "@shared/events";
import { formatMeetup, TIME_ZONES } from "@shared/meetups";

// The two players' side of a trade: planning the meetup (once accepted) and messages (while it's open).
// Milestone 4 section 9.2: a public place, a time with its time zone, and the other player's confirmation; any
// change needs confirming again. Messages aren't live chat: the list checks for new ones every 30 seconds.

const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad = (n) => String(n).padStart(2, "0");
// "2026-10-21T18:05" for now, as the browser's clock reads it: the earliest a datetime-local picker should offer.
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Where and when to meet: the current plan, a confirm button for the other player, and the form to suggest one. */
export function MeetupPlanner({ tradeId, threadId, initial, other }) {
  const { user } = useAuth();
  const [meetup, setMeetup] = useState(initial ?? null);
  const [editing, setEditing] = useState(!initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setMeetup((await api(`/trades/${tradeId}/meetup/confirm`, { method: "POST" })).meetup);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // The other player suggesting, changing or confirming the meetup shows up straight away.
  useLive({
    meetup: (e) => e.threadId === threadId && setMeetup(e.meetup),
    reconnect: () => api(`/trades/${tradeId}`).then((d) => setMeetup(d.meetup), () => {}),
  });

  const mine = meetup?.proposedBy.id === user.id;
  // Also show the time on the viewer's own clock if they're in a different zone (players can be in different provinces).
  const here = viewerZone();
  const local = meetup && here !== meetup.timeZone ? formatMeetup(meetup.meetAt, here) : null;
  return (
    <section className="mt-8" aria-labelledby="plan-heading">
      <h2 id="plan-heading" className="flex items-center gap-1.5 text-lg font-bold">
        <CalendarCheck className="size-5 text-primary" aria-hidden="true" /> Meetup
      </h2>
      <ErrorAlert error={error} title="That didn't go through" />
      {meetup && (
        <Card className={cn("mt-3 gap-3", meetup.confirmedAt && "border-primary/40")}>
          <CardContent className="grid gap-3">
            <p className="flex items-start gap-2 font-semibold">
              <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {meetup.when}
                {local && <span className="block text-sm font-normal text-muted-foreground">Your time: {local}</span>}
              </span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {meetup.place}
            </p>
            {meetup.confirmedAt ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <SuccessMark className="size-5" /> Confirmed by both of you.
                </p>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`/api/trades/${tradeId}/meetup.ics`} download>
                    <CalendarPlus aria-hidden="true" /> Add to calendar
                  </a>
                </Button>
              </div>
            ) : mine ? (
              <p className="text-sm text-muted-foreground">Waiting for {other.username} to confirm. You'll get an email when they do.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={confirm} disabled={busy}>
                  Confirm this meetup
                </Button>
                <span className="text-sm text-muted-foreground">Suggested by {meetup.proposedBy.username}.</span>
              </div>
            )}
            {!editing && (
              <Button variant="ghost" size="sm" className="w-fit px-0 text-primary" onClick={() => setEditing(true)}>
                Suggest a different time or place
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {editing && (
        <MeetupForm
          tradeId={tradeId}
          current={meetup}
          defaultZone={meetup?.timeZone ?? timeZoneFor(user.city)}
          city={user.city}
          onCancel={meetup ? () => setEditing(false) : null}
          onSaved={(m) => {
            setMeetup(m);
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function MeetupForm({ tradeId, current, defaultZone, city, onCancel, onSaved }) {
  // Partner stores within 100 km come first; "somewhere else" lets the players type any public place.
  const stores = useApi(`/stores${qs({ city, radius: 100 })}`).data?.stores ?? [];
  const [localTime, setLocalTime] = useState("");
  const [timeZone, setTimeZone] = useState(defaultZone);
  const [where, setWhere] = useState(current?.store ? String(current.store.id) : "other");
  const [place, setPlace] = useState(current && !current.store ? current.place : "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const zones = TIME_ZONES.some(([z]) => z === timeZone) ? TIME_ZONES : [[timeZone, timeZone.replace(/^America\//, "").replace(/_/g, " ")], ...TIME_ZONES];

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { localTime, timeZone, ...(where === "other" ? { place } : { storeId: Number(where) }) };
      onSaved((await api(`/trades/${tradeId}/meetup`, { method: "PUT", body })).meetup);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const fields = error?.fields ?? {};
  return (
    <Card className="mt-3 gap-3">
      <CardHeader>
        <CardTitle className="text-base">{current ? "Suggest a change" : "Suggest when and where to meet"}</CardTitle>
        <p className="text-sm text-muted-foreground">Pick a public place, like a partner game store. The other player confirms it.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <ErrorAlert error={error && !Object.keys(fields).length ? error : null} title="The meetup wasn't saved" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="meet-time" label="Date and time" type="datetime-local" min={nowLocal()} value={localTime} onChange={(e) => setLocalTime(e.target.value)} error={fields.localTime} />
            <Field id="meet-zone" label="Time zone" error={fields.timeZone}>
              <NativeSelect id="meet-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="w-full">
                {zones.map(([zone, label]) => (
                  <NativeSelectOption key={zone} value={zone}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="meet-where" label="Place" error={where === "other" ? undefined : fields.place}>
            <NativeSelect id="meet-where" value={where} onChange={(e) => setWhere(e.target.value)} className="w-full">
              {stores.map((s) => (
                <NativeSelectOption key={s.id} value={String(s.id)}>
                  {s.name} · {s.city}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="other">Somewhere else (type it below)</NativeSelectOption>
            </NativeSelect>
          </Field>
          {where === "other" && (
            <Field
              id="meet-place"
              label="Public place"
              placeholder="e.g. Halifax Central Library, main entrance"
              maxLength={200}
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              error={fields.place}
            />
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : current ? "Suggest this change" : "Suggest this meetup"}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Messages between the two players. New ones show up within 30 seconds while the page is open. */
export function TradeMessages({ tradeId, threadId, initial, canMessage, other }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState(initial ?? []);
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = useRef(null);

  // New messages arrive the moment they're sent (a live connection, lib/live.js); a message already shown,
  // like your own coming back over the connection, isn't added twice.
  const addMessage = (m) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
  const refresh = () => api(`/trades/${tradeId}`).then((d) => setMessages(d.messages), () => {});
  const live = useLive({ message: (m) => m.threadId === threadId && addMessage(m), reconnect: refresh }, canMessage);
  // Browsers without live updates check every 30 seconds instead, while the tab is visible.
  useEffect(() => {
    if (!canMessage || live) return;
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 30_000);
    return () => clearInterval(timer);
    // refresh only uses tradeId, which is a dependency.
  }, [tradeId, canMessage, live]);
  // Keep the newest message in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sent = body;
      const { message } = await api(`/trades/${tradeId}/messages`, { method: "POST", body: { body: sent } });
      addMessage(message);
      // Clear the box only if it still holds what was sent, so a next message typed meanwhile isn't wiped.
      setBody((current) => (current === sent ? "" : current));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (!canMessage && !messages.length) return null;
  return (
    <section className="mt-8" aria-labelledby="messages-heading">
      <h2 id="messages-heading" className="text-lg font-bold">
        Messages
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Only you and {other.username} can see these. Keep it about the trade; never share passwords or payment details.
      </p>
      <Card className="gap-0 py-0">
        {messages.length > 0 ? (
          <ol ref={list} role="log" aria-label={`Messages with ${other.username}`} className="grid max-h-96 gap-3 overflow-y-auto p-4">
            {messages.map((m) => {
              const mine = m.sender.id === user.id;
              return (
                <li key={m.id} className={cn("grid max-w-[85%] gap-1", mine ? "justify-self-end text-right" : "justify-self-start")}>
                  <span className="text-xs text-muted-foreground">
                    {mine ? "You" : m.sender.username} · {new Date(m.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  <p className={cn("whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>{m.body}</p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No messages yet. Say hi and agree on the details.</p>
        )}
        {canMessage ? (
          <form onSubmit={send} className="grid gap-2 border-t p-4" noValidate>
            <Label htmlFor="trade-reply">Write a message</Label>
            <Textarea
              id="trade-reply"
              rows={2}
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={Boolean(error?.fields?.body)}
              aria-describedby={error ? "trade-reply-error" : undefined}
              placeholder={`e.g. Does Saturday afternoon work for you?`}
            />
            {error && (
              <p id="trade-reply-error" className="text-sm font-medium text-destructive">
                {error.fields?.body ?? error.message}
              </p>
            )}
            <Button type="submit" size="sm" className="w-fit gap-1.5" disabled={busy || !body.trim()}>
              <Send aria-hidden="true" /> {busy ? "Sending…" : "Send"}
            </Button>
          </form>
        ) : (
          <p className="border-t p-4 text-sm text-muted-foreground">This trade is closed, so it can't get new messages.</p>
        )}
      </Card>
    </section>
  );
}
