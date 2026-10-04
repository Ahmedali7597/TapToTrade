import { buildEmail, EMAIL_KINDS, emailVariables, noteHtml, previewKind, sampleData, templateVariables } from "./emails.js";

const SITE = "https://taptotrade.ca";

describe("the site's emails", () => {
  test("every email kind builds from its sample data, with the logo and a plain-text twin", () => {
    for (const { key } of EMAIL_KINDS) {
      const kind = previewKind(key);
      const email = buildEmail(kind, { ...sampleData(key, SITE, "hamilton_brewer") });
      expect(email.subject).toBeTruthy();
      expect(email.html).toContain(`<img src="${SITE}/brand/email-logo.png"`);
      expect(email.text).toContain("support@taptotrade.ca");
    }
  });

  test("the welcome email thanks the player and has the confirm button only when there's a link", () => {
    const link = `${SITE}/verify-email?token=abc_123`;
    const email = buildEmail("welcome", { site: SITE, username: "hamilton_brewer", link, hours: 72 });
    expect(email.subject).toBe("Welcome to Tap to Trade, hamilton_brewer");
    expect(email.html).toContain("Thanks for joining, hamilton_brewer!");
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).toContain(link);
    const google = buildEmail("welcome", { site: SITE, username: "g_player", link: null });
    expect(google.html).not.toContain("Confirm my email");
    expect(google.text).toContain("Getting started");
  });

  test("the reset email keeps its subject and link", () => {
    const link = `${SITE}/reset-password?token=abc_123`;
    const email = buildEmail("reset", { site: SITE, username: "x", link, minutes: 60 });
    expect(email.subject).toBe("Reset your Tap to Trade password");
    expect(email.text).toContain(link);
    expect(email.text).toContain("60 minutes");
    expect(email.html).toContain(`href="${link}"`);
  });

  test("trade emails list the cards from the reader's side and say how to turn them off", () => {
    const data = sampleData("trade_request", SITE, "hamilton_brewer");
    const request = buildEmail("trade_request", data);
    expect(request.subject).toBe("bolt_burlington sent you a trade request");
    expect(request.text).toMatch(/They'd like from you:\n- 1 × Sol Ring \(C21 #263, NM\)/);
    expect(request.text).toContain("- 2 × Lightning Bolt (M10 #146, LP, Foil)");
    expect(request.html).toContain(`href="${SITE}/trades/1"`);
    expect(request.html).toContain(`href="${SITE}/settings"`);
    const accepted = buildEmail("trade_accepted", { ...data, meetupSpot: { name: "The Mana Vault", address: "1 King St W", city: "Hamilton, ON" } });
    expect(accepted.text).toContain("You'll receive:");
    expect(accepted.text).toContain("Suggested meetup spot: The Mana Vault, 1 King St W, Hamilton, ON");
  });

  test("the moderator email links to the queue and the rules", () => {
    const email = buildEmail("moderator", { site: SITE, username: "new_mod" });
    expect(email.subject).toBe("You're now a Tap to Trade moderator");
    expect(email.html).toContain(`href="${SITE}/moderation"`);
    expect(email.text).toContain(`${SITE}/terms`);
  });

  test("admin text appears under the message and in the footer, with {username} filled in", () => {
    const email = buildEmail("welcome", { site: SITE, username: "hamilton_brewer", link: null, note: "Thanks {username}!\n\nSee you at trade night.", footer: "Partner: The Mana Vault" });
    expect(email.html).toContain("Thanks hamilton_brewer!");
    expect(email.html).toContain("See you at trade night.");
    expect(email.html).toContain("Partner: The Mana Vault");
    expect(email.text).toMatch(/Thanks hamilton_brewer!\n\nSee you at trade night\.[\s\S]*--\nPartner: The Mana Vault/);
  });

  test("admin text is escaped, and only https and email links become clickable", () => {
    const html = noteHtml('<img src=x onerror=alert(1)> Visit https://example.com/a?b=1&c=2. Write hello@taptotrade.ca or javascript:alert(1) or "https://x.ca"');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" style="color:#006b61">https://example.com/a?b=1&amp;c=2</a>.');
    expect(html).toContain('<a href="mailto:hello@taptotrade.ca"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&quot;<a href="https://x.ca"');
  });

  test("values from players are escaped", () => {
    const email = buildEmail("trade_request", { ...sampleData("trade_request", SITE, "me"), message: '"><script>alert(1)</script>' });
    expect(email.html).not.toContain("<script>");
    const welcome = buildEmail("welcome", { site: SITE, username: "<b>me</b>", link: null });
    expect(welcome.html).not.toContain("<b>me</b>");
  });

  test("every template only uses variables the app fills in, so nothing shows up blank in Resend", () => {
    for (const { key } of EMAIL_KINDS.filter((k) => k.alias)) {
      const vars = emailVariables(key, sampleData(key, SITE, "hamilton_brewer"));
      for (const name of templateVariables(key)) expect(vars).toHaveProperty(name);
      expect(templateVariables(key).length).toBeLessThanOrEqual(50); // Resend's limit per template
      expect(buildEmail(key, sampleData(key, SITE, "hamilton_brewer")).html).not.toContain("{{{");
    }
  });

  test("a city with an apostrophe is escaped in the HTML and plain in the text version", () => {
    const email = buildEmail("trade_request", { ...sampleData("trade_request", SITE, "me"), fromCity: "St. John's, NL" });
    expect(email.html).toContain("bolt_burlington (St. John&#39;s, NL) would like to trade with you.");
    expect(email.text).toContain("bolt_burlington (St. John's, NL) would like to trade with you.");
  });

  test("a declined request lists what the reader asked for", () => {
    const email = buildEmail("trade_declined", sampleData("trade_declined", SITE, "hamilton_brewer"));
    expect(email.subject).toBe("bolt_burlington declined your trade request");
    expect(email.text).toMatch(/You asked for:\n- 1 × Sol Ring \(C21 #263, NM\)/);
    expect(email.html).toContain(`href="${SITE}/trades/1"`);
  });

  test("unknown emails are a programming error", () => {
    expect(() => buildEmail("nope", { site: SITE })).toThrow("Unknown email: nope");
  });
});
