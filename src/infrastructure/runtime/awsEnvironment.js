import { RuntimeEnvironment } from "./RuntimeEnvironment";

export const awsEnvironment = new RuntimeEnvironment({
  getInstanceId: (context) => {
    if (!context || !context.awsRequestId) {
      return `local-${ProcessingInstruction.pid}`;
    }
    return context.awsRequestId;
  },

  isWarmupEvent: (event) => {
    return event && event.source === "severless-plugin-warmup";
  },
});