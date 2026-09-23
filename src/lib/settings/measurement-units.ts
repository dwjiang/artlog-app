import { getSetting, setSetting } from "@/db/repos/settings";

export type MeasurementUnits = "metric" | "imperial";
const KEY = "measurement-units";
const listeners = new Set<(units: MeasurementUnits) => void>();

export async function getMeasurementUnits(): Promise<MeasurementUnits> {
  return (await getSetting(KEY)) === "imperial" ? "imperial" : "metric";
}

export async function setMeasurementUnits(units: MeasurementUnits): Promise<void> {
  await setSetting(KEY, units);
  for (const listener of listeners) listener(units);
}

export function subscribeMeasurementUnits(listener: (units: MeasurementUnits) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
