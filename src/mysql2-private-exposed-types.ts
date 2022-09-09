import Denque from "denque";
import { Pool, PoolConnection } from "mysql2";
import { Pool as PromisePool, PoolConnection as PromisePoolConnection } from "mysql2/promise";
import { Readable } from "stream";

export interface PromisePoolExposed extends PromisePool {
  pool: PoolExposed;
}

export interface PromisePoolConnectionExposed extends PromisePoolConnection {
  stream: Readable;
}

export interface PoolExposed extends Pool {
  _freeConnections: Denque<PoolConnectionExposed>;
  _closed: boolean;
}

export interface PoolConnectionExposed extends PoolConnection {
  stream: Readable;
}
