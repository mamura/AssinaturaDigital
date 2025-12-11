"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const httpClientHelper = require("../helpers/httpClient");
const requesterClientHelper = require("../helpers/requesterClient");
const dataCompressionHelper = require("../helpers/dataCompression");
const signedFileHelper = require("../helpers/signedFile");
const formData = require("form-data");
const signaturesTable = require("../resources/tables/signatures");
const adminErrorNotificationQueue = require("../resources/queues/adminErrorNotification");

let lambdaInstanceId = null;

const URI_REGEX = new RegExp(/[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi);

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

    const batchSize = parseInt(process.env.LAMBDA_NOTIFY_REQUESTER_READ_SQS_BATCH_SIZE || 1);

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
            "oneOf": [
              {
                "type": "string",
                "pattern": `^((${globals.specs.enabledCallbackDomains.map((cliCallbackDomain) => { return cliCallbackDomain.client;}).join("|")})\|){0,1}(${Object.keys(globals.specs.allowedDocumentKinds).join("|")})\|([a-zA-z0-9])+$`
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
          "requestId"
        ]
      }
    };

    let requestBody = await requestHelper.parseSqsBody(lambdaEvent, inputBodySchema, batchSize);

    let promisesNotifyRequester = [];
    let dataToAdminErrorNotificationQueue = [];

    requestBody.forEach((reqBody) => {
      syncOriginRequestId.push(reqBody.requestId);

      if (reqBody.errorReason) {
        let messagePayloadSplit = typeof reqBody.messagePayload === "string" ? reqBody.messagePayload.split("|") : null;

        if (Array.isArray(messagePayloadSplit) && messagePayloadSplit.length >= 3) {
          let messageToAdminErrorNotificationQueue = {
            'requestId': reqBody.requestId,
            'errorReason': reqBody.errorReason,
            'clientName': messagePayloadSplit[0],
            'documentKind': messagePayloadSplit[1],
            'documentCorrelationId': messagePayloadSplit[2]
          } 
          dataToAdminErrorNotificationQueue.push(messageToAdminErrorNotificationQueue);
        }
      }

      promisesNotifyRequester.push({
        "syncOriginRequestId": reqBody.requestId,
        "promise": newNotifyRequesterPromise(reqBody)
      });
    });

    let allPromisesResults = await Promise.all(promisesNotifyRequester.map((pendingPromise) => {
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
      throw errorHandlerHelper.error(500, "PromiseAllNotifyRequesterError", "An unexpected error has ocurred while executing all promises for processing signature.", e);
    });

    // send errored signatures transactions for admin error notification queue
    if (dataToAdminErrorNotificationQueue.length > 0) {
      try {
        await adminErrorNotificationQueue.sendMessageBatch(dataToAdminErrorNotificationQueue);
      } catch (e) {
        console.warn('There was an error while trying to put messages on queue admin error notification.', e);
      }
    }

    return responseHelper.asyncSuccess(lambdaContext.awsRequestId, syncOriginRequestId, allPromisesResults);
  } catch (e) {
    return responseHelper.asyncFailure(lambdaContext.awsRequestId, syncOriginRequestId, e);
  }
};

