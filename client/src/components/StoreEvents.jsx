import { useState } from "react";
import { CalendarDays, CalendarPlus, ChevronDown, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, Field } from "@/components/common";
import { api } from "@/lib/api";
import { EVENT_KINDS, eventDay, eventKindLabel, eventTimes } from "@shared/events";

// Calendar file links. The feed is a subscription (calendar apps check back for changes); the single event is a download.
const feedPath = (storeId) => `/api/stores/${storeId}/events.ics`;
const eventPath = (event) => `/api/stores/${event.storeId}/events/${event.id}.ics`;

/** "Fri, Oct 9 · 6:00–10:00 p.m." in the store's own time zone. */
const eventWhen = (event) => `${eventDay(event)} · ${eventTimes(event)}`;

/** The month and day as a small calendar page, beside each event. */
function DateTile({ event }) {
  const part = (options) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: event.timeZone }).format(new Date(event.startsAt));
  return (
    <div className="pocket flex w-14 shrink-0 flex-col items-center rounded-lg py-1.5 tabular-nums" aria-hidden="true">
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">{part({ month: "short" })}</span>
      <span className="font-display text-2xl leading-none font-bold">{part({ day: "numeric" })}</span>
    </div>
  );
}

/** Subscribe to every event at the store, in whichever calendar the player uses. */
function SubscribeMenu({ storeId }) {
  const https = `${window.location.origin}${feedPath(storeId)}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarPlus aria-hidden="true" /> Subscribe <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer">
            Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={webcal}>Apple or Outlook calendar</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={feedPath(storeId)} download>
            Download .ics file
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One event: when, what, the fee and details, and links to sign up or add it to a calendar. */
function EventRow({ event, canManage, onEdit, onRemoved }) {
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await api(`/stores/${event.storeId}/events/${event.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <li className="slide-in flex gap-4 border-t py-4 first:border-t-0">
      <DateTile event={event} />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={event.cancelled ? "font-semibold text-muted-foreground line-through" : "font-semibold"}>{event.title}</h3>
          {/* The kind is left out when the title already says it ("Commander night"). */}
          {!event.title.toLowerCase().includes(eventKindLabel(event.kind).toLowerCase()) && <Badge variant="secondary">{eventKindLabel(event.kind)}</Badge>}
          {event.cancelled && <Badge variant="destructive">Cancelled</Badge>}
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {eventWhen(event)}
          {event.cost && ` · ${event.cost}`}
        </p>
        {event.details && <p className="text-sm whitespace-pre-line">{event.details}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {event.link && !event.cancelled && (
            <a href={event.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" /> Details and sign-up
            </a>
          )}
          {!event.cancelled && (
            <a href={eventPath(event)} download className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              <CalendarPlus className="size-3.5" aria-hidden="true" /> Add to calendar
            </a>
          )}
        </div>
        <ErrorAlert error={error} title="Not removed" />
      </div>
      {canManage && (
        <div className="flex shrink-0 items-start gap-1">
          <Button size="icon" variant="ghost" onClick={() => onEdit(event)} aria-label={`Edit ${event.title} on ${eventDay(event)}`}>
            <Pencil aria-hidden="true" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={`Remove ${event.title} on ${eventDay(event)}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {event.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It disappears from the store page and from subscribed calendars. If the event was called off, edit it and mark it cancelled instead, so
                  players see the change.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </li>
  );
}

const EMPTY = { title: "", kind: "trade_night", date: "", startTime: "18:00", endTime: "", cost: "", details: "", link: "", repeatWeeks: "1" };

/**
 * Post or edit an event. `event` is null for a new one. Times are the store's local time. A new event can
 * repeat weekly; each week becomes its own event so one night can be changed or cancelled alone.
 */
function EventDialog({ store, event, onClose, onSaved }) {
  const [values, setValues] = useState(() => (event ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, event[k] ?? EMPTY[k]])) } : EMPTY));
  const [cancelled, setCancelled] = useState(event?.cancelled ?? false);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({ id: `event-${name}`, value: values[name], error: fields[name], onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })) });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { repeatWeeks, ...rest } = values;
      await api(event ? `/stores/${store.id}/events/${event.id}` : `/stores/${store.id}/events`, {
        method: event ? "PATCH" : "POST",
        body: event ? { ...rest, cancelled } : { ...rest, repeatWeeks: Number(repeatWeeks) },
      });
      onSaved();
      onClose();
    } catch (err) {
      setFields(err.fields ?? {});
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={save} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{event ? `Edit ${event.title}` : `Add an event at ${store.name}`}</DialogTitle>
            <DialogDescription>Events are public. Times are local to {store.city}.</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} title="Not saved" />
          <Field label="Title" placeholder="e.g. Friday trade night" {...bind("title")} />
          <Field id="event-kind" label="Kind of event" error={fields.kind}>
            <NativeSelect id="event-kind" value={values.kind} onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value }))} className="w-full">
              {EVENT_KINDS.map((k) => (
                <NativeSelectOption key={k.value} value={k.value}>
                  {k.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Date" type="date" {...bind("date")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" type="time" {...bind("startTime")} />
            <Field label="Ends (optional)" type="time" {...bind("endTime")} />
          </div>
          {!event && (
            <Field id="event-repeatWeeks" label="Repeat" error={fields.repeatWeeks}>
              <NativeSelect id="event-repeatWeeks" value={values.repeatWeeks} onChange={(e) => setValues((v) => ({ ...v, repeatWeeks: e.target.value }))} className="w-full">
                <NativeSelectOption value="1">Doesn't repeat</NativeSelectOption>
                {[4, 8, 12].map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    Every week for {n} weeks
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Entry fee (optional)" placeholder="e.g. Free, or $10" {...bind("cost")} />
          <Field id="event-details" label="Details (optional)" error={fields.details}>
            <Textarea
              id="event-details"
              value={values.details}
              onChange={(e) => setValues((v) => ({ ...v, details: e.target.value }))}
              placeholder="Format, what to bring, prizes"
              maxLength={500}
              aria-invalid={!!fields.details}
            />
          </Field>
          <Field label="Sign-up link (optional)" type="url" placeholder="https://" {...bind("link")} />
          {event && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="event-cancelled" className="grid gap-0.5 font-normal">
                <span className="font-medium">Cancelled</span>
                <span className="text-xs text-muted-foreground">Stays listed as cancelled, so players and their calendars hear about it.</span>
              </Label>
              <Switch id="event-cancelled" checked={cancelled} onCheckedChange={setCancelled} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : event ? "Save event" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A store page's upcoming events, with calendar links. Admins and the store's own account (`canManage`) also
 * get Add, Edit and Remove. `onChange` reloads the page's data after a change.
 */
export function StoreEvents({ store, events, canManage, onChange }) {
  // undefined = closed, null = a new event, an event = editing it.
  const [editing, setEditing] = useState(undefined);
  if (!events.length && !canManage) return null;
  return (
    <section aria-labelledby="events-heading" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="events-heading" className="flex items-center gap-2 font-semibold">
          <CalendarDays className="size-5 text-primary" aria-hidden="true" /> Upcoming events
        </h2>
        <div className="flex flex-wrap gap-2">
          {events.length > 0 && <SubscribeMenu storeId={store.id} />}
          {canManage && (
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus aria-hidden="true" /> Add event
            </Button>
          )}
        </div>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming events yet. Add trade nights, Commander nights and prereleases so players know when to come by.</p>
      ) : (
        <ul aria-label={`Upcoming events at ${store.name}`}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} canManage={canManage} onEdit={setEditing} onRemoved={onChange} />
          ))}
        </ul>
      )}
      {editing !== undefined && <EventDialog store={store} event={editing} onClose={() => setEditing(undefined)} onSaved={onChange} />}
    </section>
  );
}

/** The next event or two at a store, for the directory. */
export function NextEvents({ events }) {
  if (!events?.length) return null;
  return (
    <ul className="grid gap-1 text-sm" aria-label="Next events">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-medium">{e.title}</span> <span className="text-muted-foreground tabular-nums">· {eventWhen(e)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
