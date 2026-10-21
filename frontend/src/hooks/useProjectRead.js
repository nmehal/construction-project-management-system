import { useEffect, useState } from 'react';

// Shared read-only loading lifecycle; never show a previous project's data.
export default function useProjectRead(loader, projectId) {
  const [state, setState] = useState({ projectId: null, data: null, loading: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ projectId, data: null, loading: true, error: '' });
    loader(projectId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ projectId, data, loading: false, error: '' });
    }).catch((failure) => {
      if (!controller.signal.aborted) setState({ projectId, data: null, loading: false,
        error: failure.status === 403 ? 'Access denied. You do not have permission to view this project.' : failure.message || 'Unable to load project data.',
      });
    });
    return () => controller.abort();
  }, [loader, projectId, attempt]);
  return { ...state, data: state.projectId === projectId ? state.data : null,
    loading: state.projectId !== projectId || state.loading, retry: () => setAttempt((value) => value + 1) };
}
