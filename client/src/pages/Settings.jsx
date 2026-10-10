import { useState } from "react";
import { useNavigate } from "react-router";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DisplaySettings } from "@/components/DisplayMenu";
import { ErrorAlert, Field, PageHeader, SuccessMessage } from "@/components/common";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useForm } from "@/lib/useForm";
import { CitySelect, PasswordChecklist } from "@/components/AccountFields";
import { parseTravelKm, passwordProblems, usernameMessage } from "@shared/validation";
import { CITIES, RADII } from "@shared/cities";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** One settings card with its own form state, error and success message. */
function Section({ title, description, initial, submitLabel, onSubmit, children, destructive }) {
  // The section title prefixes the input ids, so they stay unique on a page with several forms.
  const { values, setErrors, error, busy, bind, run } = useForm(initial, title);
  const [done, setDone] = useState(null);
  // e is optional because the delete button calls submit() directly from its confirm dialog.
  // onSubmit returns the success message to show.
  const submit = (e) => {
    e?.preventDefault();
    setDone(null);
    return run(async () => {
      setDone(await onSubmit(values, setErrors));
      setErrors({});
    });
  };
  return (
    <Card className={destructive ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid max-w-md gap-4">
          <ErrorAlert error={error} title="Not saved" />
          {/* Each section decides its own inputs; we just hand it the form helpers. */}
          {children({ bind, values, submit, busy })}
          {done && <SuccessMessage>{done}</SuccessMessage>}
          {submitLabel && (
            <Button type="submit" disabled={busy} className="justify-self-start">
              {busy ? "Saving…" : submitLabel}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Trade emails on or off. Saves as soon as the switch flips. */
function EmailNotifications() {
  const { user, setUser } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = async (emailTrades) => {
    setBusy(true);
    setError(null);
    try {
      setUser((await api("/account/notifications", { method: "PATCH", body: { emailTrades } })).user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email notifications</CardTitle>
        <CardDescription>Account emails, like password resets, always arrive.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-md gap-3">
        <ErrorAlert error={error} title="Not saved" />
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="email-trades" className="grid gap-1 font-normal">
            <span className="font-medium">Trade updates</span>
            <span className="text-sm text-muted-foreground">An email when someone sends you a trade request or counter-offer, or accepts yours.</span>
          </Label>
          <Switch id="email-trades" checked={user.emailTrades} onCheckedChange={change} disabled={busy} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Private account settings (4.1.7, 4.2.2–4.2.4). Email and role live here, never on the public profile. */
export default function Settings() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  // Show client-side errors and stop, the same way a 400 from the server would.
  const localCheck = (setFields, errors) => {
    setFields(errors);
    if (Object.keys(errors).length) throw Object.assign(new Error("Please fix the highlighted fields."), { fields: errors });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader title="Account settings" description={`Signed in as ${user.email}. Role: ${user.role}.`} />
      <div className="grid gap-6">
        {/* Username: no password needed. Checked locally first with the same rule as sign-up. */}
        <Section
          title="Username"
          description="Your public name on listings, trades and your profile link."
          initial={{ username: user.username }}
          submitLabel="Change username"
          onSubmit={async (v, setFields) => {
            const problem = usernameMessage(v.username.trim());
            localCheck(setFields, problem ? { username: problem } : {});
            setUser((await api("/account/username", { method: "PATCH", body: { username: v.username.trim() } })).user);
            return "Username updated.";
          }}
        >
          {({ bind }) => <Field label="Username" autoComplete="username" {...bind("username")} />}
        </Section>

        {/* City: no password needed. */}
        <Section
          title="City"
          description={
            CITIES.includes(user.city)
              ? "Shown on your public profile and used to filter nearby searches."
              : `"${user.city}" is from the old Ontario-only list. Choose your city again so nearby searches find you.`
          }
          initial={{ city: user.city }}
          submitLabel="Save city"
          onSubmit={async (v) => {
            setUser((await api("/account/city", { method: "PATCH", body: v })).user);
            return "City updated.";
          }}
        >
          {({ bind }) => <CitySelect {...bind("city")} />}
        </Section>

        {/* Meetup range: how far you'll travel. Also the default radius when you search. */}
        <Section
          title="Meetup range"
          description="How far you're happy to travel to trade. Shown on your profile and used as your default search distance."
          initial={{ travelKm: user.travelKm == null ? "" : String(user.travelKm) }}
          submitLabel="Save range"
          onSubmit={async (v, setFields) => {
            const [, problem] = parseTravelKm(v.travelKm);
            localCheck(setFields, problem ? { travelKm: problem } : {});
            setUser((await api("/account/travel", { method: "PATCH", body: { travelKm: v.travelKm === "" ? null : Number(v.travelKm) } })).user);
            return "Meetup range saved.";
          }}
        >
          {({ bind }) => {
            const b = bind("travelKm");
            return (
              <Field id={b.id} label="I'll travel up to" error={b.error}>
                <NativeSelect id={b.id} value={b.value} onChange={b.onChange} className="w-full">
                  <NativeSelectOption value="">Not set</NativeSelectOption>
                  {RADII.map((km) => (
                    <NativeSelectOption key={km} value={String(km)}>
                      {km} km
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            );
          }}
        </Section>

        {/* Email: needs the current password. A new address gets a confirmation link. */}
        <Section
          title="Email"
          description={
            user.emailVerified ? "Private. Used for sign-in help and the emails you choose below." : "Private. Not confirmed yet: use the link we emailed you, or send a new one from the banner above."
          }
          initial={{ email: user.email, currentPassword: "" }}
          submitLabel="Change email"
          onSubmit={async (v) => {
            const { user: updated } = await api("/account/email", { method: "PATCH", body: v });
            setUser(updated);
            return updated.emailVerified ? "Email updated." : `Email updated. We sent a confirmation link to ${updated.email}.`;
          }}
        >
          {({ bind }) => (
            <>
              <Field label="New email" type="email" autoComplete="email" {...bind("email")} />
              <Field label="Current password" type="password" autoComplete="current-password" {...bind("currentPassword")} />
            </>
          )}
        </Section>

        <EmailNotifications />

        <DisplaySettings />

        {/* Password: checked locally first, then the server signs out other devices. */}
        {/* Accounts created with Google have no password until they set one here. */}
        <Section
          title="Password"
          description={
            user.emailLogin
              ? "Changing it signs you out on your other devices."
              : "You sign in with Google. Add a password to also log in with your email, change your email or delete your account."
          }
          initial={{ currentPassword: "", newPassword: "", confirm: "" }}
          submitLabel={user.emailLogin ? "Change password" : "Set password"}
          onSubmit={async (v, setFields) => {
            localCheck(setFields, {
              ...(passwordProblems(v.newPassword).length && { newPassword: "Choose a password that meets every rule." }),
              ...(v.newPassword !== v.confirm && { confirm: "Passwords don't match." }),
            });
            await api("/account/password", { method: "PATCH", body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
            if (!user.emailLogin) setUser((await api("/auth/me")).user);
            return user.emailLogin ? "Password changed." : "Password set.";
          }}
        >
          {({ bind, values }) => (
            <>
              {user.emailLogin && <Field label="Current password" type="password" autoComplete="current-password" {...bind("currentPassword")} />}
              <Field label="New password" type="password" autoComplete="new-password" {...bind("newPassword")} />
              <PasswordChecklist password={values.newPassword} />
              <Field label="Confirm new password" type="password" autoComplete="new-password" {...bind("confirm")} />
            </>
          )}
        </Section>

        {/* Delete: no normal submit button. The red button opens a confirm dialog, which calls submit(). */}
        <Section
          destructive
          title="Delete account"
          description="Your listings, sessions and reset links are deleted and your pending proposals are declined. Past proposals keep a snapshot of their cards with your name replaced, and moderation records are kept for accountability."
          initial={{ password: "" }}
          onSubmit={async (v) => {
            await api("/account", { method: "DELETE", body: v });
            setUser(null);
            navigate("/", { replace: true });
            return null;
          }}
        >
          {({ bind, values, submit, busy }) => (
            <>
              <Field label="Confirm with your password" type="password" autoComplete="current-password" {...bind("password")} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={!values.password || busy} className="justify-self-start">
                    Delete my account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
                    <AlertDialogDescription>This can't be undone. You'll be signed out everywhere.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => submit()}>Delete account</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
