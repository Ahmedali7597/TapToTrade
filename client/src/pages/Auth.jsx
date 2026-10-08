import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/ui/blur-fade";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CardImage, ErrorAlert, Field, Spinner, SuccessMark, SuccessMessage, useApi } from "@/components/common";
import { api } from "@/lib/api";
import { CitySelect, PasswordChecklist, ResendLink } from "@/components/AccountFields";
import { useAuth } from "@/lib/auth";
import { useForm } from "@/lib/useForm";
import { useShowcase } from "@/lib/showcase";
import { cityMessage, emailMessage, passwordProblems, safeNext, usernameMessage, validateRegistration } from "@shared/validation";


// Three random cards fanned like a hand you're about to trade, shown beside the form on wide screens.
// A card whose image won't load is swapped for another one, so the hand never shows a broken picture.
// Tap a card to read it, like anywhere else on the site.
function FannedHand() {
  const { cards, swap } = useShowcase(3);
  const ids = cards?.map((c) => c.id);
  return (
    <div className="relative hidden h-[26rem] lg:block" role="group" aria-label="Three random cards">
      {[0, 1, 2].map((i) => (
        <div
          key={cards?.[i]?.imageUrl ?? i}
          className="fan-in absolute top-6 left-1/2 w-52"
          style={{ "--fan": `translateX(-50%) translateX(${(i - 1) * 88}px) translateY(${Math.abs(i - 1) * 18}px) rotate(${(i - 1) * 9}deg)`, "--i": i }}
        >
          {cards ? (
            <CardImage name={cards[i].name} setCode={cards[i].setCode} imageUrl={cards[i].imageUrl} printingId={cards[i].id} siblings={ids} onGiveUp={() => swap(i)} className="w-full" />
          ) : (
            <div className="sleeve aspect-[488/680] w-full bg-muted" />
          )}
        </div>
      ))}
    </div>
  );
}

// Shared card for all the sign-in style pages: the form in a binder pocket, a fanned hand beside it.
function AuthCard({ title, description, children, footer }) {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[minmax(0,28rem)_1fr]">
      <BlurFade>
        <Card className="relative overflow-hidden">
          <CardHeader>
            <CardTitle className="text-3xl">{title}</CardTitle>
            {description && <CardDescription className="text-base">{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer && <CardFooter className="flex-col items-start gap-1 text-sm text-muted-foreground">{footer}</CardFooter>}
        </Card>
      </BlurFade>
      <FannedHand />
    </div>
  );
}

