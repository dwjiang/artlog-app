import { getLocales } from "expo-localization";

import { getSetting, setSetting } from "@/db/repos/settings";

export type MeasurementUnits = "metric" | "imperial";
const KEY = "measurement-units";
const listeners = new Set<(units: MeasurementUnits) => void>();

/** The iPhone's Measurement System; the UK system gives road distances in miles. */
export function deviceMeasurementUnits(): MeasurementUnits {
  const system = getLocales()[0]?.measurementSystem;
  return system === "us" || system === "uk" ? "imperial" : "metric";
}

export async function getMeasurementUnits(): Promise<MeasurementUnits> {
  const saved = await getSetting(KEY);
  return saved === "metric" || saved === "imperial" ? saved : deviceMeasurementUnits();
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
