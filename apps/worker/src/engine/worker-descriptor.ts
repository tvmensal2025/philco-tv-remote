import {
  classifyWorkerEnvironment,
  type WorkerCapabilities,
  type WorkerDescriptor,
} from '@reelops/shared';
import { hostname } from 'node:os';
import { config } from '../config.js';
import { workerId } from '../worker-id.js';
import { EDITORIAL_RELEASE } from './editorial-thresholds.js';

export const workerStartedAt = new Date().toISOString();

export function workerCapabilities(): WorkerCapabilities {
  return {
    analysis: true,
    vision: Boolean(config.OPENAI_API_KEY || config.GEMINI_API_KEY),
    ffmpeg: true,
    revideo: config.ENABLE_REVIDEO,
    yolo: Boolean(config.ENABLE_YOLO && config.YOLO_URL),
    tracking: config.ENABLE_TRACKING,
    index: true,
    highlight: true,
    adobe: Boolean(config.ENABLE_ADOBE_DGR && config.ADOBE_CLIENT_ID && config.ADOBE_CLIENT_SECRET),
  };
}

export function workerDescriptor(): WorkerDescriptor {
  const host = hostname();
  return {
    workerId,
    hostname: host,
    environment: classifyWorkerEnvironment(host, config.WORKER_ENVIRONMENT),
    deployment: config.WORKER_DEPLOYMENT,
    version: config.WORKER_VERSION,
    pipelineVersion: config.VIDEO_PIPELINE_VERSION,
    startedAt: workerStartedAt,
    releaseStamp: EDITORIAL_RELEASE,
    gitSha: config.GIT_SHA,
    capabilities: workerCapabilities(),
  };
}