// Google's multi-colour "G", as its sign-in branding guidelines ask for.
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** "Continue with Google" plus an "or" divider. Hidden unless the server has Google sign-in configured. */
function GoogleButton({ next }) {
  const { googleEnabled } = useAuth();
  if (!googleEnabled) return null;
  // A real navigation (not fetch): the server redirects the browser to Google and back.
  const href = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className="grid gap-4">
      <Button asChild variant="outline" className="gap-2">
        <a href={href}>
          <GoogleLogo /> Continue with Google
        </a>
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

// Why a Google sign-in bounced back to /login (?google=reason).
const GOOGLE_ERRORS = {
  cancelled: "Google sign-in was cancelled.",
  expired: "That Google sign-in took too long or was already used. Please try again.",
  failed: "Google sign-in didn't work. Please try again, or log in with your email and password.",
  suspended: "This account is suspended. Contact the moderators if you think this is a mistake.",
  other: "That email's account is linked to a different Google account. Log in with your password instead.",
};

// Login page. After signing in, go back to wherever the user was sent from (?next=).
export function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const f = useForm({ email: "", password: "" });
  const googleError = GOOGLE_ERRORS[params.get("google")];

  // Just check both boxes are filled in; the server decides if the details are right.
  const submit = (e) => {
    e.preventDefault();
    const errors = {};
    if (!f.values.email.trim()) errors.email = "Enter your email.";
    if (!f.values.password) errors.password = "Enter your password.";
    if (f.reject(errors)) return;
    f.run(async () => {
      try {
        const { user } = await api("/auth/login", { method: "POST", body: f.values });
        setUser(user);
        navigate(safeNext(params.get("next")), { replace: true });
      } catch (err) {
        f.setValues((v) => ({ ...v, password: "" })); // keep the email, never the password
        throw err;
      }
    });
  };

  return (
    <AuthCard
      title="Log in"
      description="Welcome back. Find your next trade."
      footer={
        <>
          <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/forgot-password">
            Forgot your password?
          </Link>
          <span>
            New here?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/register">
              Create an account
            </Link>
          </span>
        </>
      }
    >
      <form ref={f.ref} onSubmit={submit} noValidate className="grid gap-4">
        <ErrorAlert error={f.error ?? googleError} title="Couldn't log you in" />
        <GoogleButton next={params.get("next")} />
        <Field label="Email" type="email" autoComplete="email" {...f.bind("email")} />
        <Field label="Password" type="password" autoComplete="current-password" {...f.bind("password")} />
        <Button type="submit" disabled={f.busy}>
          {f.busy ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </AuthCard>
  );
}

// Sign-up page. Runs the full shared validation first so most mistakes never reach the server.
export function Register() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const f = useForm({ email: "", username: "", password: "", city: "" });

  const submit = (e) => {
    e.preventDefault();
    if (f.reject(validateRegistration(f.values))) return;
    f.run(async () => {
      const { user } = await api("/auth/register", { method: "POST", body: f.values });
      setUser(user);
      navigate("/dashboard", { replace: true });
    });
  };

  return (
    <AuthCard
      title="Create your account"
      description="Only your username and city are public. Your email stays private."
      footer={
        <span>
          Already have an account?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/login">
            Log in
          </Link>
        </span>
      }
    >
      <form ref={f.ref} onSubmit={submit} noValidate className="grid gap-4">
        <ErrorAlert error={f.error} title="Account not created" />
        <GoogleButton />
        <Field label="Email" type="email" autoComplete="email" {...f.bind("email")} />
        <Field label="Username" autoComplete="username" hint="3-24 letters, numbers or underscores. Shown publicly." {...f.bind("username")} />
        <Field label="Password" type="password" autoComplete="new-password" {...f.bind("password")} />
        <PasswordChecklist password={f.values.password} />
        <CitySelect {...f.bind("city")} />
        <Button type="submit" disabled={f.busy}>
          {f.busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link className="text-primary underline" to="/terms">trading rules</Link> and{" "}
          <Link className="text-primary underline" to="/privacy">privacy policy</Link>.
        </p>
      </form>
    </AuthCard>
  );
}

// Last step of signing up with Google: Google gave us a verified email, the player picks a username and city.
export function GoogleSignup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const pending = useApi("/auth/google/pending");
  const f = useForm({ username: "", city: "" });
  const submit = (e) => {
    e.preventDefault();
    const problems = { username: usernameMessage(f.values.username.trim()), city: f.values.city ? cityMessage(f.values.city) : "City is required." };
    if (f.reject(Object.fromEntries(Object.entries(problems).filter(([, v]) => v)))) return;
    f.run(async () => {
      const { user } = await api("/auth/google/complete", { method: "POST", body: f.values });
      setUser(user);
      navigate("/dashboard", { replace: true });
    });
  };
  if (pending.loading) return <Spinner label="Checking your Google sign-in" />;
  if (!pending.data?.email) {
    return (
      <AuthCard title="Google sign-in expired" description="Start again from the sign-up or log-in page.">
        <Button asChild>
          <Link to="/register">Back to sign up</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Almost done" description={`Signing up as ${pending.data.email} with Google. Only your username and city are public.`}>
      <form ref={f.ref} onSubmit={submit} noValidate className="grid gap-4">
        <ErrorAlert error={f.error} title="Account not created" />
        <Field label="Username" autoComplete="username" hint="3-24 letters, numbers or underscores. Shown publicly." {...f.bind("username")} />
        <CitySelect {...f.bind("city")} />
        <Button type="submit" disabled={f.busy}>
          {f.busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link className="text-primary underline" to="/terms">trading rules</Link> and{" "}
          <Link className="text-primary underline" to="/privacy">privacy policy</Link>. You can add a password later in Settings.
        </p>
      </form>
    </AuthCard>
  );
}

// Request a reset link. The reply is the same whether or not the email has an account.
export function ForgotPassword() {
  const f = useForm({ email: "" });
  const [sent, setSent] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const problem = emailMessage(f.values.email);
    if (f.reject(problem ? { email: problem } : {})) return;
    f.run(async () => setSent((await api("/auth/forgot-password", { method: "POST", body: f.values })).message));
  };
  return (
    <AuthCard title="Reset your password" description="We'll email you a link that works for 60 minutes.">
      {sent ? (
        <SuccessMessage className="rounded-md bg-accent p-4">{sent}</SuccessMessage>
      ) : (
        <form ref={f.ref} onSubmit={submit} noValidate className="grid gap-4">
          <ErrorAlert error={f.error} />
          <Field label="Email" type="email" autoComplete="email" {...f.bind("email")} />
          <Button type="submit" disabled={f.busy}>
            {f.busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

// Landing page for the emailed link. The token comes from ?token= in the URL.
export function ResetPassword() {
  const [params] = useSearchParams();
  const f = useForm({ password: "", confirm: "" });
  const [done, setDone] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    const errors = {};
    if (passwordProblems(f.values.password).length) errors.password = "Choose a password that meets every rule below.";
    if (f.values.password !== f.values.confirm) errors.confirm = "Passwords don't match.";
    if (f.reject(errors)) return;
    f.run(async () => {
      await api("/auth/reset-password", { method: "POST", body: { token: params.get("token"), password: f.values.password } });
      setDone(true);
    });
  };
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <div role="status" className="grid gap-4">
          <p className="flex items-center gap-2">
            <SuccessMark /> Your password was updated and other sessions were signed out.
          </p>
          <Button asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </div>
      ) : (
        <form ref={f.ref} onSubmit={submit} noValidate className="grid gap-4">
          <ErrorAlert error={f.error} />
          <Field label="New password" type="password" autoComplete="new-password" {...f.bind("password")} />
          <PasswordChecklist password={f.values.password} />
          <Field label="Confirm new password" type="password" autoComplete="new-password" {...f.bind("confirm")} />
          <Button type="submit" disabled={f.busy}>
            {f.busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/** Opens from the link in the welcome or confirmation email. Works signed in or out (people often switch devices). */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const [result, setResult] = useState(null); // { message } or { error }
  const sent = useRef(false); // the link is single use, so never send it twice (React runs effects twice in dev)
  useEffect(() => {
    // Wait until the session check is back: it carries the CSRF token the request needs.
    if (sent.current || user === undefined) return;
    sent.current = true;
    api("/auth/verify-email", { method: "POST", body: { token: params.get("token") ?? "" } }).then(
      async ({ message }) => {
        setResult({ message });
        // Refresh the signed-in user so the "confirm your email" banner goes away.
        const me = await api("/auth/me").catch(() => null);
        if (me?.user) setUser(me.user);
      },
      (error) => setResult({ error }),
    );
  }, [params, setUser, user]);

  return (
    <AuthCard title="Confirm your email">
      {!result && <Spinner label="Confirming your email" />}
      {result?.message && (
        <div role="status" className="grid gap-4">
          <p className="flex items-center gap-2">
            <SuccessMark /> {result.message}
          </p>
          <Button asChild>
            <Link to={user ? "/search" : "/login"}>{user ? "Find cards near you" : "Log in"}</Link>
          </Button>
        </div>
      )}
      {result?.error && (
        <div className="grid gap-4">
          <ErrorAlert error={result.error} title="Email not confirmed" />
          {user ? (
            <ResendLink />
          ) : (
            <Button asChild variant="outline">
              <Link to="/login?next=/dashboard">Log in to send a new link</Link>
            </Button>
          )}
        </div>
      )}
    </AuthCard>
  );
}
