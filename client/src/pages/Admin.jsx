import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, ErrorAlert, Field, PageHeader, Spinner, SuccessMessage, useApi } from "@/components/common";
import EmailEditor from "@/components/EmailEditor";
import { Switch } from "@/components/ui/switch";
import { STORE_TAGS } from "@shared/stores";
import { CitySelect } from "@/components/AccountFields";
import { api, qs } from "@/lib/api";

// Admin page (4.7 and the admin-only tools): role management, partner stores and the site's email text.
// Moderators use pages/Moderation.jsx; this page is for administrators only (App.jsx checks the role).

// One row in the admin table. Admin accounts show a badge instead of a dropdown since they can't be changed here.
function RoleRow({ u, onSaved }) {
  const [role, setRole] = useState(u.role);
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    try {
      onSaved(await api(`/admin/users/${u.id}/role`, { method: "PATCH", body: { role } }));
    } catch (err) {
      setError(err);
    }
  };
  return (
    <tr className="border-t align-middle">
      <td className="py-3 pr-4 font-medium">{u.username}</td>
      <td className="py-3 pr-4 text-muted-foreground">{u.email}</td>
      <td className="py-3 pr-4">{u.city}</td>
      <td className="py-3 pr-4">
        <Badge variant={u.status === "active" ? "secondary" : "destructive"}>{u.status}</Badge>
      </td>
      <td className="py-3 pr-4">
        {u.role === "admin" ? (
          <Badge>admin</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <NativeSelect aria-label={`Role for ${u.username}`} value={role} onChange={(e) => setRole(e.target.value)} size="sm" className="min-w-32">
              <NativeSelectOption value="user">user</NativeSelectOption>
              <NativeSelectOption value="moderator">moderator</NativeSelectOption>
            </NativeSelect>
            <Button size="sm" onClick={save} disabled={role === u.role}>
              Save
            </Button>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error.message}</p>}
      </td>
    </tr>
  );
}

