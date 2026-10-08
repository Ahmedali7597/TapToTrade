import { useRef, useState } from "react";
import { shake } from "@/components/common";

// Form state for the sign-in pages and the Settings cards: the typed values, field errors from the browser's own
// checks or from the server, a general error, and a busy flag while a request is running.

/** Keeps form state and shows the server's field errors next to the inputs. */
export function useForm(initial, idPrefix) {
  // The form shakes when a check fails, like Face ID saying no.
  const ref = useRef(null);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Spread into a <Field> to wire up id, value, error and onChange in one go. A page with several forms (Settings)
  // passes idPrefix, e.g. "Email", so two forms' "currentPassword" boxes get different ids ("email-currentpassword").
  const bind = (name) => ({
    id: idPrefix ? `${idPrefix}-${name}`.replace(/\s+/g, "-").toLowerCase() : name,
    name,
    value: values[name],
    error: errors[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  // Runs a submit handler with the busy flag on, and turns a thrown API error into field messages.
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setErrors(err.fields ?? {});
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  // Shows client-side field errors; returns true (after a shake) when there were any, so submit can stop.
  const reject = (fieldErrors) => {
    setErrors(fieldErrors);
    const bad = Object.keys(fieldErrors).length > 0;
    if (bad) shake(ref.current);
    return bad;
  };
  return { ref, values, setValues, errors, setErrors, error, busy, bind, run, reject };
}
