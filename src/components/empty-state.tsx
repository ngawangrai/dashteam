import type { LucideIcon } from "lucide-react";
import { Icon } from "./icon";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  message: string;
};

export function EmptyState({ icon, title, message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Icon icon={icon} size={32} className="text-label-secondary" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-semibold text-balance">{title}</p>
        <p className="text-secondary text-pretty text-label-secondary">{message}</p>
      </div>
    </div>
  );
}
