"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/** Tab-lifetime drafts. Each setter stays bound to its original conversation,
 * including when an async send completes after the operator switches threads. */
export function useConversationState<T>(key: string | undefined, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [values, setValues] = useState<Record<string, T>>({});
  const [fallback] = useState(initial);
  const scope = key ?? '';
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setValues(previous => ({ ...previous, [scope]: typeof update === 'function'
      ? (update as (value: T) => T)(previous[scope] ?? fallback) : update }));
  }, [scope, fallback]);
  return [values[scope] ?? fallback, set];
}