const newNotifyRequesterPromise = (requestBody) => {
  return new Promise(async (resolve, reject) => {
    try {
      let signatureRequestRecord = await signaturesTable.queryByRequestId(requestBody.requestId, ["sts", "requesterCallbackSts", "signerIdentity", "requesterNotificationCallback", "requestOrigin.client", "requestOrigin.apiKeyId", "unsignedDocument.correlationId"]);

      if (!Array.isArray(signatureRequestRecord) || signatureRequestRecord.length === 0) {
        throw errorHandlerHelper.error(404, "DocumentNotFound", "No document has been found for the parameters informed."); 
      }
      signatureRequestRecord = signatureRequestRecord[0];

      if (signatureRequestRecord.requesterCallbackSts === "NOTIFIED") { //requester has already been notified
        console.info(`Requester has already been notified for document signed with requestId ${requestBody.requestId}. This is possibly due to asynchornous retry behavior. Immediately returning success response.`);
        return resolve(`Signature record is already at status ${signatureRequestRecord.requesterCallbackSts}. Nothing to do.`);
      }

      const unprocessableCallbackStatus = [
        "EMPTY_REQUESTER_CALLBACK",
        "INVALID_REQUESTER_CALLBACK",
        "EMPTY_SIGNED_CONTENT",
        "CALLBACK_URL_OWNERSHIP_ERROR",
        "SIGNED_DOCUMENT_UNCOMPRESSION_ERROR"
      ];

      const processableCallbackStatus = [
        "AWAITING_SIGNATURE",
        "NOTIFICATION_ERROR"
      ];

      let notifyRequesterResponse = null;

      if (unprocessableCallbackStatus.indexOf(signatureRequestRecord.requesterCallbackSts) >= 0) {
        //Just warning in console the invalid state, since it will enable returning a non-failure response and avoid unneccerary retries (once whatever the current notification callback state is, it pontentially is a unrecoverable state)
        console.warn(`Signature request record callback notification for requestId ${requestBody.requestId} is at a state that does not allow it to be processed. Current state: ${signatureRequestRecord.requesterCallbackSts}. Just returning...`);
      } else if (processableCallbackStatus.indexOf(signatureRequestRecord.requesterCallbackSts) >= 0) {
        let dataToPersist = {};
        let emptyRequesterCallbackError = null;
        let invalidRequesterCallbackError = null;
        let callbackUrlOwnershipError = null;
        let emptySignedContentError = null;
        let uncompressionError = null;
        let notificationError = null;
        let requesterCallbackSpecs = null;

        if (!signatureRequestRecord.requesterNotificationCallback) {
          emptyRequesterCallbackError = errorHandlerHelper.error(409, "RequesterCallbackNotSet", "No callback URL has been bound to the signature request.");
          dataToPersist.requesterCallbackSts = "EMPTY_REQUESTER_CALLBACK";
        }

        if (!signatureRequestRecord.requesterNotificationCallback.match(URI_REGEX)) {
          invalidRequesterCallbackError = errorHandlerHelper.error(409, "InvalidRequesterCallbackUrl", "No callback URL has been bound to the signature request.");
          dataToPersist.requesterCallbackSts = "INVALID_REQUESTER_CALLBACK";
        }

        if (!emptyRequesterCallbackError && !invalidRequesterCallbackError) {
          // Step 1: double check the ownership of callback requerster URL
          try {
            requesterCallbackSpecs = requesterClientHelper.checkRequesterCallbackUrlByClientName(signatureRequestRecord.requestOrigin.client, signatureRequestRecord.requesterNotificationCallback);
          } catch (e) {
            callbackUrlOwnershipError =  errorHandlerHelper.error(403, "AccessDenied", "The requester callback URL is not registered for the application that requested document signature.", e);
            dataToPersist.requesterCallbackSts = "CALLBACK_URL_OWNERSHIP_ERROR";
          }

          if (!callbackUrlOwnershipError) {
            let requestParams = {
              "url": `${signatureRequestRecord.requesterNotificationCallback}`,
              "responseType": "json"
            };

            let formDataToSubmit = new formData();
            formDataToSubmit.append("correlationId", signatureRequestRecord.unsignedDocument.correlationId);
            formDataToSubmit.append("signatureRequestId", requestBody.requestId);

            // Step 2.1: if it is a successfull signed document notification, then retrieve signed content and send it back to requester
            if (!requestBody.errorReason && ["SIGNED", "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"].indexOf(signatureRequestRecord.sts) !== -1 && processableCallbackStatus.indexOf(signatureRequestRecord.requesterCallbackSts) >= 0) {
              signatureRequestRecord.signedDocument = await signaturesTable.queryByRequestId(requestBody.requestId, ["signedDocument"]);

              if (Array.isArray(signatureRequestRecord.signedDocument) && signatureRequestRecord.signedDocument.length === 1) {
                signatureRequestRecord.signedDocument = (signatureRequestRecord.signedDocument[0] || {}).signedDocument;
              } else {
                signatureRequestRecord.signedDocument = null;
              }
              
              if (!signatureRequestRecord.signedDocument || !signatureRequestRecord.signedDocument.signedContent) {
                emptySignedContentError = errorHandlerHelper.error(409, "EmptySignedDocument", "The document is signed, but no content has been found for it.");
                dataToPersist.requesterCallbackSts = "EMPTY_SIGNED_CONTENT";
              }

              if (!emptySignedContentError) {
                  // If signed document content has been stored in a compressed format, then uncompress it before sending content to client requester
                  if (signatureRequestRecord.signedDocument.compression) {
                    try {
                      let uncompressedDocumentContent = await dataCompressionHelper.uncompress(signatureRequestRecord.signedDocument.signedContent, signatureRequestRecord.signedDocument.compression);
                      signatureRequestRecord.signedDocument.signedContent = uncompressedDocumentContent;
                    } catch (e) {
                      uncompressionError = e;
                      dataToPersist.requesterCallbackSts = "SIGNED_DOCUMENT_UNCOMPRESSION_ERROR";
                    }
                  }

                  // Send signed document to requester at its callback URL
                  if (!uncompressionError) {
                    let signingTimeStamp = signedFileHelper.getSigningTimeStamp(signatureRequestRecord.signedDocument.signedContent);
                    formDataToSubmit.append("signingTimeStamp", signingTimeStamp);
                    formDataToSubmit.append("signedDocument", signatureRequestRecord.signedDocument.signedContent, signatureRequestRecord.signedDocument.fileName);          
                  }
              }
              
            // Step 2.2: if it is a unsuccessfull notification, then send the error flag  
            } else { 
              formDataToSubmit.append("signatureError", (requestBody.errorReason) ? requestBody.errorReason : signatureRequestRecord.requesterCallbackSts);
            }

            if (!emptySignedContentError && !uncompressionError) {
              try {
                requestParams.data = formDataToSubmit;
                requestParams.headers = formDataToSubmit.getHeaders();
    
                notifyRequesterResponse = await httpClientHelper.post(requestParams, requesterCallbackSpecs);
                dataToPersist.requesterCallbackSts = "NOTIFIED";
                if (!(notifyRequesterResponse.responseStatus >= 200 && notifyRequesterResponse.responseStatus < 300)) {
                  throw errorHandlerHelper.error(500, "RequestError", `Call to requester's callback URL returned status code ${notifyRequesterResponse.responseStatus} and body details: ${JSON.stringify(notifyRequesterResponse.responseData || {})}`);
                }
              } catch (e) {
                notificationError = e;
                dataToPersist.requesterCallbackSts = "NOTIFICATION_ERROR";
              }
            }
          }
        }

        // Step 4: update request signature record with success or failture result
        const tableKey = {
          "requestId": requestBody.requestId,
          "signerIdentity": signatureRequestRecord.signerIdentity
        }; 

        let tableUpdateConditions = {
          "expression": "requesterCallbackSts IN (",
          "values": {}
        };
        for (let s = 0, totS = processableCallbackStatus.length; s < totS; s++) {
          tableUpdateConditions.expression += `:cond_requesterCallbackSts${s+1}, `;
          tableUpdateConditions.values[`:cond_requesterCallbackSts${s+1}`] = processableCallbackStatus[s];
        }
        tableUpdateConditions.expression = tableUpdateConditions.expression.substring(0, tableUpdateConditions.expression.length-2) + ")";

        await signaturesTable.update(tableKey, dataToPersist, tableUpdateConditions);

        // If a failure has ocurred in either of steps, then throw the exception
        let exception = emptyRequesterCallbackError || invalidRequesterCallbackError || emptySignedContentError || callbackUrlOwnershipError || uncompressionError || notificationError;
        if (exception) {
          throw exception;
        }
      }
      // If everything went fine so far, return the succeded result
      return resolve((notifyRequesterResponse || {}).responseData);
    } catch (e) {
      return reject(e);
    }
  });
};