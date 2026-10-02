import { ChevronsUpDown, CircleAlert } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Icon } from "./icon";

// Form fields: a visible label above, the hint or error below, tied together for screen readers.

export const controlClass =
  "min-h-11 w-full rounded-control bg-fill px-3 text-body text-label placeholder:text-label-secondary aria-invalid:outline-2 aria-invalid:outline-danger disabled:opacity-60";

type FieldShellProps = { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode };

export function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-secondary font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-secondary text-danger">
          <Icon icon={CircleAlert} size={16} className="mt-0.5 shrink-0" />
          <span className="text-pretty">{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-secondary text-pretty text-label-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; hint?: ReactNode; error?: string };

export function TextField({ name, label, hint, error, className = "", id = name, ...props }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass} ${className}`}
        {...props}
      />
    </FieldShell>
  );
}

/** An amount in ngultrum. Typed as text so "1,25,000" works; shown with tabular figures. */
export function MoneyField(props: Omit<TextFieldProps, "inputMode" | "type">) {
  return <TextField inputMode="decimal" autoComplete="off" placeholder="0" className="tabular" {...props} />;
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
};

export function SelectField({ name, label, hint, error, options, placeholder, id = name, ...props }: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {/* Safari ignores a native select's height, so it is drawn like the other fields, with its own chevron. */}
      <div className="relative">
        <select
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={`${controlClass} appearance-none pr-10`}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon icon={ChevronsUpDown} size={18} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-label-secondary" />
      </div>
    </FieldShell>
  );
}

export function FormMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-secondary text-danger">
      <Icon icon={CircleAlert} size={16} className="mt-0.5 shrink-0" />
      <span className="text-pretty">{message}</span>
    </p>
  );
}
