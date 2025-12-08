import { DynamoSignaturesRepository } from "./DynamoSignaturesRepository.js";
import { InMemorySignaturesRepository } from "./InMemorySignaturesRepository.js";

export const makeSignaturesRepository = () => {
  const driver =
    process.env.SIGNATURES_REPOSITORY_DRIVER ||
    process.env.STAGE === "local"
      ? "memory"
      : "dynamo";

  //if (driver === "dynamo") {
  //  console.log("[SignaturesRepository] Using DynamoSignaturesRepository");
  //  return new DynamoSignaturesRepository();
  //}

  console.log("[SignaturesRepository] Using InMemorySignaturesRepository");
  return new InMemorySignaturesRepository([
    {
      requestId: "test-request-uuid-1",
      shortId: "12345678901234567",
      signerIdentity: "12345678900",
      sts: "SIGNED",
      unsignedDocument: {
        kind: "EHR",
        xmlContent: "<root><foo>bar</foo></root>",
        compression: null,
      },
      signedDocument: {
        signedContent: "signed-content-mock",
        compression: null,
      },
      replacedBy: null,
      checkCounter: 0,
    },
  ]);
};
