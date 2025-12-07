import { SignaturesRepositoryContract } from "../../application/contracts/SignaturesRepositoryContract.js";

export class InMemorySignaturesRepository extends SignaturesRepositoryContract {
  constructor() {
    super();

    this.items = [
      {
        requestId: "11111111-1111-1111-1111-111111111111",
        signerIdentity: "12345678900",
        shortId: "12345678901234567",
        sts: "SIGNED",
      },
    ];
  }

  async queryByShortId(shortId) {
    return this.items.filter((item) => item.shortId === shortId);
  }

  async queryByRequestId(requestId) {
    return this.items.filter((item) => item.requestId === requestId);
  }

  async incrementCheckCounter(key, checkId, initializeIfMissing) {
    const item = this.items.find(
      (it) =>
        it.requestId === key.requestId &&
        it.signerIdentity === key.signerIdentity
    );

    if (!item) {
      return;
    }

    if (typeof item.checkCounter === "undefined") {
      item.checkCounter = initializeIfMissing ? 0 : 1;
    }

    item.checkCounter += 1;
  }
}