/** 4.7: administrators promote players to moderator or revoke it. */
export function AdminPage() {
  // q is what's typed; query is what was last searched, so we only fetch on submit and not on every keystroke.
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useApi(`/admin/users${qs({ q: query })}`);
  const [notice, setNotice] = useState(null);
  // After a role change: say whether the new moderator was emailed (only confirmed addresses are).
  const saved = ({ user, emailed }) => {
    const promoted = user.role === "moderator";
    setNotice(
      promoted
        ? emailed
          ? `${user.username} is now a moderator. We emailed them to say so.`
          : `${user.username} is now a moderator. They haven't confirmed their email address, so no email was sent.`
        : `${user.username} is no longer a moderator.`,
    );
    reload();
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title="Admin" description="Promote trusted players to moderator, manage partner stores and add your own words to the site's emails. Changes are logged." />
      <form
        role="search"
        className="mb-6 flex max-w-md items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="user-q">Find a player</Label>
          <Input id="user-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Username or email" />
        </div>
        <Button type="submit">Search</Button>
      </form>
      <ErrorAlert error={error} onRetry={reload} />
      {notice && <SuccessMessage className="mb-4">{notice}</SuccessMessage>}
      {loading && <Spinner label="Loading players" />}
      {data && (
        <div className="relative overflow-x-auto rounded-xl border bg-card px-4">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-3 pr-4 font-medium">Username</th>
                <th className="py-3 pr-4 font-medium">Email</th>
                <th className="py-3 pr-4 font-medium">City</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                // Role in the key resets the row's dropdown after a save.
                <RoleRow key={`${u.id}-${u.role}`} u={u} onSaved={saved} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StoresAdmin />
      <EmailEditor />
    </div>
  );
}

const EMPTY_STORE = { name: "", address: "", city: "", lat: "", lng: "", website: "", notes: "", hours: "", perk: "", accountUsername: "" };

/** Add or edit a partner store. `store` is null for a new one. Mounted only while open, so each opening starts fresh. */
function StoreDialog({ store, onClose, onSaved }) {
  const [values, setValues] = useState(() =>
    store
      ? { ...Object.fromEntries(Object.keys(EMPTY_STORE).map((k) => [k, store[k] == null ? "" : String(store[k])])), accountUsername: store.account ?? "" }
      : EMPTY_STORE,
  );
  const [tags, setTags] = useState(() => store?.tags ?? []);
  const [featured, setFeatured] = useState(() => store?.featured ?? false);
  const toggleTag = (t) => setTags((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const bind = (name) => ({ id: `store-${name}`, value: values[name], error: fields[name], onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })) });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(store ? `/stores/${store.id}` : "/stores", { method: store ? "PATCH" : "POST", body: { ...values, tags, featured } });
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
            <DialogTitle>{store ? `Edit ${store.name}` : "Add a partner store"}</DialogTitle>
            <DialogDescription>Stores are public businesses, so their address and map position are shown to every player.</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} title="Not saved" />
          <Field label="Store name" {...bind("name")} />
          <Field label="Street address" {...bind("address")} />
          <CitySelect {...bind("city")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude (optional)" inputMode="decimal" {...bind("lat")} />
            <Field label="Longitude (optional)" inputMode="decimal" {...bind("lng")} />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Copy them from a map app. Leave both blank to place the store at its city's centre.</p>
          <Field label="Website (optional)" type="url" placeholder="https://" {...bind("website")} />
          <Field label="About the store (optional)" placeholder="e.g. Hamilton's friendliest card shop, with 40 seats of play space." {...bind("notes")} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What it offers</legend>
            <div className="flex flex-wrap gap-2">
              {STORE_TAGS.map((t) => (
                <Button key={t.value} type="button" size="sm" variant={tags.includes(t.value) ? "default" : "outline"} aria-pressed={tags.includes(t.value)} onClick={() => toggleTag(t.value)}>
                  {t.label}
                </Button>
              ))}
            </div>
            {fields.tags && <p className="text-xs font-medium text-destructive">{fields.tags}</p>}
          </fieldset>
          <Field label="Hours and events (optional)" placeholder="e.g. Trade night Fridays 6-10 pm, Commander Sundays" {...bind("hours")} />
          <Field label="Member perk (optional)" placeholder="e.g. 10% off singles for Tap to Trade players" {...bind("perk")} />
          <Field label="Store's player account (optional)" placeholder="Username" hint="Gives that account an official store badge and links the store page to its binder." {...bind("accountUsername")} />
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="store-featured" className="grid gap-0.5 font-normal">
              <span className="font-medium">Featured partner</span>
              <span className="text-xs text-muted-foreground">Shown on the home page and first in the store list.</span>
            </Label>
            <Switch id="store-featured" checked={featured} onCheckedChange={setFeatured} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save store"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Partner game stores: official meetup spots shown on the map and offered in trade proposals. */
function StoresAdmin() {
  const { data, error, loading, reload } = useApi("/stores/all");
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [toggleError, setToggleError] = useState(null);
  const setActive = async (s, active) => {
    setToggleError(null);
    try {
      await api(`/stores/${s.id}`, { method: "PATCH", body: { active } });
      reload();
    } catch (err) {
      setToggleError(err);
    }
  };
  return (
    <section className="mt-12" aria-labelledby="stores-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="stores-heading" className="text-xl font-semibold">
            Partner game stores
          </h2>
          <p className="text-sm text-muted-foreground">Official meetup spots. They appear on the map and in trade proposals. Retire a store instead of deleting it.</p>
        </div>
        <Button onClick={() => setEditing(null)}>Add store</Button>
      </div>
      <ErrorAlert error={error ?? toggleError} onRetry={reload} />
      {loading && <Spinner label="Loading stores" />}
      {data && data.stores.length === 0 && <EmptyState title="No partner stores yet" body="Add the first game store that agreed to host trades." />}
      {data && data.stores.length > 0 && (
        <div className="relative overflow-x-auto rounded-xl border bg-card px-4">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-3 pr-4 font-medium">Store</th>
                <th className="py-3 pr-4 font-medium">City</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.stores.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-3 pr-4">
                    <Link to={s.path} className="font-medium underline-offset-4 hover:underline">
                      {s.name}
                    </Link>
                    {s.featured && <Badge className="ml-2">Featured</Badge>}
                    <span className="block text-xs text-muted-foreground">
                      {s.address}
                      {s.account ? ` · account: ${s.account}` : ""}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{s.city}</td>
                  <td className="py-3 pr-4">
                    <Badge variant={s.active ? "default" : "secondary"}>{s.active ? "Active" : "Retired"}</Badge>
                  </td>
                  <td className="flex gap-2 py-3 pr-4">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setActive(s, !s.active)}>
                      {s.active ? "Retire" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && <StoreDialog store={editing} onClose={() => setEditing(undefined)} onSaved={reload} />}
    </section>
  );
}
