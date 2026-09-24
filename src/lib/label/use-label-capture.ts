import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect } from "react";

import { captureQuery } from "@/db/repos/pending-scans";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

export function useLabelCapture(scanId: string) {
  const owner = useLocalOwner();
  const { data, error } = useLiveQuery(captureQuery(scanId, owner), [scanId, owner]);
  useEffect(() => {
    if (error) reportError(error, "label.load_capture");
  }, [error]);
  return data.find((row) => row.owner === owner);
}
