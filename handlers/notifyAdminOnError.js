"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const signaturesTable = require("../resources/tables/signatures");
const errorHandlerHelper = require("../helpers/errorHandler");
const snsHelper = require("../helpers/sns");
var textTable = require("text-table");

const NUMBER_OF_ERROR_NOTIFICATIONS_THRESHOLD = 1;

let lambdaInstanceId = null;

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

    const batchSize = parseInt(process.env.LAMBDA_NOTIFY_ADMIN_ON_ERROR_READ_SQS_BATCH_SIZE || 1);

    const inputBodySchema = {
      "$id": "signature-notifyRequester-inputBody",
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
            "type": "string",
            "pattern": `^((${globals.specs.enabledCallbackDomains.map((cliCallbackDomain) => { return cliCallbackDomain.client;}).join("|")})\|){0,1}(${Object.keys(globals.specs.allowedDocumentKinds).join("|")})\|([a-zA-z0-9])+$`
          },
          "requestId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "errorReason": {
            "type": "string",
            "pattern": "^[A-Z\_]+$"
          }
        },
        "additionalProperties": false,
        "required": [
          "messageId",
          "receiptHandle",
          "messagePayload",
          "requestId",
          "errorReason"
        ]
      }
    };

    let requestBody = await requestHelper.parseSqsBody(lambdaEvent, inputBodySchema, batchSize);

    requestBody.forEach((reqBody) => {
      syncOriginRequestId.push(reqBody.requestId); 
    });

    let signatureRecords = await signaturesTable.queryByRequestIds(syncOriginRequestId, ["requestId", "signerIdentity", "signerCertificateAlias", "adminOnErrorLasNotifiedAt", "adminOnErrorNotificationCount", "provider", "environment", "providerSignatureId", "createdAt"]);

    let signaturesForNotification = [];

    signatureRecords.forEach((signatureRecord) => {
      if (!signatureRecord.adminOnErrorNotificationCount || signatureRecord.adminOnErrorNotificationCount < NUMBER_OF_ERROR_NOTIFICATIONS_THRESHOLD) {
        signaturesForNotification.push(requestBody.find((reqBodyItem) => {
          let found = reqBodyItem.requestId === signatureRecord.requestId;

          if (found) {
            reqBodyItem.signerIdentity = signatureRecord.signerIdentity;
            reqBodyItem.provider = signatureRecord.provider;
            reqBodyItem.environment = signatureRecord.environment;
            reqBodyItem.signerCertificateAlias = signatureRecord.signerCertificateAlias;
            reqBodyItem.providerSignatureId = signatureRecord.providerSignatureId;
            reqBodyItem.createdAt = signatureRecord.createdAt;
            reqBodyItem.initialCounter = !signatureRecord.adminOnErrorNotificationCount;
          }

          return found;
        }));
      }
    });

    let snsMessageId = null;

    if (signaturesForNotification.length > 0) {
      let snsMessage = "";

      snsMessage += "There was an error while processing digital signature for the following records: \n\n";

      let textTableData = [
        /*[
          "SIGNATURE ID",
          "PROVIDER",
          "CLIENT",
          "SIGNER ID",
          "DOCUMENT KIND",
          "DOCUMENT ID",
          "ERROR REASON"
        ]*/
      ];

      let signaturesIncludedInErrorNotification = [];

      signaturesForNotification.forEach((signatureNotification) => {
        let messagePayloadParts = signatureNotification.messagePayload.split("|");
        if (Array.isArray(messagePayloadParts) && messagePayloadParts.length >= 3) {
          
          signaturesIncludedInErrorNotification.push({
            "requestId": signatureNotification.requestId,
            "signerIdentity": signatureNotification.signerIdentity,
            "provider": signatureNotification.provider,
            "providerSignatureId": signatureNotification.providerSignatureId,
            "initialCounter": signatureNotification.initialCounter
          });

          let signautreHumanReadableDate = new Date();
          signautreHumanReadableDate.setTime(signatureNotification.createdAt);

          textTableData.push(
            [
              "» SIGNATURE REQUEST DATE: " + signautreHumanReadableDate.toUTCString(),
              "SIGNATURE ID: " + (signatureNotification.requestId || ""),
              "PROVIDER: " + (signatureNotification.provider || ""),
              "ENVIRONMENT: " + (signatureNotification.environment || ""),
              "PROVIDER SIGNATURE ID (TCN): " + (signatureNotification.providerSignatureId || ""),
              "CLIENT: " + (messagePayloadParts[0] || ""),
              "SIGNER ID: " + (signatureNotification.signerIdentity || ""),
              "SIGNER CERTIFICATE: " + (signatureNotification.signerCertificateAlias || ""),
              "DOCUMENT KIND: " + (messagePayloadParts[1] || ""),
              "DOCUMENT ID: " + (messagePayloadParts[2] || ""),
              "ERROR REASON: " + (signatureNotification.errorReason || "")
            ]
          );
        }
      });

      if (signaturesIncludedInErrorNotification.length > 0) {
        let txtTable = textTable(textTableData, { align: ["l", "l", "l", "l", "l", "l", "l", "l", "l", "l", "l"], hsep: " | " });

        snsMessage += `${txtTable} \n`;
  
        let snsParams = {
          "snsMessage": snsMessage,
          "snsMessageSubject": `[DIGITAL SIGNATURE FAILURE] ${signaturesForNotification.length} document${signaturesForNotification.length > 1 ? "s" : ""} failed`,
          "snsTargetArn": process.env.RSRC_ADMIN_EMAIL_LIST_GROUP_SNS_TOPIC_ARN
        };
    
        snsMessageId = await snsHelper.publishToTopic(snsParams);

        let upddateAdminOnErrorNotificationPromises = [];

        signaturesIncludedInErrorNotification.forEach((signatureIncludedOnErrorNotification) => {
          upddateAdminOnErrorNotificationPromises.push({
            "requestId": signatureIncludedOnErrorNotification.requestId,
            "promise": newIncrementAdminErrorNotificationCounterPromise(signatureIncludedOnErrorNotification.requestId, signatureIncludedOnErrorNotification.signerIdentity, signatureIncludedOnErrorNotification.initialCounter)
          });
        });

        await Promise.all(upddateAdminOnErrorNotificationPromises.map((pendingPromise) => {
          return pendingPromise.promise.then((res) => {
            console.info(`Admin error notification for signature with requestId ${pendingPromise.requestId} successfully incremented!`);
            return true;
          })
          .catch((e) => {
            console.warn(`An error has occurred while incrementing admin error notification counter for signature record with requestId ${pendingPromise.requestId}. Error details: `, e);
            return e; 
          });
        }));
      }
    }

    let resultToReturn = snsMessageId ? {"snsMessageId": snsMessageId.messageId || snsMessageId} : {};

    return responseHelper.asyncSuccess(lambdaContext.awsRequestId, syncOriginRequestId, resultToReturn);
  } catch (e) {
    return responseHelper.asyncFailure(lambdaContext.awsRequestId, syncOriginRequestId, e);
  }
};

const newIncrementAdminErrorNotificationCounterPromise = (requestId, signerIdentity, initialCounter) => {
  return new Promise(async (resolve, reject) => {
    try {
      await signaturesTable.incrementAdminOnErrorNotificationCounter({requestId, signerIdentity}, initialCounter);
      return resolve();
    } catch (e) {
      return reject(e);
    }
  });
};