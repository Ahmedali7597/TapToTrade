import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn helper: join class names and let later Tailwind classes override earlier ones.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
