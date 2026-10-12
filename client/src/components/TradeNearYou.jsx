import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { useApi } from "@/components/common";

/** Links to the cities with real trading going on (busiest first), for the home and store pages. */
export default function TradeNearYou({ className }) {
  const { data } = useApi("/cities");
  const cities = data?.cities ?? [];
  if (cities.length === 0) return null;
  return (
    <nav aria-labelledby="cities-heading" className={className}>
      <h2 id="cities-heading" className="font-semibold">
        Trade MTG cards near you
      </h2>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {cities.slice(0, 24).map((c) => (
          <li key={c.city}>
            <Link to={c.path} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              {c.city} <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
