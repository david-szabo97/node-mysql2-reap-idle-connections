import { it, expect, jest } from "@jest/globals";
import { EventEmitter } from "stream";
import { Pool, PoolConnection } from "mysql2";
import { Mysql2PoolReapIdleConnections } from "../src/mysql2-pool-reap-idle-connections";
import Denque from "denque";
import { PoolConnectionExposed, PoolExposed } from "../src/mysql2-private-exposed-types";

jest.useFakeTimers();

const createFakePool = () => {
  const fakePool: any = new EventEmitter();
  fakePool._freeConnections = new Denque();
  return fakePool as Pool;
};

const createFakeConnection = () => {
  const fakeConnection: any = new EventEmitter();
  fakeConnection.stream = new EventEmitter();
  return fakeConnection as PoolConnectionExposed;
};

const emitFakeConnection = (pool: Pool) => {
  const connection = createFakeConnection();
  connection.destroy = () => {
    pool.emit("end", connection);
  };
  pool.emit("connection", connection);
  (pool as PoolExposed)._freeConnections.push(connection);
  return connection;
};

const emitFakeAcquire = (pool: Pool, connection: PoolConnection) => pool.emit("acquire", connection);

it("should attach event listeners to pool when start is called", () => {
  const fakePool = createFakePool();
  const reaper = new Mysql2PoolReapIdleConnections(fakePool);
  expect(fakePool.listenerCount("connection")).toStrictEqual(0);
  expect(fakePool.listenerCount("acquire")).toStrictEqual(0);

  reaper.start();

  expect(fakePool.listenerCount("connection")).toStrictEqual(2);
  expect(fakePool.listenerCount("acquire")).toStrictEqual(1);

  reaper.stop();
});

it("should remove event listeners from pool when stop is called", () => {
  const fakePool = createFakePool();
  const reaper = new Mysql2PoolReapIdleConnections(fakePool);

  reaper.start();
  reaper.stop();

  expect(fakePool.listenerCount("connection")).toStrictEqual(0);
  expect(fakePool.listenerCount("acquire")).toStrictEqual(0);
});

it("should attach event listeners to pool connection", () => {
  const fakePool = createFakePool();
  const reaper = new Mysql2PoolReapIdleConnections(fakePool);

  reaper.start();
  const connection = emitFakeConnection(fakePool);
  expect(connection.stream.listenerCount("end")).toStrictEqual(1);
  reaper.stop();
});

it("should remove event listeners from pool connections when stop is called", () => {
  const fakePool = createFakePool();
  const reaper = new Mysql2PoolReapIdleConnections(fakePool);

  reaper.start();
  const connection1 = emitFakeConnection(fakePool);
  const connection2 = emitFakeConnection(fakePool);
  reaper.stop();

  expect(connection1.stream.listenerCount("end")).toStrictEqual(0);
  expect(connection2.stream.listenerCount("end")).toStrictEqual(0);
});

it("should reap idle connections", () => {
  const fakePool = createFakePool();
  const reaper = new Mysql2PoolReapIdleConnections(fakePool, { idleTimeout: 3000, reapInterval: 1000 });
  reaper.start();
  const reapListener = jest.fn();
  reaper.on("reap", reapListener);

  const connection1 = emitFakeConnection(fakePool);
  const connection2 = emitFakeConnection(fakePool);

  jest.spyOn(Date, "now").mockImplementation(() => 1000);
  emitFakeAcquire(fakePool, connection1);
  jest.spyOn(Date, "now").mockImplementation(() => 5000);
  emitFakeAcquire(fakePool, connection2);
  jest.runOnlyPendingTimers();

  expect(reapListener).toBeCalledWith(connection1);

  reaper.stop();
  (Date.now as any).mockRestore();
});
