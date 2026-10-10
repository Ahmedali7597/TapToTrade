import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { MotionConfig } from "motion/react";
import App from "@/App";
import { AuthProvider } from "@/lib/auth";
import { useDisplay } from "@/lib/display";
import "@/index.css";

/** Motion animations follow the device's "reduce motion" setting, or the site's own Reduce motion switch. */
function Motion({ children }) {
  const [{ motion }] = useDisplay();
  return <MotionConfig reducedMotion={motion === "reduce" ? "always" : "user"}>{children}</MotionConfig>;
}

// App entry point. The router and auth context wrap everything so any page can read the URL and the user.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Motion>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </Motion>
  </StrictMode>,
);
