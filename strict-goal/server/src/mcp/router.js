export function createRouter() {
  const handlers = new Map();
  return {
    register(method, handler) {
      handlers.set(method, handler);
    },
    dispatch(request) {
      const handler = handlers.get(request.method);
      if (!handler) {
        return { error: { code: -32601, message: `Method not found: ${request.method}` } };
      }
      try {
        const result = handler(request.params ?? {});
        return { result };
      } catch (err) {
        return { error: { code: err.rpcCode ?? -32603, message: err.message } };
      }
    },
  };
}
