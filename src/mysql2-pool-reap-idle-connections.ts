import { EventEmitter } from "events";
import { Pool, PoolConnection } from "mysql2";
import { Pool as PromisePool } from "mysql2/promise";
import { PoolConnectionExposed, PoolExposed, PromisePoolExposed } from "./mysql2-private-exposed-types";

export interface Mysql2PoolReapIdleConnectionsOptions {
  idleTimeout: number;
  reapInterval: number;
}

export class Mysql2PoolReapIdleConnections extends EventEmitter {
  private _pool: Pool;
  private _options: Mysql2PoolReapIdleConnectionsOptions;

  private _connectionsLastUsageTime = new Map();
  private _connectionEndListeners = new Map();

  private _reapIdleConnectionTimeoutHandle: NodeJS.Timeout | undefined;

  constructor(
    pool: Pool | PromisePool,
    options: Mysql2PoolReapIdleConnectionsOptions = {
      idleTimeout: 1000 * 60 * 15,
      reapInterval: 1000,
    }
  ) {
    super();

    this._pool = pool as Pool;
    this._options = options;
  }

  _getPoolFreeConnections() {
    return (this._pool as unknown as PromisePoolExposed).pool
      ? (this._pool as unknown as PromisePoolExposed).pool._freeConnections
      : (this._pool as PoolExposed)._freeConnections;
  }

  _isPoolClosed() {
    return (this._pool as unknown as PromisePoolExposed).pool
      ? (this._pool as unknown as PromisePoolExposed).pool._closed
      : (this._pool as PoolExposed)._closed;
  }

  _getConnectionStream(connection: PoolConnection) {
    return (connection as PoolConnectionExposed).stream;
  }

  _updateConnectionLastUsage = (connection: PoolConnection) => {
    this._connectionsLastUsageTime.set(connection, Date.now());
  };

  _onConnectionEnd = (connection: PoolConnection) => {
    this._connectionsLastUsageTime.delete(connection);
    this._getConnectionStream(connection).off("end", this._connectionEndListeners.get(connection));
    this._connectionEndListeners.delete(connection);
  };

  _attachConnectionEndListener = (connection: PoolConnection) => {
    const bindedOnConnectionEnd = this._onConnectionEnd.bind(null, connection);
    this._connectionEndListeners.set(connection, bindedOnConnectionEnd);
    this._getConnectionStream(connection).once("end", bindedOnConnectionEnd);
  };

  _reapIdleConnections() {
    const connection = this._getPoolFreeConnections().peekAt(0);
    if (!connection) {
      return;
    }

    const lastUsage = this._connectionsLastUsageTime.get(connection);
    if (typeof lastUsage !== "undefined" && Date.now() - lastUsage > this._options.idleTimeout) {
      this.emit("reap", connection);
      connection.destroy();
    }
  }

  _reapIdleConnectionsTimeoutRepeat = () => {
    clearTimeout(this._reapIdleConnectionTimeoutHandle);

    if (!this._isPoolClosed()) {
      this._reapIdleConnections();
    }

    this._reapIdleConnectionTimeoutHandle = setTimeout(
      this._reapIdleConnectionsTimeoutRepeat,
      this._options.reapInterval
    );
  };

  start() {
    this._pool.on("connection", this._updateConnectionLastUsage);
    this._pool.on("connection", this._attachConnectionEndListener);
    this._pool.on("acquire", this._updateConnectionLastUsage);

    this._reapIdleConnectionsTimeoutRepeat();
  }

  stop() {
    this._pool.off("connection", this._updateConnectionLastUsage);
    this._pool.off("connection", this._attachConnectionEndListener);
    this._pool.off("acquire", this._updateConnectionLastUsage);
    for (const [connection, listener] of this._connectionEndListeners.entries()) {
      connection.stream.off("end", listener);
    }

    clearTimeout(this._reapIdleConnectionTimeoutHandle);
  }

  reap() {
    this._reapIdleConnections();
  }
}
