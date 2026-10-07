// Minimal Footer by Efferd UI (ui.efferd.com), from 21st.dev: https://21st.dev/@efferd/components/minimal-footer
// Converted from TSX. Changes: content comes from props instead of hard-coded placeholders, internal links use
// react-router, the social icons are gone, and the layout is a compact centred stack (brand, one wrapping row of links, credits) while
// keeping the original radial-gradient background and hairline borders.
import { Link } from "react-router";

const linkClass = "text-sm duration-200 hover:text-foreground hover:underline";

export function MinimalFooter({ brand, tagline, links = [], bottom }) {
  return (
    <footer className="relative">
      <div className="bg-[radial-gradient(35%_80%_at_50%_0%,--theme(--color-foreground/.08),transparent)] mx-auto max-w-6xl md:border-x">
        <div className="bg-border absolute inset-x-0 h-px w-full" />
        <div className="flex flex-col items-center gap-3 px-4 pt-8 pb-5 text-center">
          {brand}
          {tagline && <p className="text-muted-foreground max-w-md text-sm text-balance">{tagline}</p>}
          <nav aria-label="Footer" className="text-muted-foreground flex flex-wrap justify-center gap-x-5 gap-y-1">
            {links.map(({ href, title }) =>
              href.startsWith("/") ? (
                <Link key={title} className={linkClass} to={href}>
                  {title}
                </Link>
              ) : (
                // Off-site pages open in a new tab; a mailto link just opens the mail app.
                <a key={title} className={linkClass} href={href} {...(href.startsWith("http") && { target: "_blank", rel: "noopener noreferrer" })}>
                  {title}
                </a>
              ),
            )}
          </nav>
        </div>
        <div className="bg-border absolute inset-x-0 h-px w-full" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-1 px-4 pt-3 pb-5 text-center">{bottom}</div>
      </div>
    </footer>
  );
}
