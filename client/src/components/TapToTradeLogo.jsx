import { useState } from "react";

/**
 * Tap to Trade logo: the curved arrow is the visual "Tap", followed by "To Trade".
 * Styles and the 2.3 s sequence live in /brand/taptotrade-logo.css (linked in index.html).
 * Include <BrandCredit /> once in the page footer when displaying this artwork (CC BY 3.0).
 * Clicking the logo replays the sequence (even a static one). A click is an explicit choice, so it also plays
 * for reduced-motion users. Callers can still force a replay by changing the key and passing replay={true}.
 */
export default function TapToTradeLogo({ animate = true, replay = false, className = "" }) {
  // Each click bumps the counter, which changes the key below and restarts the animation.
  const [clicks, setClicks] = useState(0);
  const playing = animate || clicks > 0;
  const classes = [
    "ttt-logo",
    playing ? "ttt-logo--animated" : "ttt-logo--still",
    (replay || clicks > 0) && "ttt-logo--replay",
    className,
  ];
  return (
    <span className={classes.filter(Boolean).join(" ")} role="img" aria-label="Tap to Trade" onClick={() => setClicks((n) => n + 1)}>
      {/* A new key remounts the row, which restarts every CSS animation inside it. */}
      <span className="ttt-logo__row" aria-hidden="true" key={clicks}>
        <span className="ttt-logo__mark">
          <img src="/brand/curved-arrow.svg" alt="" width="100" height="100" />
        </span>
        <span className="ttt-logo__window">
          <span className="ttt-logo__words">
            To <span className="ttt-logo__trade">Trade</span>
          </span>
        </span>
      </span>
    </span>
  );
}
