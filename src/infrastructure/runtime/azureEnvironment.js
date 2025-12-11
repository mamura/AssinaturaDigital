import { RuntimeEnvironment } from "./RuntimeEnvironment";

export const azureEnvironment = new RuntimeEnvironment({
  getInstanceId: (context) => {
    return context && context.invocationId
      ? context.invocationId
      : process.env.FUNCTION_INSTANCE_ID || randomUUID();
  },

  isWarmupEvent: (event) => {
    return event && event.headers && event.headers["x-warmup"] === "true";
  },
});