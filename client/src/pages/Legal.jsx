import { Link } from "react-router";
import { EMAILS, TERMS_UPDATED } from "@shared/pages";

// Shared layout for the legal pages. The arbitrary selectors style plain h2/p/ul children,
// so the page bodies below can be written as simple HTML.
function LegalPage({ title, intro, children }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:grid [&_ul]:gap-1">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Last updated {TERMS_UPDATED}</p>
      <p>{intro}</p>
      {children}
    </article>
  );
}

/** Privacy policy (section 12): what we keep, what's public, how long, and how to remove it. */
export function Privacy() {
  return (
    <LegalPage title="Privacy policy" intro="Tap to Trade is a student project for local Magic: The Gathering trading. We collect as little as we can and never sell it.">
      <h2>What we collect</h2>
      <ul>
        <li>Account details: email, username, city (from a fixed list, never an address) and a hashed password.</li>
        <li>When you agreed to these terms and this policy, and which version (the date at the top of the page).</li>
        <li>If you choose "Continue with Google": your Google account id and verified email, used only to sign you in. We don't get your Google password, contacts or profile.</li>
        <li>An optional meetup range (how far you'll travel), shown on your profile.</li>
        <li>
          "Use my location" works only in your browser: it picks the nearest city from our list and puts a dot on your own map.
          Your exact position is never sent to us or shown to anyone.
        </li>
        <li>What you add: inventory listings, your want list, trade requests, offers and counter-offers, messages to the other player on a trade, the meetup you plan (place, date, time and time zone), and any reports or suggestions you send.</li>
        <li>Trade messages and meetup plans are only shown to the two players on that trade. Messages containing slurs are refused before they're saved.</li>
        <li>After an accepted trade, whether you say it happened and the 1 to 5 star rating you give the other player.</li>
        <li>A session cookie that keeps you signed in. No analytics, advertising or tracking cookies.</li>
        <li>Security logs of failed sign-ins, which hold account ids only.</li>
        <li>Whether you've confirmed your email address, and whether you want trade emails (you can turn them off in Settings).</li>
        <li>
          We email confirmed addresses about the account itself: password or email changes, account deletion, and moderator
          decisions about your listings or account. We never send marketing email.
        </li>
      </ul>
      <h2>What's public</h2>
      <p>
        Your username, city, meetup range and the inventory you choose to share. Search and profiles are open to anyone,
        including people without an account, so others can see who has a card before signing up. Your number of completed
        trades and your average star rating (from other players' feedback) show on your profile and listings; who gave which
        rating, and any "it didn't happen" answers, are not shown. Your want list isn't public: a player near you sees that you
        want a card only when they share that card for trade. On the map and in distances
        you appear at your city's centre, never your address. Your email is never shown. Cards you mark private stay visible
        only to you, and suggestions are only read by the moderators and admins.
      </p>
      <h2>Who processes it</h2>
      <p>
        The site runs on Render (hosting) and Neon (a managed PostgreSQL database), and its emails (welcome and confirmation,
        password resets, and trade updates if you leave them on) go through Resend. Their servers are in Ohio, in the United
        States, so your information is stored outside Canada and can be subject to US law. Card searches and collection imports
        are sent to Scryfall from our server, so Scryfall doesn't see who you are. Maps load from Google Maps (or OpenStreetMap),
        which sees your IP address like any website you visit; we never send it your location. Google sign-in and Google Maps
        are handled by Google under its own privacy policy. We don't send marketing email.
      </p>
      <h2>How long we keep it</h2>
      <ul>
        <li>Sessions end after 30 minutes idle or when you log out.</li>
        <li>Password-reset links expire after 60 minutes, email confirmation links after 72 hours; both are removed with your account.</li>
        <li>Trade history and trade ratings stay so both players keep a record of what was agreed and how it went.</li>
        <li>Trade messages and meetup plans stay with the trade for both players; the messages you wrote, and meetups on your trades, are deleted with your account.</li>
        <li>Reports, moderator actions and suggestions are kept for accountability.</li>
      </ul>
      <h2>Your choices</h2>
      <p>
        You can change your details or delete your account in <Link className="text-primary underline" to="/settings">account settings</Link>.
        Deleting removes your listings, want list, the trade messages you wrote, meetups on your trades, sessions and reset links and anonymizes your account; past trade snapshots,
        ratings and moderation records are kept without your details. You can also export your inventory as a CSV from the inventory page.
      </p>
      <h2>Access, corrections and complaints</h2>
      <p>
        You can ask for a copy of the personal information we hold about you, or ask us to correct it, by emailing{" "}
        <a className="text-primary underline" href={`mailto:${EMAILS.privacy}`}>{EMAILS.privacy}</a>. We answer within 30 days. If you're
        not satisfied with our answer, you can complain to the{" "}
        <a className="text-primary underline" href="https://www.priv.gc.ca/en/report-a-concern/" target="_blank" rel="noopener noreferrer">
          Office of the Privacy Commissioner of Canada
        </a>
        .
      </p>
      <h2>If something goes wrong</h2>
      <p>
        Passwords are stored only as Argon2id hashes and every connection is encrypted. If a breach ever creates a real risk of
        significant harm, we will tell the people affected and report it to the Privacy Commissioner, as Canadian privacy law
        requires.
      </p>
    </LegalPage>
  );
}

/** Terms and community trading rules (section 12). */
export function Terms() {
  return (
    <LegalPage title="Terms and trading rules" intro="By creating an account you agree to these rules. They're short because the site only helps you find trades; the trade itself happens between you and the other player.">
      <h2>How trading works</h2>
      <ul>
        <li>Tap to Trade doesn't handle payments or shipping. Every trade is arranged and completed in person.</li>
        <li>Accepting a request doesn't reserve cards, so check before you meet. When you confirm a trade happened, the cards you gave are removed from your inventory and the cards you got are added as private listings.</li>
        <li>Meet somewhere public, like a local game store, and bring a friend if you like.</li>
        <li>After you meet, say whether the trade happened and rate the other player honestly. Ratings are about the trade, not the person. Trading with yourself or a friend to boost a rating isn't allowed.</li>
      </ul>
      <h2 id="safety" className="scroll-mt-24">
        Safety
      </h2>
      <p>
        Meeting other users: Tap to Trade helps you arrange in-person trades, but any meetup is entirely your own responsibility.
        Meet in a public place such as a partner game store, and users under 18 should bring a parent or guardian.
      </p>
      <h2>Be honest and respectful</h2>
      <ul>
        <li>List cards you actually own, with the right printing, condition, finish (non-foil, foil or etched) and quantity.</li>
        <li>No counterfeits or proxies passed off as real cards.</li>
        <li>No harassment, hate, spam or scams, and no offers of cash for anything unlawful.</li>
        <li>One account per person. Keep your password to yourself.</li>
      </ul>
      <h2>Moderation</h2>
      <p>
        Anyone can report a player. Moderators can remove listings and suspend accounts that break these rules, and every
        moderator action is logged.
      </p>
      <p>
        If you think a moderator got it wrong, for example your listing was removed or your account was suspended, email{" "}
        <a className="text-primary underline" href={`mailto:${EMAILS.support}`}>{EMAILS.support}</a> within 30 days and say
        what happened. We'll look at it again and reply by email.
      </p>
      <h2>Closing your account</h2>
      <p>
        You can delete your account at any time in <Link className="text-primary underline" to="/settings">account settings</Link>.
        We may suspend or close accounts that seriously or repeatedly break these rules.
      </p>
      <h2>Changes to these terms</h2>
      <p>
        When these terms change, we update the date at the top of this page. If a change affects how trading or your account
        works, we'll email you before it takes effect.
      </p>
      <h2 id="accessibility" className="scroll-mt-24">
        Accessibility
      </h2>
      <p>
        We aim to meet WCAG 2.1 level AA in light and dark themes. Every page works with a keyboard and a screen reader, and
        the site follows your device's dark mode and reduced-motion settings.
      </p>
      <p>
        You can also adjust the site yourself under Display and accessibility in Settings: theme, larger text, reduced motion,
        higher contrast and underlined links. The sun and moon button in the header switches between light and dark. Your
        choices are saved on your device and work without an account.
      </p>
      <p>
        If something on the site is hard to use with your device or assistive technology, or you need information in another
        format, email <a className="text-primary underline" href={`mailto:${EMAILS.support}`}>{EMAILS.support}</a> and we'll help.
      </p>
      <h2>The fine print</h2>
      <p>
        The site is provided as is, without warranty. We aren't responsible for trades between players. If you're under the
        age of majority in your province or territory, get a parent or guardian's permission first. Card data and images come from Scryfall.
        Tap to Trade is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions
        of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        See also our <Link className="text-primary underline" to="/privacy">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
