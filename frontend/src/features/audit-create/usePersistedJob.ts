import { useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Keep immediate submission state and a reloadable address for the same job. */
export function usePersistedJob(parameter = "job") {
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobId, setActiveJobId] = useState(searchParams.get(parameter) || undefined);
  function setJobId(value: string | undefined) {
    setActiveJobId(value);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(parameter, value);
        else next.delete(parameter);
        return next;
      },
      { replace: true },
    );
  }
  return [jobId, setJobId] as const;
}
