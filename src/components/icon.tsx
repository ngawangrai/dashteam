import type { LucideIcon, LucideProps } from "lucide-react";

type IconProps = Omit<LucideProps, "ref"> & { icon: LucideIcon; size?: number };

// One outline set, one stroke weight, decorative by default: icons always sit beside a text label.
export function Icon({ icon: Glyph, size = 20, ...props }: IconProps) {
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" {...props} />;
}
