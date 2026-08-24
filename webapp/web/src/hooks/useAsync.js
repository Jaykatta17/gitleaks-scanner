import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Small data-fetching hook: runs the loader, tracks status, and drops results
 * from calls that were superseded or that resolve after unmount.
 */
export const useAsync = (loader, deps = [], { immediate = true } = {}) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loader(...args);
      if (mounted.current && id === requestId.current) setData(result);
      return result;
    } catch (caught) {
      if (mounted.current && id === requestId.current) setError(caught);
      throw caught;
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (immediate) void run().catch(() => {});
  }, [run, immediate]);

  return { data, error, loading, reload: run, setData };
};

export default useAsync;
