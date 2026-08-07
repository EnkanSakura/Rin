import type { QueueTask } from "./queue";

declare global {
  interface Env {
    TASK_QUEUE?: Queue<QueueTask>;
    R2_BUCKET?: R2Bucket;
    GIF_PROCESSOR_URL?: string;
    GIF_PROCESSOR_SECRET?: string;
  }
}

export {};