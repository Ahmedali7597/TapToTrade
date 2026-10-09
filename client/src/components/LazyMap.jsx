import { Component, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";

// The map code (Leaflet with OpenStreetMap, or Google Maps once a key is set) is large, so it's only downloaded
// when a page actually shows a map. A plain box of the same size stands in while it loads.
const TradeMap = lazy(() => import("@/components/TradeMap"));

/** If the map code ever throws, show a note in its place instead of taking the whole page down with it. */
class MapBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={cn("grid w-full place-items-center rounded-xl border bg-muted text-sm text-muted-foreground", this.props.className)}>
        The map couldn't load. The rest of the page still works.
      </div>
    );
  }
}

/** TradeMap, loaded on demand. Takes the same props as TradeMap. */
export default function LazyMap({ className = "h-[28rem]", ...props }) {
  return (
    <MapBoundary className={className}>
      <Suspense fallback={<div className={cn("w-full rounded-xl border bg-muted", className)} />}>
        <TradeMap className={className} {...props} />
      </Suspense>
    </MapBoundary>
  );
}
