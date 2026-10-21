import { cad, priceSource } from "@/lib/prices";
import { cn } from "@/lib/utils";

/** "≈ CA$2.64" (optionally "each"), with where it came from on hover. Nothing when there's no price. */
export default function PriceTag({ price, rate, each = false, className }) {
  if (price?.cad == null) return null;
  return (
    <span className={cn("whitespace-nowrap tabular-nums text-muted-foreground", className)} title={priceSource(price, rate)}>
      ≈ {cad(price.cad)}
      {each && " each"}
    </span>
  );
}
