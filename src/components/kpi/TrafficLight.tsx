interface TrafficLightProps {
  current: number;
  target: number;
  higherIsBetter: boolean;
  effectiveRatio?: number;
}

export default function TrafficLight({
  current,
  target,
  higherIsBetter,
  effectiveRatio,
}: TrafficLightProps) {
  if (!target || target === 0) {
    return null;
  }

  const ratio =
    effectiveRatio ?? (higherIsBetter ? current / target : target / current);

  let color: string;
  let label: string;
  if (ratio >= 0.9) {
    color = "bg-[var(--green)]";
    label = "On track";
  } else if (ratio >= 0.6) {
    color = "bg-[var(--amber)]";
    label = "At risk";
  } else {
    color = "bg-[var(--red)]";
    label = "Off track";
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${color}`} />
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
    </div>
  );
}
