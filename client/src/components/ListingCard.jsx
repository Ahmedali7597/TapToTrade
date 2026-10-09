import { Link } from "react-router";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardImage, ConditionBadge, FinishBadge, printingLabel, Reputation, StoreBadge } from "@/components/common";
import { qs } from "@/lib/api";

// One shared listing tile, used on the search page, the dashboard, public profiles and want-list matches.

/** "12 km away", or "Same city" for 0 km. */
export const distanceLabel = (km) => (km == null ? null : km === 0 ? "Same city" : `${km} km away`);

/**
 * A listing as a sleeved card in a binder pocket (mockup 7 direction): the card art first, then the printing,
 * condition, finish, quantity, and who has it, where, and how far away. Tapping the art zooms into the card;
 * `siblings` (the printing ids of the other cards on screen) power Previous and Next there.
 */
export function ListingCard({ item, owner, action, distanceKm, siblings }) {
  return (
    <article className="pocket group flex h-full flex-col p-3 pt-5">
      <CardImage
        name={item.printing.name}
        setCode={item.printing.setCode}
        imageUrl={item.printing.imageUrl}
        finish={item.finish}
        printingId={item.printing.id}
        siblings={siblings}
        className="w-full"
      />
      <div className="mt-3 flex flex-1 flex-col px-0.5">
        <h3 className="font-display leading-snug font-semibold">{item.printing.name}</h3>
        <p className="text-xs text-muted-foreground">
          {item.printing.setName ?? item.printing.setCode?.toUpperCase()}, {printingLabel(item.printing)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <ConditionBadge condition={item.condition} />
          <FinishBadge finish={item.finish} />
          <span className="ml-auto text-muted-foreground">
            <strong className="text-foreground">{item.quantity}</strong> available
          </span>
        </div>
        {owner && (
          <p className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-3 text-sm">
            <Link to={`/u/${owner.username}`} className="font-semibold text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline">
              {owner.username}
            </Link>
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden="true" /> {owner.city}
            </span>
            {distanceLabel(distanceKm) && <span className="text-muted-foreground">{distanceLabel(distanceKm)}</span>}
            <StoreBadge store={owner.store} />
            <Reputation reputation={owner.reputation} compact />
          </p>
        )}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </article>
  );
}

// Starts a new trade with this listing already picked. Visitors are sent to log in first, then come back here.
export function RequestTradeButton({ owner, item }) {
  return (
    <Button asChild size="sm" className="w-full gap-2">
      <Link to={`/trades/new${qs({ to: owner.username, item: item.id })}`}>
        <img src="/brand/curved-arrow.svg" alt="" className="size-4 brightness-0 invert dark:invert-0" />
        Send request
      </Link>
    </Button>
  );
}
