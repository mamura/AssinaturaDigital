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
  return new InMemorySignaturesRepository();
};
