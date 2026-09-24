import { useEffect, useState } from "react";

import { getMeasurementUnits, subscribeMeasurementUnits, type MeasurementUnits } from "./measurement-units";

export function useMeasurementUnits() {
  const [state, setState] = useState<{
    units?: MeasurementUnits;
    failed: boolean;
  }>({
    failed: false,
  });
  useEffect(() => {
    let reading = true;
    const unsubscribe = subscribeMeasurementUnits((units) => {
      reading = false;
      setState({ units, failed: false });
    });
    void getMeasurementUnits().then(
      (units) => {
        if (reading) setState({ units, failed: false });
      },
      () => {
        if (reading) setState({ failed: true });
      },
    );
    return () => {
      reading = false;
      unsubscribe();
    };
  }, []);
  return state;
}
