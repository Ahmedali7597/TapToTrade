import { Link } from "react-router";
import { ArrowDown, ArrowRight, BadgeCheck, Gift, Handshake, Layers, MapPin, Search, ShieldCheck } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Marquee } from "@/components/ui/marquee";
import ScrollHero from "@/components/ScrollHero";
import TapToTradeLogo from "@/components/TapToTradeLogo";
import { useAuth } from "@/lib/auth";
import { CardImage, useApi } from "@/components/common";
import { useShowcase } from "@/lib/showcase";
import { tagLabel } from "@shared/stores";

// Frosted text box that floats over the hero film.
const Caption = ({ kicker, children }) => (
  <div className="max-w-xl rounded-2xl bg-black/45 p-5 text-white shadow-xl backdrop-blur-md sm:p-6">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-100">{kicker}</p>
    <p className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">{children}</p>
  </div>
);

// How it works, told as three verbs beside a binder page. The verb is the label; no step numbers.
const STEPS = [
  { icon: Layers, title: "List your bulk", description: "Pick the exact printing, set quantity, condition and finish, or import your Moxfield or Archidekt collection." },
  { icon: Search, title: "Search nearby", description: "Find who has the card within 10 to 250 km, on a list or a map, nearest first." },
  { icon: Handshake, title: "Tap to trade", description: "Request cards, offer yours, counter, and pick a partner game store to meet at." },
];
// Safety principles, as a quiet list rather than another grid.
const PRINCIPLES = [
  { icon: MapPin, title: "City only", description: "Profiles show a username, a city and shared cards. Never your address. Meet somewhere public." },
  { icon: ShieldCheck, title: "Moderated", description: "Report a listing or player; moderators can remove listings and suspend accounts." },
  { icon: BadgeCheck, title: "Honest status", description: "“Offer accepted” means you agreed to meet, not that the trade is done." },
];

