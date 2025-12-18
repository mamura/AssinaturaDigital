import { DynamoDBClient, DescribeTableCommand, CreateTableCommand, AttributeAction } from "@aws-sdk/client-dynamodb";

const region    = process.env.AWS_REGION || 'us-east-1';
const endpoint  = process.env.DYNAMODB_ENDPOINT || undefined;

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  },
});

const SIGNATURES_TABLE_NAME             = process.env.SIGNATURES_TABLE_NAME || "SignaturesTableLocal";
const SIGNATURES_CHECK_TABLE_NAME       = process.env.SIGNATURES_CHECK_TABLE_NAME || "SignaturesCheckTableLocal";
const SIGNERS_AUTHORIZATION_TABLE_NAME  = process.env.SIGNERS_AUTHORIZATION_TABLE_NAME || "SignersAuthorizationTableLocal";
const SERVICE_CACHE_TABLE_NAME          = process.env.SERVICE_CACHE_TABLE_NAME || "ServiceCacheTableLocal";

async function tableExists(tableName) {
  try {
    await client.send(
      new DescribeTableCommand({
        TableName: tableName,
      }),
    );
    return true;
  } catch (err) {
    if (err.name === "ResourceNotFoundException") {
      return false;
    }
    throw err;
  }
}

async function ensureTable(params) {
  const { tableName } = params;
  const exists        = await tableExists(tableName);

  if (exists) {
    console.log(`Table "${tableName}" already exists.`);
    return;
  }

  console.log(`Creating table "${tableName}"...`);
  await client.send(new CreateTableCommand(params));
  console.log(`Table "${tableName}" created.`);
}

async function createSignaturesTable() {
  await ensureTable({
    TableName: SIGNATURES_TABLE_NAME,
    
    AttributeDefinitions: [
      { AttributeName: "requestId", AttributeType: "S" },
      { AttributeName: "signerIdentity", AttributeType: "S" },
      { AttributeName: "shortId", AttributeType: "S" },
      { AttributeName: "sts", AttributeType: "S" },
      { AttributeName: "requesterCallbackSts", AttributeType: "S" },
      { AttributeName: "stsUpdatedAt", AttributeType: "N" },
    ],

    KeySchema: [
      { AttributeName: "requestId", KeyType: "HASH" },
      { AttributeName: "signerIdentity", KeyType: "RANGE" },
    ],

    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },

    GlobalSecondaryIndexes: [
      {
        IndexName: "signatureShortIdIndex",
        KeySchema: [{ AttributeName: "shortId", KeyType: "HASH" }],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["sts"],
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },

      {
        IndexName: "signatureStsAndStsUpdatedAtIndex",
        KeySchema: [
          { AttributeName: "sts", KeyType: "HASH" },
          { AttributeName: "stsUpdatedAt", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: [
            "signerIdentity",
            "provider",
            "signerAuthorizationExp",
            "unsignedDocument",
            "requestOrigin",
            "providerSignatureId",
            "requesterCallbackSts",
            "createdAt",
            "requesterCallbackStsUpdatedAt",
          ],
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },

      {
        IndexName: "requesterCallbackStsUpdatedAtIndex",
        KeySchema: [
          { AttributeName: "requesterCallbackSts", KeyType: "HASH" },
          { AttributeName: "stsUpdatedAt", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: [
            "signerIdentity",
            "provider",
            "signerAuthorizationExp",
            "unsignedDocument",
            "requestOrigin",
            "providerSignatureId",
            "sts",
            "createdAt",
            "requesterCallbackStsUpdatedAt",
          ],
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      }
    ],
  });
}

async function createSignaturesCheckTable() {
  await ensureTable({
    TableName: SIGNATURES_CHECK_TABLE_NAME,
    
    AttributeDefinitions: [
      { AttributeName: "requestId", AttributeType: "S" },
    ],

    KeySchema: [{  AttributeName: "requestId", KeyType: "HASH" }],

    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
}

async function createSignersAuthorizationTable() {
  await ensureTable({
    TableName: SIGNERS_AUTHORIZATION_TABLE_NAME,

    AttributeDefinitions: [
      { AttributeName: "requestId", AttributeType: "S" },
      { AttributeName: "signerIdentity", AttributeType: "S" },
    ],

    KeySchema: [
      { AttributeName: "requestId", KeyType: "HASH" },
      { AttributeName: "signerIdentity", KeyType: "RANGE" },
    ],

    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
}

async function createServiceCacheTable() {
  await ensureTable({
    TableName: SERVICE_CACHE_TABLE_NAME,

    AttributeDefinitions:[
      { AttributeName: "entryKey", AttributeType: "S" },
    ],

    KeySchema: [{  AttributeName: "entryKey", KeyType: "HASH" }],

    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
}

async function run() {
  console.log("Starting DynamoDB table creation...");
  console.log(`Endpoint: ${endpoint || "(AWS real)"}`);
  console.log(`Region: ${region}`);
  console.log("");

  await createSignaturesTable();
  await createSignaturesCheckTable();
  await createSignersAuthorizationTable();
  await createServiceCacheTable();

  console.log("\n DynamoDB table creation completed.");
}

run().catch((err) => {
  console.error("Error during DynamoDB table creation:");
  console.error(err);
  process.exit(1);
});