import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Field } from "@/components/common";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CITY_GROUPS, PASSWORD_RULES, passwordProblems } from "@shared/validation";

// Account form pieces shared by the sign-up, settings, search and moderation screens.

// Live checklist under password boxes. The labels come from the server's own PASSWORD_RULES,
// so a green tick here means the server will accept it. The length cap is left off to keep the list short.
const CHECKLIST_RULES = PASSWORD_RULES.map(([label]) => label).filter((label) => label !== "at most 128 characters");

export function PasswordChecklist({ password }) {
  const unmet = new Set(passwordProblems(password));
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" aria-label="Password requirements">
      {CHECKLIST_RULES.map((rule) => {
        const ok = password && !unmet.has(rule);
        return (
          <li key={rule} className={ok ? "flex items-center gap-1 text-success" : "flex items-center gap-1 text-muted-foreground"}>
            {ok ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
            {rule}
            <span className="sr-only">{ok ? " (met)" : " (not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

// City dropdown from the fixed list, grouped by province. Search reuses it with an "Any city" option.
export function CitySelect({ id = "city", value, onChange, error, includeAny = false, label = "City" }) {
  return (
    <Field id={id} label={label} error={error}>
      <NativeSelect id={id} value={value} onChange={onChange} aria-invalid={!!error} className="w-full" aria-describedby={error ? `${id}-error` : undefined}>
        <NativeSelectOption value="">{includeAny ? "Any city" : "Choose your city"}</NativeSelectOption>
        {CITY_GROUPS.map((g) => (
          <NativeSelectOptGroup key={g.code} label={g.name}>
            {g.cities.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
    </Field>
  );
}

/** "Send a new link" for players whose email isn't confirmed yet. Used by the banner and the confirm page. */
export function ResendLink({ className, variant = "outline", size }) {
  const [state, setState] = useState({ busy: false });
  const send = async () => {
    setState({ busy: true });
    try {
      setState({ message: (await api("/account/verify-email", { method: "POST" })).message });
    } catch (error) {
      setState({ error: error.message });
    }
  };
  if (state.message) return <p role="status" className={cn("text-sm font-medium", className)}>{state.message}</p>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <Button type="button" variant={variant} size={size} onClick={send} disabled={state.busy}>
        {state.busy ? "Sending…" : "Send a new link"}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      )}
    </span>
  );
}
