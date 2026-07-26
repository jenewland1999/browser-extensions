export const STORAGE_QUOTA_BYTES = 10_485_760;

export interface Revisioned<T> {
  revision: number;
  data: T;
}

interface PersistenceOptions<T> {
  revision: number;
  read: () => Promise<Revisioned<T> | undefined>;
  write: (value: Revisioned<T>) => Promise<void>;
  clear: () => Promise<void>;
  withLock: <Result>(callback: () => Promise<Result>) => Promise<Result>;
  applyExternal: (value: Revisioned<T>) => void;
  reportConflict: () => void;
  reportError: (error: unknown) => void;
}

export function serializedStorageBytes(value: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertStorageFits(
  value: Record<string, unknown>,
  maximum = STORAGE_QUOTA_BYTES,
): void {
  const bytes = serializedStorageBytes(value);
  if (bytes > maximum) {
    throw new Error(
      `Tessera needs ${Math.ceil(bytes / 1_000_000)} MB of storage, exceeding the ${Math.floor(maximum / 1_000_000)} MB limit. Remove some uploaded images and try again.`,
    );
  }
}

export class PersistenceCoordinator<T> {
  #revision: number;
  #generation = 0;
  #pending = 0;
  #queue: Promise<void> = Promise.resolve();
  #deferredExternal: Revisioned<T> | undefined;
  #resetting = false;
  readonly #options: PersistenceOptions<T>;

  constructor(options: PersistenceOptions<T>) {
    this.#options = options;
    this.#revision = options.revision;
  }

  setRevision(revision: number): void {
    this.#revision = revision;
  }

  save(snapshot: T): Promise<void> {
    if (this.#resetting) {
      this.#reportError(new Error("Tessera is being reset. This change was not saved."));
      return Promise.resolve();
    }
    const generation = this.#generation;
    this.#pending += 1;
    const attempt = this.#queue.then(() => this.#write(snapshot, generation));
    const settled = attempt.catch((error: unknown) => this.#reportError(error));
    this.#queue = settled.then(() => undefined);
    return settled.finally(() => {
      this.#pending -= 1;
      this.#flushExternal();
    });
  }

  receiveExternal(value: Revisioned<T>): void {
    if (this.#pending > 0 || this.#resetting) {
      this.#deferredExternal = value;
      return;
    }
    this.#acceptExternal(value);
  }

  async reset(): Promise<boolean> {
    if (this.#resetting) return false;
    this.#resetting = true;
    this.#generation += 1;
    this.#deferredExternal = undefined;
    const queued = this.#queue;
    try {
      await queued;
      await this.#options.withLock(async () => {
        await this.#options.clear();
      });
      this.#revision = 0;
      this.#deferredExternal = undefined;
      return true;
    } catch (error) {
      this.#reportError(error);
      return false;
    } finally {
      this.#resetting = false;
      this.#flushExternal();
    }
  }

  async #write(snapshot: T, generation: number): Promise<void> {
    await this.#options.withLock(async () => {
      if (generation !== this.#generation || this.#resetting) return;
      const current = await this.#options.read();
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== this.#revision) {
        this.#generation += 1;
        if (current) this.#deferredExternal = current;
        this.#options.reportConflict();
        return;
      }
      const next = { revision: currentRevision + 1, data: snapshot };
      await this.#options.write(next);
      if (generation === this.#generation && !this.#resetting) this.#revision = next.revision;
    });
  }

  #flushExternal(): void {
    if (this.#pending > 0 || this.#resetting || !this.#deferredExternal) return;
    const value = this.#deferredExternal;
    this.#deferredExternal = undefined;
    this.#acceptExternal(value);
  }

  #acceptExternal(value: Revisioned<T>): void {
    if (value.revision === this.#revision) return;
    this.#generation += 1;
    this.#revision = value.revision;
    this.#options.applyExternal(value);
  }

  #reportError(error: unknown): void {
    try {
      this.#options.reportError(error);
    } catch {
      // Error reporting must never reject the persistence queue.
    }
  }
}
