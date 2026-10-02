import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "plain";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent-fill text-on-accent font-semibold",
  secondary: "bg-fill text-accent font-semibold",
  plain: "text-accent",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

export function Button({ variant = "primary", fullWidth = false, className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-4 text-body",
        "disabled:opacity-50 aria-busy:opacity-70 aria-busy:cursor-progress",
        variants[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
