// Escapes text before it goes into HTML or XML (web pages, emails, the sitemap), so a name like "<b>Bob</b>"
// shows up as those characters instead of becoming markup. Shared by server/lib/seo.js and shared/emails.js.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
