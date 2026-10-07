import { useLayoutEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ChevronDown, MailCheck, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MinimalFooter } from "@/components/ui/minimal-footer";
import BrandCredit from "@/components/BrandCredit";
import { ThemeToggle } from "@/components/DisplayMenu";
import { CardViewerProvider } from "@/components/CardDetails";
import TapToTradeLogo from "@/components/TapToTradeLogo";
import { useAuth } from "@/lib/auth";
import { ResendLink } from "@/components/AccountFields";
import { cn } from "@/lib/utils";
import { EMAILS, pageTitle } from "@shared/pages";

// Footer links. Contact opens an email to hello@; the last two point off-site for card data credit and the WotC
// fan content policy.
const FOOTER_LINKS = [
  { title: "Search cards", href: "/search" },
  { title: "Card browser", href: "/cards" },
  { title: "Game stores", href: "/stores" },
  { title: "Inventory", href: "/inventory" },
  { title: "Want list", href: "/wants" },
  { title: "Trades", href: "/trades" },
  { title: "Account", href: "/settings" },
  { title: "Suggestions", href: "/suggestions" },
  { title: "Privacy", href: "/privacy" },
  { title: "Terms", href: "/terms" },
  { title: "Accessibility", href: "/terms#accessibility" },
  { title: "Contact", href: `mailto:${EMAILS.hello}` },
  { title: "Scryfall", href: "https://scryfall.com" },
  { title: "Fan Content Policy", href: "https://company.wizards.com/en/legal/fancontentpolicy" },
];

// Header links depend on who's signed in: the public pages for visitors, extra pages for staff.
function navItems(user) {
  if (!user) {
    return [
      { to: "/search", label: "Search" },
      { to: "/cards", label: "Cards" },
      { to: "/stores", label: "Stores" },
    ];
  }
  return [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/search", label: "Search" },
    { to: "/cards", label: "Cards" },
    { to: "/inventory", label: "Inventory" },
    { to: "/wants", label: "Wants" },
    { to: "/trades", label: "Trades" },
    { to: "/stores", label: "Stores" },
    ...(["moderator", "admin"].includes(user.role) ? [{ to: "/moderation", label: "Moderation" }] : []),
    ...(user.role === "admin" ? [{ to: "/admin", label: "Admin" }] : []),
  ];
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = navItems(user);
  // Keep the tab title in step when moving between pages without a reload (the server sets it on first load).
  // A layout effect runs before the page's own effects, so a page that knows a better title (a profile, a store,
  // the 404 page) can still set it afterwards.
  useLayoutEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);

  // Log out and land on the home page.
  const signOut = async () => {
    await logout();
    navigate("/");
  };

  return (
    <CardViewerProvider>
      <div className="flex min-h-svh flex-col">
        {/* Hidden until focused, so keyboard users can skip past the header. */}
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
            <Link to="/" className="shrink-0 rounded-md" aria-label="Tap to Trade home">
              {/* Motion runs once on entry; the layout never remounts on navigation (section 10.8). */}
              <TapToTradeLogo className="ttt-logo--sm" />
            </Link>

            {/* Desktop nav. On small screens the same links live in the menu button on the right. */}
            <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "relative rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
                      // Current page: a teal index tab along the bottom edge of the header.
                      "after:absolute after:inset-x-3 after:-bottom-[13px] after:h-[3px] after:rounded-t-full after:bg-primary after:opacity-0 after:transition-opacity",
                      isActive && "text-foreground after:opacity-100",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <ThemeToggle />
              {/* user is undefined while loading, so neither set of buttons flashes before we know. */}
              {/* Phone and tablet nav: the same links as the desktop bar, in a menu. */}
              {user !== undefined && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant={user ? "outline" : "ghost"} size="icon" className="lg:hidden" aria-label="Open navigation">
                      <Menu />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 lg:hidden">
                    {items.map((item) => (
                      <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                    {/* Phones narrower than 430px have no room for "Log in" beside the logo, so it lives here. */}
                    {!user && (
                      <DropdownMenuItem className="min-[430px]:hidden" onSelect={() => navigate("/login")}>
                        Log in
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {user === null && (
                <>
                  {/* Hidden on phones to keep the header on one line; it's in the menu, and sign-up links to log-in. */}
                  <Button asChild variant="ghost" size="sm" className="max-[429px]:hidden">
                    <Link to="/login">Log in</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link to="/register">
                      {/* Shorter on phones so the header fits on one line beside the logo. */}
                      <span className="sm:hidden">Sign up</span>
                      <span className="hidden sm:inline">Create account</span>
                    </Link>
                  </Button>
                </>
              )}
              {user && (
                <>
                  {/* Account menu: initials avatar, profile, settings and log out. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      {/* On phones only the initials show, so the label carries the name for screen readers. */}
                      <Button variant="ghost" size="sm" className="gap-1" aria-label={`Account menu, ${user.username}`}>
                        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold uppercase text-primary-foreground" aria-hidden="true">
                          {user.username.slice(0, 2)}
                        </span>
                        <span className="hidden sm:inline">{user.username}</span>
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="font-normal">
                        <span className="block font-semibold">{user.username}</span>
                        <span className="text-xs text-muted-foreground">{user.city}</span>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => navigate(`/u/${user.username}`)}>Public profile</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => navigate("/settings")}>Account settings</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => navigate("/suggestions")}>Send a suggestion</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={signOut}>Log out</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Until the email is confirmed (needed to send trade requests), a quiet reminder under the header. */}
        {user && !user.emailVerified && pathname !== "/verify-email" && (
          <div className="border-b bg-muted/60" data-testid="confirm-email-banner">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
              <MailCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">Confirm your email</span> to start sending trade requests. We sent a link to{" "}
                <span className="font-medium break-all">{user.email}</span>.
              </p>
              <ResendLink size="sm" />
            </div>
          </div>
        )}

        {/* The current page renders here, easing in on each new page. */}
        <main id="main" key={pathname} className="page-in flex-1">
          <Outlet />
        </main>

        <MinimalFooter
          brand={
            <Link to="/" className="w-max" aria-label="Tap to Trade home">
              <TapToTradeLogo animate={false} className="ttt-logo--sm" />
            </Link>
          }
          tagline="Local Magic: The Gathering trading. Find the card, tap to trade, meet somewhere public."
          links={FOOTER_LINKS}
          bottom={
            <div className="grid gap-0.5 text-xs text-muted-foreground">
              <BrandCredit />
              <p className="ttt-credit">
                Card data and images from{" "}
                <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
                  Scryfall
                </a>
                . Tap to Trade is unofficial Fan Content permitted under the{" "}
                <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener noreferrer">
                  Fan Content Policy
                </a>
                . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
              </p>
              <p className="ttt-credit">Hero film by Ahmed Ali · © {new Date().getFullYear()} Tap to Trade</p>
            </div>
          }
        />
      </div>
    </CardViewerProvider>
  );
}
