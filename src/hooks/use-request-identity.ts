"use client";
import { useCallback, useLayoutEffect, useRef } from 'react';

/** Invalidate old requests on selection changes, unmount, or a newer request. */
export function useRequestIdentity(key: string | undefined) {
  const epoch = useRef({ version: 0, key });
  useLayoutEffect(() => {
    const state = epoch.current;
    state.key = key;
    state.version++;
    return () => { state.version++; };
  }, [key]);
  return useCallback(() => {
    if (epoch.current.key !== key) return () => false;
    const ticket = ++epoch.current.version;
    return () => ticket === epoch.current.version;
  }, [key]);
}
