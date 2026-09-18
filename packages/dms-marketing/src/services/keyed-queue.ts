/**
 * Serializes async work per key: a task chains behind whatever task currently
 * holds its key, keys never wait on each other, and an entry self-cleans once
 * its chain drains — the map only holds keys with work in flight.
 */
export class KeyedQueue {
  private pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const tail = this.pending.get(key);
    const chained = tail ? tail.catch(() => undefined).then(task) : task();
    const tracked = chained.finally(() => {
      if (this.pending.get(key) === tracked) {
        this.pending.delete(key);
      }
    });
    this.pending.set(key, tracked);
    return tracked;
  }
}
