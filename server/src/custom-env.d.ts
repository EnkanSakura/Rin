import type { QueueTask } from "./queue";

declare global {
  interface Env {
    TASK_QUEUE?: Queue<QueueTask>;
    R2_BUCKET?: R2Bucket;
    /** 站点公开访问地址（可选）。未设置时 sitemap/robots 回退到请求来源 origin */
    FRONTEND_URL?: string;
    /**
     * 本地开发用的出站转发地址（由 `bun dev` 写入 .dev.vars）。
     * workerd 的 fetch 不读取 HTTP_PROXY，设置后工具类出站请求会经由该本地中继转发。
     */
    DEV_FETCH_RELAY?: string;
  }
}

export {};