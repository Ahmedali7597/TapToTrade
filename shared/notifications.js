// What each in-app notification says and which email setting covers it. Shared by the server (which emails to send)
// and the header's bell (what to show).

/** The email choices on the Settings page: [key, label, description]. Account emails aren't here: they always send. */
export const EMAIL_CATEGORIES = [
  ["requests", "New trade requests and counter-offers", "When someone sends you a trade request or answers yours with a counter-offer."],
  ["updates", "Accepted and declined trades", "When the other player accepts or declines your proposal."],
  ["messages", "Messages", "When the other player writes to you about a trade (one email for a burst of messages)."],
  ["meetups", "Meetup plans", "When a meetup is suggested, changed or confirmed."],
];

/** For each notification kind: its email setting (null = no email) and the sentence shown for it. */
export const NOTIFICATION_KINDS = {
  trade_request: { email: "requests", text: (who) => `${who} sent you a trade request` },
  trade_counter: { email: "requests", text: (who) => `${who} sent you a counter-offer` },
  trade_accepted: { email: "updates", text: (who) => `${who} accepted your trade` },
  trade_declined: { email: "updates", text: (who) => `${who} declined your trade` },
  trade_message: { email: "messages", text: (who) => `New message from ${who}` },
  trade_meetup: { email: "meetups", text: (who) => `${who} suggested a meetup` },
  trade_meetup_confirmed: { email: "meetups", text: (who) => `${who} confirmed your meetup` },
  trade_feedback: { email: null, text: (who) => `${who} said your trade happened. Tell us how it went` },
};

/** The sentence for a notification { kind, actor: { username } }. */
export const notificationText = (n) => (NOTIFICATION_KINDS[n.kind]?.text ?? (() => "Trade update"))(n.actor?.username ?? "A player");

/** A player's email choices with every category filled in (a missing one means yes). */
export const emailPrefsFor = (stored = {}) => Object.fromEntries(EMAIL_CATEGORIES.map(([key]) => [key, stored?.[key] !== false]));
