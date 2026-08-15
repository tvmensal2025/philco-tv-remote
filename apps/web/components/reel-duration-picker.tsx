'use client';

import { reelDurationPresets, type ReelDurationPreset } from '@reelops/shared';

export type ReelDurationChoice = 'ai' | ReelDurationPreset;

const options: Array<{ value: ReelDurationChoice; label: string }> = [
  { value: 'ai', label: 'IA escolhe' },
  ...reelDurationPresets.map((seconds) => ({
    value: seconds,
    label: `${seconds}s`,
  })),
];

export function ReelDurationPicker({
  value,
  onChange,
}: {
  value: ReelDurationChoice;
  onChange: (value: ReelDurationChoice) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border bg-background p-1">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            className={`h-9 rounded-lg px-3 text-sm font-medium ${
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
