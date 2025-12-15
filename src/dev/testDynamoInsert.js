import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoClient, signaturesTableName } from "../infrastructure/aws/dynamoClient.js";

async function run()
{
  const now       = Date.now();
  const requestId = crypto.randomUUID();

  const item = {
    requestId: requestId,
    signerIdentity: 'test-signer-001',
    shortId: 'test1234',

    provider: 'TEST_PROVIDER',
    environment: 'local',

    sts: 'PENDING',
    stsUpdatedAt: now,

    signerAuthorization: null,
    signerAuthorizationExp: null,
    signerCertificateAlias: null,

    unsignedDocument: {
      fileName: 'dummy.pdf',
      size: 1234,
      contentType: 'application/pdf',
    },
    signedDocument: null,

    requesterNotificationCallback: null,
    requesterCallbackSts: 'AWAITING_SIGNATURE',
    requesterCallbackStsUpdatedAt: now,

    providerSignatureId: null,

    signatureType: null,
    signaturePolicy: null,
    signatureHashAlgorithm: null,
    signatureDocumentSource: null,
    signatureAttributes: null,
    signatureSettingsProfileId: null,

    tsaHashAlgorithm: null,
    tsaServerId: null,

    serviceNotificationCallback: null,

    checkCounter: 0,
    lastCheckAt: null,
    lastCheckRequestId: null,

    replacementFor: null,
    replecedBy: null,

    adminOnErrorLasNotifiedAt: null,
    adminOnErrorNotificationCount: 0,

    requestOrigin: {
      client: 'MANUAL_TEST',
      apiKey: null,
      apiKeyId: null,
      sourceIp: '127.0.0.1',
      userAgent: 'dev-test-script',
    },
  };

  console.log('Inserindo item na tabela:', signaturesTableName);

  await dynamoClient.send(
    new PutCommand({
      TableName: signaturesTableName,
      Item: item,
    })
  );

  console.log('Item inserido com sucesso. requestId:', requestId);
}

run().catch((error) => {
  console.error('Erro ao executar o script:', error);
  process.exit(1);
});