import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const dynamoBaseClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  },
});

export const dynamoClient = DynamoDBDocumentClient.from(dynamoBaseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  }
});

export const signaturesTableName            = process.env.SIGNATURES_TABLE_NAME || "SignaturesTableLocal";
export const signaturesChecksTableName      = process.env.SIGNATURE_CHECKS_TABLE_NAME || "SignatureChecksTableLocal";
export const signersAuthorizationsTableName = process.env.SIGNER_AUTHORIZATIONS_TABLE_NAME || "SignerAuthorizationsTableLocal";
export const serviceCacheTableName          = process.env.SERVICE_CACHE_TABLE_NAME || "ServiceCacheTableLocal";