import { Link } from "react-router";
import { Plus } from "lucide-react";

/** Questions as an accordion: each one opens to its answer and any links (FAQ in shared/pages.js). */
export default function FaqList({ items }) {
  return (
    <div className="divide-y rounded-xl border bg-card">
      {items.map((f) => (
        <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
            {f.q}
            <Plus className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true" />
          </summary>
          <p className="mt-2 text-muted-foreground">{f.a}</p>
          {f.links && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {f.links.map(([to, label]) => (
                <Link key={to} to={to} className="font-medium text-primary underline-offset-4 hover:underline">
                  {label}
                </Link>
              ))}
            </p>
          )}
        </details>
      ))}
    </div>
  );
}
