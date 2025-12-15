import { Signature } from "../domain/entities/Signature.js";
import { RequestOrigin } from "../domain/valueObjects/RequestOrigin.js";
import { DynamoSignaturesRepository } from "../infrastructure/repositories/DynamoSignaturesRepository.js";

async function run()
{
  const repo            = new DynamoSignaturesRepository();
  const now             = Date.now();
  const requestId       = crypto.randomUUID();
  const signerIdentity  = 'test-signer-002';
  const shortId         = await repo.generateShortId();

  const signature = new Signature({
    requestId,
    shortId,
    signerIdentity,

    provider: 'TEST_PROVIDER',
    environment: 'local',

    sts: 'PENDING',
    stsUpdatedAt: now,

    signerAuthorization: null,
    signerAuthorizationExp: null,
    signerCertificateAlias: null,

    unsignedDocument: {
      fileName: 'dummy-2.pdf',
      size: 4321,
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
    signatureAttributes: {},

    signatureSettingsProfileId: null,
    tsaHashAlgorithm: null,
    tsaServerId: null,

    serviceNotificationCallback: null,

    checkCounter: 0,
    lastCheckAt: null,
    lastCheckRequestId: null,

    replacementFor: null,
    replacedBy: null,

    adminOnErrorLasNotifiedAt: null,
    adminOnErrorNotificationCount: 0,

    requestOrigin: new RequestOrigin({
      client: 'MANUAL_TEST',
      apiKey: null,
      apiKeyId: null,
      sourceIp: '127.0.0.1',
      userAgent: 'manual-script',
    }),
  });

  console.log('Criando assinatura via DynamoSignaturesRepository...');
  await repo.create(signature);

  console.log('Buscando de volta por requestId + signerIdentity...');
  const loadedByPk = await repo.findByRequestIdAndSigner(requestId, signerIdentity);
  
  console.log('Carregado por PK:');
  console.log(loadedByPk, { depth: null });

  console.log('Buscando de volta por shortId (usando GSI signatureShortIdIndex)...');
  const loadedByShortId = await repo.findByShortId(shortId);

  console.log('Carregado por shortId:');
  console.dir(loadedByShortId, { depth: null });

  console.log('requestId:', requestId);
  console.log('shortId:', shortId);
}

run().catch(err => {
  console.error('Erro durante o teste:', err);
  process.exit(1);
});