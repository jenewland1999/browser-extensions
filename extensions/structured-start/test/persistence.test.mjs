import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStorageFits,
  PersistenceCoordinator,
  serializedStorageBytes,
} from "../dist/persistence.js";

function harness(initial = { revision: 0, data: "initial" }) {
  let stored = initial;
  let failWrites = 0;
  let clears = 0;
  const writes = [];
  const applied = [];
  const errors = [];
  let conflicts = 0;
  const coordinator = new PersistenceCoordinator({
    revision: initial.revision,
    read: async () => stored,
    write: async (value) => {
      if (failWrites > 0) {
        failWrites -= 1;
        throw new Error("write failed");
      }
      stored = value;
      writes.push(value);
    },
    clear: async () => {
      clears += 1;
      stored = { revision: 0, data: "cleared" };
    },
    withLock: async (callback) => callback(),
    applyExternal: (value) => applied.push(value),
    reportConflict: () => {
      conflicts += 1;
    },
    reportError: (error) => errors.push(error),
  });
  return {
    coordinator,
    writes,
    applied,
    errors,
    get conflicts() {
      return conflicts;
    },
    get clears() {
      return clears;
    },
    setStored(value) {
      stored = value;
    },
    failNextWrite() {
      failWrites += 1;
    },
  };
}

test("stale queued snapshots cannot overwrite the conflicting external revision", async () => {
  const state = harness();
  state.setStored({ revision: 1, data: "external" });
  await Promise.all([state.coordinator.save("stale one"), state.coordinator.save("stale two")]);

  assert.equal(state.conflicts, 1);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.applied, [{ revision: 1, data: "external" }]);
});

test("a failed write reports its error and later saves still run", async () => {
  const state = harness();
  state.failNextWrite();

  await assert.doesNotReject(state.coordinator.save("fails"));
  await assert.doesNotReject(state.coordinator.save("succeeds"));

  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0].message, /write failed/);
  assert.deepEqual(state.writes, [{ revision: 1, data: "succeeds" }]);
});

test("pending saves apply only the newest deferred external event", async () => {
  let releaseLock;
  const lockGate = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const applied = [];
  let stored = { revision: 0, data: "initial" };
  const coordinator = new PersistenceCoordinator({
    revision: 0,
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    clear: async () => {},
    withLock: async (callback) => {
      await lockGate;
      return callback();
    },
    applyExternal: (value) => applied.push(value),
    reportConflict: () => {},
    reportError: assert.fail,
  });

  const save = coordinator.save("local");
  coordinator.receiveExternal({ revision: 1, data: "older external" });
  stored = { revision: 2, data: "newest external" };
  coordinator.receiveExternal(stored);
  releaseLock();
  await save;

  assert.deepEqual(applied, [{ revision: 2, data: "newest external" }]);
});

test("reset invalidates queued and intervening saves before clearing", async () => {
  let releaseLock;
  const lockGate = new Promise((resolve) => {
    releaseLock = resolve;
  });
  let firstLock = true;
  let clears = 0;
  const state = harness();
  state.coordinator = new PersistenceCoordinator({
    revision: 0,
    read: async () => ({ revision: 0, data: "initial" }),
    write: async (value) => state.writes.push(value),
    clear: async () => {
      clears += 1;
    },
    withLock: async (callback) => {
      if (firstLock) {
        firstLock = false;
        await lockGate;
      }
      return callback();
    },
    applyExternal: () => {},
    reportConflict: () => {},
    reportError: (error) => state.errors.push(error),
  });

  const queued = state.coordinator.save("queued before reset");
  const reset = state.coordinator.reset();
  await state.coordinator.save("attempted during reset");
  releaseLock();
  assert.equal(await reset, true);
  await queued;

  assert.deepEqual(state.writes, []);
  assert.equal(clears, 1);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0].message, /being reset/);
});

test("aggregate storage size uses serialized UTF-8 bytes and rejects oversized writes", () => {
  assert.equal(serializedStorageBytes({ icon: "😀" }), 15);
  const fitting = { otherSetting: "1234", layout: "12" };
  const maximum = serializedStorageBytes(fitting);
  assert.doesNotThrow(() => assertStorageFits(fitting, maximum));
  assert.throws(
    () => assertStorageFits({ otherSetting: "1234", layout: "123" }, maximum),
    /exceeding the 0 MB limit.*Remove some uploaded images/,
  );
});
