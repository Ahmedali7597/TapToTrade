// Transactional email over Resend's HTTPS API (free web services block SMTP ports; plan 8.1).
// Either send a finished message ({ subject, text, html }), or name a template stored in Resend and its variables
// ({ template: { id, variables } }); Resend then fills in the template, including any wording edited in its dashboard.
// The templates themselves are in shared/emails.js, and lib/notify.js decides which way to send.
export async function sendEmail({ to, subject, text, html, template }) {
  const key = process.env.EMAIL_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error("EMAIL_API_KEY is not set; email was not sent.");
      return false;
    }
    // Local development only: no provider configured, so print the message for the developer.
    console.info(`[dev email] to=${to} subject="${subject}"\n${text}`);
    return true;
  }
  // Give up after 8 seconds so a slow provider can't hang the "forgot password" request. A timeout or network
  // error counts as "not sent", the same as a refusal, so callers only ever deal with true or false.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, ...(template ? { template } : { subject, text, ...(html && { html }) }) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`Email provider responded ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`Email provider unreachable: ${err.name}`);
    return false;
  }
}
