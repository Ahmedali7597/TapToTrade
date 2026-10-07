import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/common";
import { useDisplay } from "@/lib/display";

// The choices offered in the Settings card. Saved on this device (no account needed).
const THEMES = [
  { value: "system", label: "Match my device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const TEXT_SIZES = [
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];
// On/off choices: the value each one takes when on.
const TOGGLES = [
  { key: "motion", on: "reduce", label: "Reduce motion", hint: "Stops the scrolling film, card rows, foil shimmer and other animations." },
  { key: "contrast", on: "more", label: "Higher contrast", hint: "Darker text and stronger outlines." },
  { key: "links", on: "underline", label: "Underline links", hint: "Makes every link easy to spot." },
];

/**
 * Header button that flips between light and dark. The sun shows in light mode and the moon in dark mode; the
 * label says what a click does. "Match my device" and the accessibility options live in Settings.
 */
export function ThemeToggle() {
  const [, set] = useDisplay();
  // The theme on screen right now (a "system" choice already resolved by theme-init).
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button variant="ghost" size="icon" className="relative" aria-label={label} title={label} onClick={() => set("theme", dark ? "light" : "dark")}>
      <Sun className="scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90" aria-hidden="true" />
      <Moon className="absolute scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0" aria-hidden="true" />
    </Button>
  );
}

/** The same choices as a Settings card, with a line of explanation for each. */
export function DisplaySettings() {
  const [d, set] = useDisplay();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display and accessibility</CardTitle>
        <CardDescription>Saved on this device, so they also work when you're signed out. The sun and moon button in the header switches between light and dark.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-md gap-5">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" aria-hidden="true">
            Theme
          </span>
          <SegmentedControl label="Theme" value={d.theme} onChange={(v) => set("theme", v)} options={THEMES} className="flex-wrap" />
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" aria-hidden="true">
            Text size
          </span>
          <SegmentedControl label="Text size" value={d.text} onChange={(v) => set("text", v)} options={TEXT_SIZES} />
        </div>
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex items-start justify-between gap-4">
            <Label htmlFor={`display-${t.key}`} className="grid gap-1 font-normal">
              <span className="font-medium">{t.label}</span>
              <span className="text-sm text-muted-foreground">{t.hint}</span>
            </Label>
            <Switch id={`display-${t.key}`} checked={d[t.key] === t.on} onCheckedChange={(on) => set(t.key, on ? t.on : "default")} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
