export class RuntimeEnvironment
{
  constructor({getInstanceId, isWarmupEvent})
  {
    this.getInstanceId = getInstanceId;
    this.isWarmupEvent = isWarmupEvent;
  }
}