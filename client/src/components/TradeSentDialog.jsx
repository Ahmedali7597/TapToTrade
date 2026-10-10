import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TapToTradeLogo from "@/components/TapToTradeLogo";

/**
 * The "tap to trade" moment: after a proposal or counter-offer is sent, the arrow makes its full turn and
 * "To Trade" slides out. It plays once (a new key remounts it); reduced-motion users see the finished logo.
 * Tapping the logo replays it. Nothing waits on the animation: both actions are usable immediately.
 */
export default function TradeSentDialog({ trade, counter = false, onClose }) {
  // Bumping the key remounts the logo, which replays it.
  const [replays, setReplays] = useState(0);
  if (!trade) return null;
  const to = trade.receiver;
  // Closing the dialog any way (X, Esc, clicking outside) calls onClose.
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="trade-sent-dialog">
        {/* Solid stage in the accent colour; index.css gives the dialog logo the same --ttt-surface, so the
            arrow's opaque backing circle is invisible in both themes. The whole stage is the replay button:
            tap the logo to watch it again. */}
        <button
          type="button"
          onClick={() => setReplays((n) => n + 1)}
          aria-label="Replay animation"
          title="Tap to replay"
          className="pocket flex w-full cursor-pointer justify-center overflow-hidden bg-accent py-6 transition-transform duration-200 hover:scale-[1.01] active:scale-[0.98]"
        >
          <TapToTradeLogo key={replays} replay={replays > 0} className="ttt-logo--dialog pointer-events-none" />
        </button>
        <DialogHeader>
          <DialogTitle>{counter ? "Counter-offer sent" : "Trade request sent"}</DialogTitle>
          <DialogDescription>
            {`${to.username} in ${to.city} can now accept, decline or counter. `}
            Accepting means you've both agreed to arrange a meetup, not that the trade is complete, and listed stock can
            still change until you meet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep browsing
          </Button>
          <Button asChild>
            <Link to={`/trades/${trade.id}`}>View proposal</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
