import { MessagePipeline } from "./messagePipeline";
import { PendingTenantInterceptor } from "./interceptors/pendingTenant.interceptor";
import { AntiDeleteInterceptor } from "./interceptors/antiDelete.interceptor";
import { AntiViewOnceInterceptor } from "./interceptors/antiViewOnce.interceptor";
import { ActivityTrackerInterceptor } from "./interceptors/activityTracker.interceptor";
import { AfkInterceptor } from "./interceptors/afk.interceptor";
import { AntiLinkInterceptor } from "./interceptors/antiLink.interceptor";
import { AntiSpamInterceptor } from "./interceptors/antiSpam.interceptor";
import { InteractiveReplyInterceptor } from "./interceptors/interactiveReply.interceptor";

export * from "./types";
export * from "./messagePipeline";
export * from "./interceptors/pendingTenant.interceptor";
export * from "./interceptors/antiDelete.interceptor";
export * from "./interceptors/antiViewOnce.interceptor";
export * from "./interceptors/activityTracker.interceptor";
export * from "./interceptors/afk.interceptor";
export * from "./interceptors/antiLink.interceptor";
export * from "./interceptors/antiSpam.interceptor";
export * from "./interceptors/interactiveReply.interceptor";

export function createDefaultMessagePipeline(): MessagePipeline {
  return new MessagePipeline([
    new PendingTenantInterceptor(),
    new AntiDeleteInterceptor(),
    new AntiViewOnceInterceptor(),
    new ActivityTrackerInterceptor(),
    new AfkInterceptor(),
    new AntiLinkInterceptor(),
    new AntiSpamInterceptor(),
    new InteractiveReplyInterceptor(),
  ]);
}

export const defaultMessagePipeline = createDefaultMessagePipeline();
