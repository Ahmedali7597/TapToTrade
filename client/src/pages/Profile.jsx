import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Car, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorAlert, PageMessage, Reputation, Spinner, StoreBadge, useApi } from "@/components/common";
import ReportDialog from "@/components/ReportDialog";
import { useAuth } from "@/lib/auth";
import { distanceLabel, ListingCard, RequestTradeButton } from "@/components/ListingCard";
import { profileTitle } from "@shared/pages";

/** Public profile (4.2.1): username, chosen city, trade record and intentionally shared inventory. Nothing else. */
export default function Profile() {
  const { username } = useParams();
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi(`/users/${encodeURIComponent(username)}`);
  const name = data?.user.username;
  useEffect(() => {
    if (name) document.title = profileTitle(name);
  }, [name]);

  if (loading) return <Spinner label="Loading profile" />;
  if (error?.status === 404) return <PageMessage title="Player not found" body="This profile doesn't exist or isn't available." />;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-10"><ErrorAlert error={error} onRetry={reload} /></div>;

  const { user, inventory } = data;
  // On your own profile, show a settings link instead of report and trade buttons. Visitors can't report.
  const isMe = me?.id === user.id;
  const ids = inventory.map((i) => i.printing.id);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary text-2xl font-bold uppercase text-primary-foreground" aria-hidden="true">
          {user.username.slice(0, 2)}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{user.username}</h1>
            <StoreBadge store={user.store} />
          </div>
          <p className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-4" aria-hidden="true" /> {user.city} · member since{" "}
            {new Date(user.memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <Reputation reputation={user.reputation} />
          {(user.travelKm || (!isMe && distanceLabel(user.distanceKm))) && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Car className="size-4" aria-hidden="true" />
              {[user.travelKm && `Meets up within ${user.travelKm} km`, !isMe && distanceLabel(user.distanceKm)].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {isMe ? (
          <Button asChild variant="outline">
            <Link to="/settings">Account settings</Link>
          </Button>
        ) : (
          me && <ReportDialog user={user} />
        )}
      </div>

      <h2 className="mb-4 text-xl font-semibold">Shared inventory ({inventory.length})</h2>
      {inventory.length === 0 ? (
        <EmptyState title="No shared cards yet" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {inventory.map((item) => (
            <li key={item.id}>
              <ListingCard
                item={item}
                siblings={ids}
                action={
                  isMe ? null : (
                    // Wraps onto two lines when the card is narrow (two columns on a phone).
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="min-w-32 flex-1">
                        <RequestTradeButton owner={user} item={item} />
                      </div>
                      {me && <ReportDialog user={user} item={item} triggerLabel="Report" />}
                    </div>
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
