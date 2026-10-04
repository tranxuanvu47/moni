export function createSubmitGuard() {
  let pending = false;

  return {
    async run<T>(work: () => Promise<T>): Promise<T | undefined> {
      if (pending) {
        return undefined;
      }
      pending = true;
      try {
        return await work();
      } finally {
        pending = false;
      }
    },
  };
}
