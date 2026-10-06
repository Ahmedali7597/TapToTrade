import { cn } from "@/lib/utils"

// The scroller is a named group ("group/marquee") so pausing on hover doesn't also count as hovering every card:
// cards use the plain "group" for their own sleeve sheen and lift (index.css).
// `children` can be a function of the copy number (0 = the first copy), so the repeats can stay clickable while
// leaving the keyboard's tab order: whichever copy is on screen, a click works.
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}) {
  return (
    <div
      {...props}
      className={cn(
        "group/marquee flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem]",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className
      )}
    >
      {Array(repeat)
        .fill(0)
        .map((_, i) => (
          // Screen readers hear only the first copy; the rest are visual repeats (still clickable with a mouse or
          // finger, since a moving row mostly shows the repeats).
          <div
            key={i}
            aria-hidden={i > 0 || undefined}
            className={cn("flex shrink-0 justify-around gap-(--gap)", {
              "animate-marquee flex-row": !vertical,
              "animate-marquee-vertical flex-col": vertical,
              "group-hover/marquee:[animation-play-state:paused] group-focus-within/marquee:[animation-play-state:paused]": pauseOnHover,
              "[animation-direction:reverse]": reverse,
            })}
          >
            {typeof children === "function" ? children(i) : children}
          </div>
        ))}
    </div>
  )
}
