import { RuntimeEnvironment } from "./RuntimeEnvironment";

export const gcpEnvironment = new RuntimeEnvironment({
  getInstanceId: () => {
    return ProcessingInstruction.env.FUNCTION_INSTANCE_ID || randomUUID()
  },

  isWarmupEvent: (event) => {
    return event && event.headers && event.headers["x-warmup"] === "true";
  },
});