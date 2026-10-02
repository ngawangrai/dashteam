"use client";

import { useId } from "react";

type Option<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  name: string;
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A small set of choices shown side by side, like iOS. Native radios, so keyboard and forms just work. */
export function SegmentedControl<T extends string>({ name, label, options, value, onChange }: SegmentedControlProps<T>) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-secondary font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-control bg-fill p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-10 cursor-pointer items-center justify-center rounded-[7px] px-3 text-secondary font-medium text-label-secondary transition-colors duration-150 has-checked:bg-segment has-checked:text-label has-focus-visible:outline-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