/** Primary call to action: a solid button in the brand teal. */
function PrimaryCta({ to, children }) {
  return (
    <Button asChild size="lg">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

// Random cards: 24 for the two marquee rows and 8 for the binder page. New ones on every visit.
const MARQUEE = 24;
const BINDER = 8;

// One sleeved card in the scrolling marquee. Click it to zoom in. Fixed height and card ratio so the row keeps
// its width while images load (and while the random cards are still on their way).
function ShowcaseCard({ card, siblings, onGiveUp, copy }) {
  return (
    <div className="group py-2">
      {card ? (
        <CardImage
          key={card.imageUrl}
          name={card.name}
          setCode={card.setCode}
          imageUrl={card.imageUrl}
          printingId={card.id}
          siblings={siblings}
          onGiveUp={onGiveUp}
          tabIndex={copy > 0 ? -1 : undefined}
          className="aspect-[488/680] h-44 sm:h-52"
        />
      ) : (
        <div className="sleeve aspect-[488/680] h-44 bg-muted sm:h-52" />
      )}
    </div>
  );
}

// A 3x3 binder page: eight sleeved cards around one empty pocket, the card someone nearby is looking for.
function BinderPage({ cards, onGiveUp }) {
  const pockets = cards ? [...cards.slice(0, 4), null, ...cards.slice(4)] : Array(9).fill(undefined);
  const ids = cards?.map((c) => c.id);
  return (
    <div className="rounded-2xl border bg-card p-3 shadow-[0_24px_60px_-36px_rgb(var(--shadow)/0.6)] sm:p-4" aria-label="A binder page of listed cards" role="group">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {pockets.map((card, i) =>
          card === null ? (
            <div key="missing" className="pocket group flex items-center justify-center p-2 pt-4">
              <div className="flex aspect-[63/88] w-full flex-col items-center justify-center rounded-[4.5%/3.25%] border-2 border-dashed border-primary/50 p-2 text-center">
                <span className="font-display text-sm leading-tight font-semibold text-primary sm:text-base">Someone's missing piece</span>
              </div>
            </div>
          ) : (
            <div key={card?.imageUrl ?? i} className="pocket group p-2 pt-4">
              {card ? (
                <CardImage name={card.name} setCode={card.setCode} imageUrl={card.imageUrl} printingId={card.id} siblings={ids} onGiveUp={() => onGiveUp(i < 4 ? i : i - 1)} className="w-full" />
              ) : (
                <div className="sleeve aspect-[488/680] bg-muted" />
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Featured partner stores: game stores that host trades. Until there are any, an invitation to store owners.
 */
function PartnerStores() {
  const { data } = useApi("/stores?featured=1");
  const stores = data?.stores.slice(0, 3) ?? [];
  return (
    <section className="border-t py-16" aria-labelledby="stores-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="stores-heading" className="text-3xl font-bold md:text-4xl">
              Meet at your local game store
            </h2>
            <p className="mt-3 max-w-[60ch] text-muted-foreground">
              Partner stores are official meetup spots: public, friendly, and full of players. Pick one when you send a trade request.
            </p>
          </div>
          <Link to="/stores" className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
            All partner stores <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {stores.length > 0 ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {stores.map((s) => (
              <li key={s.id} className="flex flex-col rounded-xl border bg-card p-5">
                <Link to={s.path} className="text-lg font-semibold underline-offset-4 hover:underline">
                  {s.name}
                </Link>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-4" aria-hidden="true" /> {s.city}
                </p>
                {s.tags.length > 0 && <p className="mt-3 text-sm">{s.tags.slice(0, 3).map(tagLabel).join(" · ")}</p>}
                {s.perk && (
                  <p className="mt-3 flex items-start gap-2 text-sm">
                    <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> {s.perk}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Run a game store?{" "}
            <Link to="/stores#partner" className="font-semibold text-primary underline-offset-4 hover:underline">
              Become a partner
            </Link>{" "}
            and we'll send local players your way.
          </p>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const { user } = useAuth();
  // Signed-in visitors get "go search", new visitors get "sign up". Used in the hero and at the bottom.
  const ctas = user ? (
    <>
      <PrimaryCta to="/search">Search cards near you</PrimaryCta>
      <Button asChild size="lg" variant="outline">
        <Link to="/inventory">Add to your inventory</Link>
      </Button>
    </>
  ) : (
    <>
      <PrimaryCta to="/register">Create a free account</PrimaryCta>
      <Button asChild size="lg" variant="outline">
        <Link to="/login">Log in</Link>
      </Button>
    </>
  );
  const { cards, swap } = useShowcase(MARQUEE + BINDER);
  const marquee = cards?.slice(0, MARQUEE) ?? Array(MARQUEE).fill(null);
  const ids = marquee.map((c) => c?.id);
  // Split the marquee into two rows that scroll in opposite directions.
  const half = MARQUEE / 2;

  return (
    <>
      <ScrollHero
        intro={
          <div className="max-w-2xl text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-100">Local Magic: The Gathering trading</p>
            <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">Your bulk is someone's missing piece.</h1>
          </div>
        }
        hint={
          <p className="mt-4 flex items-center gap-2 text-base text-white/90 drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-lg">
            <ArrowDown className="size-5" aria-hidden="true" /> Scroll to sort the pile
          </p>
        }
        // Each caption appears during its slice of the scroll (0 = top of the hero, 1 = bottom).
        captions={[
          { from: 0.1, to: 0.3, content: <Caption kicker="The pile">Hundreds of cards, sitting in a box you never open.</Caption> },
          { from: 0.34, to: 0.56, content: <Caption kicker="List it once">Pick each printing, quantity and condition. Share only what you want.</Caption> },
          { from: 0.6, to: 0.78, content: <Caption kicker="Get found">Players in your city search by card name and find you.</Caption> },
        ]}
        finale={
          <div className="max-w-2xl rounded-2xl bg-background p-6 shadow-xl ring-1 ring-black/5 sm:p-8">
            <TapToTradeLogo animate={false} />
            <p className="mt-3 text-lg text-muted-foreground sm:text-xl">
              Find the card. Tap to trade. Meet at a public spot in your city. No payments, no shipping.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">{ctas}</div>
          </div>
        }
      />

      {/* Card showcase: two marquees of sleeved cards with faded edges. */}
      <section className="overflow-hidden border-b py-14" aria-labelledby="showcase-heading">
        <div className="mx-auto mb-8 max-w-6xl px-4 sm:px-6">
          <h2 id="showcase-heading" className="max-w-xl text-3xl font-bold md:text-4xl">
            Real printings, real binders
          </h2>
          <p className="mt-3 max-w-[60ch] text-muted-foreground">
            Every listing points at an exact printing, with Scryfall images and set details. A new random pick every visit; tap any card to read it.
          </p>
        </div>
        <div className="relative">
          <Marquee pauseOnHover className="[--duration:45s]">
            {(copy) => marquee.slice(0, half).map((card, i) => <ShowcaseCard key={card?.imageUrl ?? i} card={card} siblings={ids} copy={copy} onGiveUp={() => swap(i)} />)}
          </Marquee>
          <Marquee reverse pauseOnHover className="[--duration:50s]">
            {(copy) => marquee.slice(half).map((card, i) => <ShowcaseCard key={card?.imageUrl ?? i} card={card} siblings={ids} copy={copy} onGiveUp={() => swap(half + i)} />)}
          </Marquee>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/6 bg-gradient-to-r from-background" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/6 bg-gradient-to-l from-background" />
        </div>
      </section>

      {/* How it works: a binder page beside three verbs. */}
      <section className="py-16 md:py-24" aria-labelledby="how-heading">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <BlurFade inView className="order-2 lg:order-1">
            <BinderPage cards={cards?.slice(MARQUEE)} onGiveUp={(i) => swap(MARQUEE + i)} />
          </BlurFade>
          <div className="order-1 lg:order-2">
            <h2 id="how-heading" className="text-3xl font-bold md:text-5xl">
              From a dusty box to a local trade
            </h2>
            <p className="mt-4 max-w-[52ch] text-muted-foreground md:text-lg">
              List what you own, find what you need nearby, and agree to meet. Tap to Trade never handles money or shipping.
            </p>
            <ol className="mt-8 grid gap-0">
              {STEPS.map(({ icon: Icon, title, description }) => (
                <li key={title} className="flex gap-4 border-t border-border/80 py-5">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <p className="mt-1 text-muted-foreground">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <PartnerStores />

      {/* Safety principles: a heading beside a plain list. */}
      <section className="border-t py-16" aria-labelledby="safety-heading">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-[1fr_2fr]">
          <h2 id="safety-heading" className="text-2xl font-bold md:text-3xl">
            Built for meeting strangers safely
          </h2>
          <dl className="grid gap-6 sm:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, description }) => (
              <div key={title}>
                <dt className="flex items-center gap-2 font-semibold">
                  <Icon className="size-4 text-primary" aria-hidden="true" /> {title}
                </dt>
                <dd className="mt-1.5 text-sm text-muted-foreground">{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing call to action: the one full-colour band on the page. */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 rounded-2xl bg-primary px-6 py-12 text-primary-foreground shadow-[0_30px_60px_-40px_rgb(var(--shadow)/0.8)] sm:px-10 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-md text-3xl font-bold md:text-4xl">Ready to sort your pile?</h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" variant="secondary" className="bg-card text-foreground hover:bg-card/90">
              <Link to={user ? "/search" : "/register"}>{user ? "Search cards near you" : "Create a free account"}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              <Link to={user ? "/inventory" : "/login"}>{user ? "Add to your inventory" : "Log in"}</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
