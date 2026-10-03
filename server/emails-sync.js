import { EMAIL_KINDS, TEMPLATES, templateVariables } from "../shared/emails.js";

// Puts the site's emails into Resend as templates, so their wording can be edited in Resend's dashboard:
//   npm run emails:sync            creates any template Resend doesn't have yet (your edits in Resend are kept)
//   npm run emails:sync -- --update  replaces every template with the app's version from shared/emails.js
// Every template is published so it can be sent. Then set EMAIL_TEMPLATES=resend in Render (see README "Email").
// Managing templates needs a Resend API key with Full access; the site itself only needs a Sending access key.
const key = process.env.EMAIL_API_KEY;
if (!key) {
  console.error("Set EMAIL_API_KEY (the Resend API key) in .env first.");
  process.exit(1);
}
const update = process.argv.includes("--update");

// One Resend API call. Resend allows 10 requests a second, so wait a little before each one.
async function resend(method, path, body) {
  await new Promise((r) => setTimeout(r, 200));
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

for (const { key: kind, label, alias } of EMAIL_KINDS.filter((k) => k.alias)) {
  const t = TEMPLATES[kind];
  const template = {
    name: `Tap to Trade: ${label}`,
    alias,
    subject: t.subject,
    html: t.html,
    text: t.text,
    variables: templateVariables(kind).map((name) => ({ key: name, type: "string" })),
  };
  const existing = await resend("GET", `/templates/${alias}`);
  if (existing.status === 401) {
    console.error(`Resend refused the key: ${existing.data.message ?? "unauthorized"}.`);
    console.error("Create a key with Full access (Resend > API Keys), put it in .env as EMAIL_API_KEY, and run this again.");
    process.exit(1);
  }
  if (existing.ok && !update) {
    console.log(`kept     ${alias} (already in Resend)`);
    continue;
  }
  const saved = existing.ok ? await resend("PATCH", `/templates/${alias}`, template) : await resend("POST", "/templates", template);
  if (!saved.ok) {
    console.error(`failed   ${alias}: ${saved.status} ${saved.data.message ?? ""}`);
    process.exitCode = 1;
    continue;
  }
  const published = await resend("POST", `/templates/${alias}/publish`);
  console.log(`${existing.ok ? "updated" : "created"}  ${alias}${published.ok ? "" : ` (but publishing failed: ${published.status} ${published.data.message ?? ""})`}`);
}
