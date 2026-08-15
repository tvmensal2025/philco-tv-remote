import { Semaphore, createCircuit } from './concurrency.js';
import { config } from '../config.js';

export const visionSlot = new Semaphore(config.VISION_MAX_CONCURRENCY);
export const yoloSlot = new Semaphore(config.YOLO_MAX_CONCURRENCY);
export const ffmpegSlot = new Semaphore(config.FFMPEG_MAX_PROCESSES);
export const yoloCircuit = createCircuit({ failureThreshold: 5, resetMs: 30_000 });
export const visionCircuit = createCircuit({ failureThreshold: 5, resetMs: 30_000 });
