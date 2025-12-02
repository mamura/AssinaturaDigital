"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const cacheTableHelper = require("../helpers/cacheTable");
const dataCompressionHelper = require("../helpers/dataCompression");
const providers = require("../providers");
const signaturesTable = require("../resources/tables/signatures");

let lambdaInstanceId = null;

const ALLOWED_CLIENT_NAMES = globals.specs.enabledCallbackDomains.map((cliCallbackDomain) => { return cliCallbackDomain.client;});

module.exports.handler = async (lambdaEvent, lambdaContext) => {
  let syncOriginRequestId = [];

  try {
    lambdaInstanceId = lambdaInstanceId || lambdaContext.awsRequestId; // using the first warmup call request ID as unique identifier for this Lambda instance

    // Immediate response for WarmUP plugin
    if (lambdaEvent.source === "serverless-plugin-warmup") {
      return responseHelper.warmup(lambdaInstanceId);
    }

    console.info(`\nLAMBDA INSTANCE ID: ${lambdaInstanceId}`);

    requestHelper.validateLambdaParameters(lambdaEvent, lambdaContext);
    requestHelper.validateRequestId(lambdaContext.awsRequestId);  
    
    const batchSize = parseInt(process.env.LAMBDA_PROCESS_SIGNATURE_READ_SQS_BATCH_SIZE || 1);

    const inputBodySchema = {
      "$id": "signature-processSignature-inputBody",
      "$async": true,
      "type": "array",
      "uniqueItems": true,
      "minItems": 1,
      "maxItems": batchSize,
      "items": {
        "type": "object",
        "properties": {
          "messageId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "receiptHandle": {
            "type": "string",
            "minLength": 100
          },
          "messagePayload": {
            "oneOf": [
              {
                "type": "string",
                "pattern": `^((${ALLOWED_CLIENT_NAMES.join("|")})\|){0,1}(${Object.keys(globals.specs.allowedDocumentKinds).join("|")})\|([a-zA-z0-9])+$`
              },
              {
                "type": "null"
              }
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "signerIdentity": { 
            "type": "string",
            "oneOf": globals.specs.allowedIdentityPatterns.map((signerIdentityPattern) => {
                return {
                  "pattern": signerIdentityPattern
                }
              })
          },
          "signerAuthorizationExp": {
            "type": "integer",
            "minimum": 1
          },
          "provider": {
            "type": "string",
            "enum": globals.specs.enabledProviders
          },
          "environment": {
            "type": "string"
          },
          "sts": {
            "type": "string",
            "minLength": 4
          }
        },
        "additionalProperties": false,
        "required": [
          "messageId",
          "receiptHandle",
          "messagePayload",
          "requestId",
          "signerIdentity",
          "signerAuthorizationExp",
          "provider",
          "sts"
        ]
      }
    };

    let requestBody = await requestHelper.parseSqsBody(lambdaEvent, inputBodySchema, batchSize);

    let promisesProcessSignature = [];

    requestBody.forEach((reqBody) => {
      syncOriginRequestId.push(reqBody.requestId);
      promisesProcessSignature.push({
        "syncOriginRequestId": reqBody.requestId,
        "promise": newProcessSignaturePromise(reqBody)
      });
    });

    let allPromisesResults = await Promise.all(promisesProcessSignature.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Promise for requestId ${pendingPromise.syncOriginRequestId} successfully executed.`);
        return {
          "syncOriginRequestId": pendingPromise.syncOriginRequestId,
          "result": res
        };
      })
      .catch((e) => {
        console.warn(`An error has occurred while processing promise for requestId ${pendingPromise.syncOriginRequestId}.`, e);
        return {
          "syncOriginRequestId": pendingPromise.syncOriginRequestId,
          "result": e
        }
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "PromiseAllProcessSignatureError", "An unexpected error has ocurred while executing all promises for processing signature.", e);
    });
    return responseHelper.asyncSuccess(lambdaContext.awsRequestId, syncOriginRequestId, allPromisesResults);
  } catch (e) {
    return responseHelper.asyncFailure(lambdaContext.awsRequestId, syncOriginRequestId, e);
  }
};

const newProcessSignaturePromise = (requestBody) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tableKey = {
        "requestId": requestBody.requestId,
        "signerIdentity": requestBody.signerIdentity
      }; 
  
      let mostRecentCachedSignerAuthorization = null;
      let mostRecentCachedSignerAuthorizationExp = null;

      const provider = await providers.loadProvider(requestBody.provider);
  
      if (["UPLOAD_TO_PROVIDER_FAILED", "PROVIDER_TRANSACTION_STARTED"].indexOf(requestBody.sts) === -1) { //if status is at this stage, then transaction has already been initiated. So, signer auth token is no longer necessary. It just need to upload the unsigned document
        // Using data inside message coming from pending signatures queue to verify if signer authorization token is expired at a glance.
        // This helps out to avoid unnecessary data retrieval from DynamoDB (to save read capacity units).
        if (Date.now() > (requestBody.signerAuthorizationExp * 1000)) {
  
          //firstly, checks if there is a more recent signer valid authorization token stored in cache table for the signer
          let pendingSignatureMessagePayloadSplit = requestBody.messagePayload.split("|");
          let clientName = globals.specs.defaultClientName; //due to legacy reasons, since at beginning SQS pending messages payload did not have the client name on it
  
          if (Array.isArray(pendingSignatureMessagePayloadSplit) && pendingSignatureMessagePayloadSplit[0] && ALLOWED_CLIENT_NAMES.indexOf(pendingSignatureMessagePayloadSplit[0]) >= 0) {
            clientName = pendingSignatureMessagePayloadSplit[0];
          }
  
          let cachedSignerKeyAuthorization = null;
  
          if (typeof clientName === "string" && clientName.length > 0) {
            cachedSignerKeyAuthorization = await provider.getCachedSignerKeyAuthorization(requestBody.environment, requestBody.signerIdentity, clientName);
          }
  
          if (cachedSignerKeyAuthorization 
              && cachedSignerKeyAuthorization.jwtTokenPayload.exp > requestBody.signerAuthorizationExp  
              && (cachedSignerKeyAuthorization.jwtTokenPayload.exp * 1000) > Date.now()) {
                mostRecentCachedSignerAuthorization = cachedSignerKeyAuthorization.jwtTokenPayload.accessToken;
                mostRecentCachedSignerAuthorizationExp = cachedSignerKeyAuthorization.jwtTokenPayload.exp;
          } else { // if no valid recent token has been found for the signer, then throws signer auth token expiration exception
            let signerAuthExpiredDataToPersist = {
              "sts": "SIGNER_AUTH_EXPIRED"
            };
      
            let signerAuthExpiredDataConditions = {
              "expression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                            " AND sts IN (:cond_sts1, :cond_sts2, :cond_sts3, :cond_sts4, :cond_sts5) " +
                            " AND requesterCallbackSts = :cond_requesterCallbackSts ",
              "values": { // all possible recoverable errors before starting signature transaction (not just PENDING, because this might not be the first time this message is being processed)
                ":cond_attType_providerSignatureId": "NULL",
                ":cond_sts1": "PENDING",
                ":cond_sts2": "PROVIDER_ERROR", // kept for legacy reasons. This status has been replaced by PROVIDER_START_SIGNATURE_TRANSACTION_ERROR
                ":cond_sts3": "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR",
                ":cond_sts4": "SIGNER_AUTH_EXPIRED",
                ":cond_sts5": "SIGNER_AUTH_FAILED",
                ":cond_requesterCallbackSts": "AWAITING_SIGNATURE"
              }
            };
            await signaturesTable.update(tableKey, signerAuthExpiredDataToPersist, signerAuthExpiredDataConditions);
      
            throw errorHandlerHelper.error(401, "SignerAuthKeyExpired", "Signer's authorization token for using his/her key has expired.");
          }
        }
      }
  
      let signatureRequestRecord = await signaturesTable.get(tableKey, ["signerAuthorization", "signerCertificateAlias", "sts", "unsignedDocument", "providerSignatureId", "provider", "serviceNotificationCallback", "signatureAttributes", "signatureSettingsProfileId"]);
  
      if (!signatureRequestRecord || Object.keys(signatureRequestRecord).length === 0) {
        throw errorHandlerHelper.error(404, "SignatureRequestNotFound", "Signature record has not been found for the parameters informed.");
      }
  
      if (signatureRequestRecord.sts === "UPLOADED_TO_PROVIDER") { //unsigned document has been already uploaded to provider. So, signature transaction is already started and waiting provider callback response.
        console.info(`Signature transaction for document with requestId ${requestBody.requestId} has already been started and is at stage ${signatureRequestRecord.sts}. Immediately returning success response.`);
        return resolve(`Signature record is already at status ${signatureRequestRecord.sts}. Nothing to do.`);
      }
  
      const unprocessableSignatureStatus = [
        "MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR",
        "PRECONDITION_ERROR", //kept for legacy reasons. This status has been replaced by MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR
        "UNSIGNED_DOCUMENT_UNCOMPRESSION_ERROR"
      ];
  
      const processableSignatureStatus = [
        //status berofre starting signture transaction
        "SIGNER_AUTH_EXPIRED",
        "SIGNER_AUTH_FAILED",
        "PENDING", 
        "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR",
        "PROVIDER_ERROR", // kept for leagacy reasons. This status has been replaced by PROVIDER_START_SIGNATURE_TRANSACTION_ERROR
        //status after starting signature transaction
        "UPLOAD_TO_PROVIDER_FAILED",
        "PROVIDER_TRANSACTION_STARTED"
      ];
  
      let uploadDocument = null;
  
      if (unprocessableSignatureStatus.indexOf(signatureRequestRecord.sts) >= 0) {
        //Just warning in console the invalid state, since it will enable returning a non-failure response and avoid unneccerary retries (once whatever the current state is, it pontentially is a unrecoverable state)
        console.warn(`Signature request record is at a state that does not allow it to be processed. Current state: ${signatureRequestRecord.sts}. Just returning...`);
        return resolve(`Signature request record is at a state that does not allow it to be processed. Current state: ${signatureRequestRecord.sts}.`);
      }
      
      if (processableSignatureStatus.indexOf(signatureRequestRecord.sts) >= 0) { //double check to avoid abnormal behaviors due to asynchronous execution
        let startSignatureTransaction = {};
  
        let startSignatureTransactionPrecoditionError = null;
        let startSignatureTranscationError = null;
        let startSignatureFailDataToPersist = {};

        let signatureSettingsProfileId = signatureRequestRecord.signatureSettingsProfileId || null;
       
  
        // Step 1: start signature transaction at provider
        if (["PENDING", "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR", "PROVIDER_ERROR", "SIGNER_AUTH_EXPIRED", "SIGNER_AUTH_FAILED"].indexOf(signatureRequestRecord.sts) >= 0) {
          if (!signatureRequestRecord.serviceNotificationCallback) {
            startSignatureFailDataToPersist.sts = "MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR";
            startSignatureTransactionPrecoditionError = errorHandlerHelper.error(500, "MissingParameterError", "Service notification callback not defined.");
          }
  
          if (!startSignatureTransactionPrecoditionError) {
            let startSignatureTransactionParams = {
              "requestId": requestBody.requestId,
              "signerIdentity": requestBody.signerIdentity,
              "signerAuthorization": mostRecentCachedSignerAuthorization || signatureRequestRecord.signerAuthorization,
              "signerCertificateAlias": signatureRequestRecord.signerCertificateAlias || null,
              "serviceNotificationCallback": signatureRequestRecord.serviceNotificationCallback,
              "signatureAttributes": signatureRequestRecord.signatureAttributes
            };
    
            try {
              startSignatureTransaction = await provider.startSignatureTransaction(startSignatureTransactionParams);
            } catch (e) {
              startSignatureFailDataToPersist.sts = (e.statusCode === 401 || e.statusCode === 404) ? "SIGNER_AUTH_FAILED" : "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR";
              startSignatureTranscationError = e;
            }
          }
         
          let startSignatureTransactionException = startSignatureTransactionPrecoditionError || startSignatureTranscationError;
  
          if (startSignatureTransactionException) {
            let startSignatureFailDataToPersistConditions = {
              "expression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                          " AND sts IN (:cond_sts1, :cond_sts2, :cond_sts3, :cond_sts4, :cond_sts5) " +
                          " AND requesterCallbackSts = :cond_requesterCallbackSts ",
              "values": { // all possible recoverable errors before starting signature transaction (not just PENDING, because this might not be the first time this message is being processed)
                ":cond_attType_providerSignatureId": "NULL",
                ":cond_sts1": "PENDING",
                ":cond_sts2": "PROVIDER_ERROR", // kept for legacy reasons. This status has been replaced by PROVIDER_START_SIGNATURE_TRANSACTION_ERROR
                ":cond_sts3": "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR",
                ":cond_sts4": "SIGNER_AUTH_EXPIRED",
                ":cond_sts5": "SIGNER_AUTH_FAILED",
                ":cond_requesterCallbackSts": "AWAITING_SIGNATURE"
              }
            };
            await signaturesTable.update(tableKey, startSignatureFailDataToPersist, startSignatureFailDataToPersistConditions);
            throw startSignatureTransactionException;
          }
  
          let succeededStartSignatureTransactionDataToPersist = {
            "sts": "PROVIDER_TRANSACTION_STARTED", 
            "providerSignatureId": startSignatureTransaction.providerSignatureId,
            "signatureType": startSignatureTransaction.signatureType,
            "signaturePolicy": startSignatureTransaction.signaturePolicy,
            "signatureHashAlgorithm": startSignatureTransaction.signatureHashAlgorithm,
            "signatureDocumentSource": startSignatureTransaction.signatureDocumentSource,
            "tsaHashAlgorithm": startSignatureTransaction.tsaHashAlgorithm,
            "tsaServerId": startSignatureTransaction.tsaServerId,
            "signatureSettingsProfileId": startSignatureTransaction.signatureSettingsProfileId
          };
          signatureSettingsProfileId = startSignatureTransaction.signatureSettingsProfileId;
  
          // If a most recent signer authorization token other than the on recorded has been used, then also update it
          if (mostRecentCachedSignerAuthorization) {
            succeededStartSignatureTransactionDataToPersist.signerAuthorization = mostRecentCachedSignerAuthorization;
            succeededStartSignatureTransactionDataToPersist.signerAuthorizationExp = mostRecentCachedSignerAuthorizationExp;
          }
      
          if (!requestBody.signerCertificateAlias) { //if no signer certificate has been informed in the initial request, then update the record with de default certificate applied by the provider
            succeededStartSignatureTransactionDataToPersist.signerCertificateAlias = startSignatureTransaction.signerCertificateAlias
          }
      
          let succeededStartSignatureTransactionDataToPersistConditions = {
            "expression": " attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                          " AND sts IN (:cond_sts1, :cond_sts2, :cond_sts3, :cond_sts4, :cond_sts5) " +
                          " AND requesterCallbackSts = :cond_requesterCallbackSts ",
            "values": { // all possible recoverable errors before starting signature transaction (not just PENDING, because this might not be the first time this message is being processed)
              ":cond_attType_providerSignatureId": "NULL",
              ":cond_sts1": "PENDING",
              ":cond_sts2": "PROVIDER_ERROR", // kept for legacy reasons. This status has been replaced by PROVIDER_START_SIGNATURE_TRANSACTION_ERROR
              ":cond_sts3": "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR",
              ":cond_sts4": "SIGNER_AUTH_EXPIRED",
              ":cond_sts5": "SIGNER_AUTH_FAILED",
              ":cond_requesterCallbackSts": "AWAITING_SIGNATURE"
            }
          };
      
          await signaturesTable.update(tableKey, succeededStartSignatureTransactionDataToPersist, succeededStartSignatureTransactionDataToPersistConditions);
  
        } else {
          let signatureTransactionStatus = null;

          try {
            signatureTransactionStatus = await provider.checkSignatureTransactionStatus(signatureRequestRecord.providerSignatureId);
          } catch (e) {
            throw errorHandlerHelper.error(401, "VerifySignatureTransactionStatusError", "An error has occurred while checking status of signature transaction.", e);
          }

          if ((signatureTransactionStatus || {}).transactionCompleted == true && ((signatureTransactionStatus || {}).document || {}).mediaType) {
            console.info(`Signature transaction for requestId ${signatureRequestRecord.requestId} at stage ${signatureRequestRecord.sts} is already completed at provider. Updating its status to UPLOADED_TO_PROVIDER.`);
            try {
              let conditionsUpdateStsUploadedToProvider = {
                "expression": "sts = :cond_sts AND requesterCallbackSts <> :cond_requesterCallbackSts ",
                "values": { 
                  ":cond_sts": signatureRequestRecord.sts,
                  ":cond_requesterCallbackSts": "NOTIFIED"
                }
              };
  
              let dataToPersistUpdateStsUploadedToProvider = {
                "sts": "UPLOADED_TO_PROVIDER"
              };
  
              await signaturesTable.update(tableKey, dataToPersistUpdateStsUploadedToProvider, conditionsUpdateStsUploadedToProvider);
              return resolve(`Status updated to ${dataToPersistUpdateStsUploadedToProvider.sts}`);
            } catch (e) {
              throw errorHandlerHelper.error(401, "UpdateSignatureTransactionStatusError", "An error has occurred while updating status of signature transaction.", e);
            }
          } else {
            console.info(`Signature for requestId ${signatureRequestRecord.requestId} is at stage ${signatureRequestRecord.sts} and it is not completed at provider yet. Just proceeding with document uploading to provider.`);
          }
        }
    
        // Step 2: upload unsigned document to provider
        let dataUploadStatusToPersist = {};
        let unsignedDocumentUncompressionError = null;
        let uploadUnsignedDocumentError = null;
  
        // If unsigned document content has been stored in a compressed format, then uncompress it before sending content to provider
        if (signatureRequestRecord.unsignedDocument.compression) {
          try {
            let uncompressedDocumentContent = await dataCompressionHelper.uncompress(signatureRequestRecord.unsignedDocument.xmlContent, signatureRequestRecord.unsignedDocument.compression);
            signatureRequestRecord.unsignedDocument.xmlContent = uncompressedDocumentContent;
          } catch (e) {
            unsignedDocumentUncompressionError = e;
            dataUploadStatusToPersist.sts = "UNSIGNED_DOCUMENT_UNCOMPRESSION_ERROR";
          }
        }
  
        if (!unsignedDocumentUncompressionError) {
          try {
            let uploadUnsignedDocumentParams = {
              "requestId": requestBody.requestId,
              "providerSignatureId": signatureRequestRecord.providerSignatureId || startSignatureTransaction.providerSignatureId,
              "unsignedDocument": signatureRequestRecord.unsignedDocument,
              "signatureSettingsProfileId": signatureSettingsProfileId || null
            };
  
            uploadDocument = await provider.uploadDocument(uploadUnsignedDocumentParams);
  
            if (uploadDocument.uploadConcluded === true) {
                dataUploadStatusToPersist.sts = "UPLOADED_TO_PROVIDER";
              } else {
                uploadUnsignedDocumentError =  errorHandlerHelper.error(500, "UploadError", `Call to upload routine has successfully concluded. However, upload conclusion status is set to ${uploadDocument.uploadConcluded}. It should be completed already.`);
                dataUploadStatusToPersist.sts = "UPLOAD_TO_PROVIDER_FAILED";
              }
          } catch (e) {
            uploadUnsignedDocumentError = e;
            dataUploadStatusToPersist.sts = "UPLOAD_TO_PROVIDER_FAILED";
          }
        }
    
        let dataUploadTableUpdateConditions = {
          "expression": " attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                        " AND size(providerSignatureId) = :cond_size_providerSignatureId " +
                        " AND sts IN (:cond_sts1, :cond_sts2) ",
          "values": {
            ":cond_attType_providerSignatureId" : "S",
            ":cond_size_providerSignatureId" : 36,
            ":cond_sts1":  "PROVIDER_TRANSACTION_STARTED",
            ":cond_sts2":  "UPLOAD_TO_PROVIDER_FAILED"
          }
        };
  
        // Step 3: update request signature record with success or failture result
        await signaturesTable.update(tableKey, dataUploadStatusToPersist, dataUploadTableUpdateConditions); 
  
        // If a failure has ocurred in either of steps, then throw the exception
        let exception = unsignedDocumentUncompressionError || uploadUnsignedDocumentError;
        if (exception) {
          throw exception;
        }
      }

      // If everything went fine so far, return the succeded result
      return resolve(uploadDocument);
    } catch (e) {
      return reject(e);
    }
  });
};