import { cn } from "@/lib/utils";

/** Official supplied artwork; never replace a member's own profile photo. */
export function BrandLogo({
  variant = "blue",
  className,
}: {
  variant?: "blue" | "color";
  className?: string;
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-${variant}.png`}
      alt="Biz Connect Academy"
      className={cn("shrink-0 object-contain", className)}
      draggable={false}
    />
  );
}
