import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError } from "../lib/http.js";
import { sendEmail } from "../lib/email.js";
import { emailTexts } from "../lib/notify.js";
import { siteUrl } from "../lib/seo.js";
import { requireRole, testEmailLimiter } from "../middleware.js";
import { buildEmail, EMAIL_KEYS, NOTE_MAX, previewKind, sampleData } from "../../shared/emails.js";
import { logAction } from "../lib/audit.js";

// Admins add their own text to the site's emails (shown under the message, or in every footer), preview it on
// the Admin page, and send themselves a test. The emails themselves are built in shared/emails.js.
const router = Router();
router.use(requireRole("admin"));

const readKey = (req) => {
  if (!EMAIL_KEYS.includes(req.params.key)) throw new HttpError(404, "That email was not found.");
  return req.params.key;
};
const readBody = (body) => {
  const text = typeof body?.body === "string" ? body.body.replace(/\r\n/g, "\n").trim() : "";
  if (text.length > NOTE_MAX) throw new HttpError(400, `Keep it under ${NOTE_MAX} characters.`, { body: `${NOTE_MAX} characters at most.` });
  return text;
};

// Saved text for every email, plus when it last changed and by whom.
router.get("/", async (req, res) => {
  const { rows } = await query("SELECT e.key, e.body, e.updated_at, u.username FROM email_texts e LEFT JOIN users u ON u.id = e.updated_by");
  res.json({ texts: Object.fromEntries(rows.map((r) => [r.key, { body: r.body, updatedAt: r.updated_at, updatedBy: r.username }])), site: siteUrl() });
});

// Save (or, with empty text, remove) one email's text. Logged like other admin changes.
router.put("/:key", async (req, res) => {
  const key = readKey(req);
  const body = readBody(req.body);
  await tx(async (c) => {
    if (body) {
      await c.query(
        `INSERT INTO email_texts (key, body, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, body, req.user.id],
      );
    } else {
      await c.query("DELETE FROM email_texts WHERE key = $1", [key]);
    }
    await logAction(c, { actorId: req.user.id, action: "email_text_updated", details: { key, length: body.length } });
  });
  res.json({ ok: true });
});

// Send the admin a sample of one email with the text as typed (saved or not), so they can see it in a real inbox.
router.post("/:key/test", testEmailLimiter, async (req, res) => {
  const key = readKey(req);
  const body = readBody(req.body);
  const texts = await emailTexts();
  const kind = previewKind(key);
  // Use the draft for the email being edited and the saved text for the rest.
  const draft = { ...texts, [key]: body || undefined };
  const email = buildEmail(kind, { ...sampleData(kind, siteUrl(), req.user.username), note: draft[kind], footer: draft.footer });
  const sent = await sendEmail({ to: req.user.email, ...email, subject: `[Test] ${email.subject}` });
  if (!sent) throw new HttpError(502, "The email couldn't be sent just now. Please try again in a few minutes.");
  res.json({ message: `Test sent to ${req.user.email}. It uses made-up trade and card details.` });
});

export default router;
