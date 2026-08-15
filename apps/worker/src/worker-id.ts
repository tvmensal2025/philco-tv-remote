import { hostname } from 'node:os';

export const workerId = `${hostname()}-${process.pid}`;
