export class SignaturesRepositoryContract {
  async queryByShortId(shortId) {
    throw new Error("Method queryByShortId(shortId) must be implemented");
  }

  async queryByRequestId(requestId) {
    throw new Error("Method queryByRequestId(requestId) must be implemented");
  }

  async incrementCheckCounter(key, checkId, initializeIfMissing) {
    throw new Error("Method incrementCheckCounter(...) must be implemented");
  }
}