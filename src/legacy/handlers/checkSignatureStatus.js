"use strict";

const globals = require("../config/globals");
const httpClientHelper = require("../helpers/httpClient");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const dataCompressionHelper = require("../helpers/dataCompression");
const signedFileHelper = require("../helpers/signedFile");
const signaturesTable = require("../resources/tables/signatures");
const signaturesCheckTable = require("../resources/tables/signaturesCheck");
const formData = require("form-data");
const https = require("https");
const urlLib = require("url");
const pathLib = require("path");
const xmlParser = require("fast-xml-parser");

let lambdaInstanceId = null;
let clientFieldMappings = {};

const DEFAULT_ACCEPTABLE_ORIGIN_MEDIATYPES = [
  "application/pdf"
];

const CLASSIFIED_DOCUMENT_KINDS = [
  "EHR"
];

module.exports.handler = async (lambdaEvent, lambdaContext) => {  
  try {
    lambdaInstanceId = lambdaInstanceId || lambdaContext.awsRequestId; // using the first warmup call request ID as unique identifier for this Lambda instance

    // Immediate response for WarmUP plugin
    if (lambdaEvent.source === "serverless-plugin-warmup") {
      return responseHelper.warmup(lambdaInstanceId);
    }

    console.info(`\nLAMBDA INSTANCE ID: ${lambdaInstanceId}`);

    requestHelper.validateLambdaParameters(lambdaEvent, lambdaContext);
    requestHelper.validateRequestId(lambdaContext.awsRequestId);

    const pathParametersSchema = {
      "$id": "signature-checkSignatureStatus-inputPathParameters",
      "$async": true,
      "type": "object",
      "properties": {
        "requestIdOrShortId": {
          "type": "string",
          "minLength": 17
        }
      },
      "additionalProperties": false,
      "required": [
        "requestIdOrShortId"
      ]
    };
    let pathParameters = await requestHelper.parsePathParams(lambdaEvent.pathParameters, pathParametersSchema);

    const queryStringParametersSchema = {
      "$id": "signature-checkSignatureStatus-inputQueryStringParameters",
      "$async": true,
      "type": "object",
      "properties": {
        "subjectAuthorizeParamValue": {
          "type": "string",
          "minLength": 4
        },
        "subjectAuthorizeParamKind": {
          "type": "string",
          "oneOf": [
            {
              "enum": Object.keys(globals.specs.availableSubjectAuthorizeParamKindsMap || {})
            },
            {
              "pattern": `^(${Object.keys(globals.specs.availableSubjectAuthorizeParamKindsMap || {}).join("|")})\\|.*$`
            }
          ]
        }
      },
      "additionalProperties": false,
      "required": []
    };

    let queryStringParameters = {};
    
    if (lambdaEvent.queryStringParameters) {
      queryStringParameters = await requestHelper.parseQueryStringParams(lambdaEvent.queryStringParameters, queryStringParametersSchema);
    }

    let dbOperation = "queryByShortId";
    if (/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(pathParameters.requestIdOrShortId)) {
      dbOperation = "queryByRequestId";
    }

    let signatureRecord = await signaturesTable[dbOperation](pathParameters.requestIdOrShortId, ["requestId", "signerIdentity", "shortId", "sts"]);

    if ((!Array.isArray(signatureRecord) || signatureRecord.length === 0) || !signatureRecord) {
      throw errorHandlerHelper.error(404, "DocumentNotFound", "No document has been found for the parameters informed."); 
    }

    if (signatureRecord.length > 1) {
      throw errorHandlerHelper.error(409, "UndeterministicError", "More than one document found for the parameters informed."); 
    }

    signatureRecord = signatureRecord[0];

    let signatureStatusToReturn = (signatureRecord.sts === "SIGNED") ? "VALID" : "INVALID"; 
    let signingTimeStampAndCertificates = {};
    let documentKind = null;
    let documentRealm = "private";
    let unsignedDocumentXmlContent = null;
    let sourceDocumentFiles = {
      "status": "PRIVATE",
      "files": []
    };
    let signatureRecordDetails = {};
    let subjectAuthorizeParamToRequire = null;
    let subjectName = null;
    let signerName = null;

    let isDocumentFileViewAuthorized = false;
    let replacedBy = null;

    if (signatureStatusToReturn === "VALID") {
      try {
        signatureRecordDetails = await signaturesTable.queryByRequestId(signatureRecord.requestId, ["signatureType", "requestOrigin.client", "unsignedDocument.correlationId", "unsignedDocument.kind", "unsignedDocument.xmlContent", "unsignedDocument.compression", "signedDocument.compression", "signedDocument.signedContent", "checkCounter", "replacedBy"]);

        if (signatureRecordDetails && Array.isArray(signatureRecordDetails) && signatureRecordDetails.length === 1) {
          signatureRecordDetails = signatureRecordDetails[0];
        }

        if (!signatureRecordDetails) {
          throw errorHandlerHelper.error(404, "DocumentDetailsNotFound", "No document has been found for the parameters informed."); 
        }

        documentKind = signatureRecordDetails.unsignedDocument.kind;

        if (typeof documentKind === "undefined") {
          throw errorHandlerHelper.error(409, "MissingDocumentKind", "There is an inconsistency error: document kind not recorded on DB! Unable to proceed."); 
        }

        if (globals.specs.allowedDocumentKinds[documentKind]) {
          documentRealm = globals.specs.allowedDocumentKinds[documentKind].realm || documentRealm;
        }

        if (signatureRecordDetails.replacedBy) {
          signatureStatusToReturn = "REPLACED";

          try {
            let replacementSignature = await signaturesTable.queryByRequestId(signatureRecordDetails.replacedBy, ["shortId"]);
          
            if (replacementSignature && Array.isArray(replacementSignature) && replacementSignature.length === 1) {
              replacementSignature = replacementSignature[0];
            }
    
            if (replacementSignature) {
              replacedBy = replacementSignature["shortId"];
            }
          } catch (e) {
            console.warn("An error has ocurred while retrieving replacement signature data. Not so terrible. Proceeding just showing the status REPLACED anyway.", e);
          }
        } else {
          if (signatureRecordDetails.signedDocument.compression) {
            signatureRecordDetails.signedDocument.signedContent = await dataCompressionHelper.uncompress(signatureRecordDetails.signedDocument.signedContent, signatureRecordDetails.signedDocument.compression);
          }
        
          signingTimeStampAndCertificates = signedFileHelper.getSigningTimeStampAndCertificates(signatureRecordDetails.signedDocument.signedContent, "subject");
          
          if (signatureRecordDetails.signatureType === "CAdEs-attached") {
            unsignedDocumentXmlContent = signedFileHelper.getSignedRawContent(signatureRecordDetails.signedDocument.signedContent);
  
            if (!unsignedDocumentXmlContent) {
              throw errorHandlerHelper.error(500, "LoadUnsignedDocumentContentFromCadesError", "An emmpty data content has been retrieved from CAdEs-attached signature file. Unable to proceed."); 
            }
          }
  
          if (!unsignedDocumentXmlContent) {
            if (signatureRecordDetails.unsignedDocument.compression) {
              unsignedDocumentXmlContent = await dataCompressionHelper.uncompress(signatureRecordDetails.unsignedDocument.xmlContent, signatureRecordDetails.unsignedDocument.compression); 
              if (unsignedDocumentXmlContent instanceof Buffer) {
                unsignedDocumentXmlContent = unsignedDocumentXmlContent.toString();
              }
            } else {
              unsignedDocumentXmlContent = signatureRecordDetails.unsignedDocument.xmlContent;
            }
          }
  
          if (!unsignedDocumentXmlContent) {
            throw errorHandlerHelper.error(409, "MissingUnsignedDocument", "No unsigned document data has been found. Unable to proceed."); 
          }
  
          const parsedUnsignedXmlContent = xmlParser.parse(unsignedDocumentXmlContent);
          const clientSourceDocumentFieldMappings = getClientSourceDocumentFieldMappings(signatureRecordDetails.requestOrigin.client, documentKind);
  
          if (documentRealm === "private") {
            if (!queryStringParameters.subjectAuthorizeParamValue 
              && clientSourceDocumentFieldMappings 
              && globals.specs.availableSubjectAuthorizeParamKindsMap) {
            
              let enabledSubjectAuthorizeParams = [];
              let documentRootNode =  clientSourceDocumentFieldMappings.rootNode || null;
  
              for (let subjectAuthorizeParamKind in globals.specs.availableSubjectAuthorizeParamKindsMap) {
                if (globals.specs.availableSubjectAuthorizeParamKindsMap.hasOwnProperty(subjectAuthorizeParamKind)) {
                  let searchedNode = clientSourceDocumentFieldMappings[globals.specs.availableSubjectAuthorizeParamKindsMap[subjectAuthorizeParamKind]];
                  
                  if (!searchedNode) {
                    continue;
                  }
  
                  let candidateAuthorizeNodeValue = (documentRootNode ? (parsedUnsignedXmlContent[documentRootNode] || {}) : parsedUnsignedXmlContent)[searchedNode];
                  if (candidateAuthorizeNodeValue) {
                    if (subjectAuthorizeParamKind === "IDENTITY") {
                      let subjectIdentityKindNode = clientSourceDocumentFieldMappings.subjectIdentityKindNode;
                      let subjectIdentityKindNodeValue = globals.specs.defaultSubjectIdentityKind;
  
                      if (subjectIdentityKindNode) {
                        if ((documentRootNode ? (parsedUnsignedXmlContent[documentRootNode] || {}) : parsedUnsignedXmlContent)[subjectIdentityKindNode]) {
                          subjectIdentityKindNodeValue = (documentRootNode ? (parsedUnsignedXmlContent[documentRootNode] || {}) : parsedUnsignedXmlContent)[subjectIdentityKindNode];
                        }
                      }
                      subjectAuthorizeParamKind += `|${subjectIdentityKindNodeValue}`;
                    }
                    enabledSubjectAuthorizeParams.push(subjectAuthorizeParamKind);
                  }
                }
              }
              subjectAuthorizeParamToRequire = enabledSubjectAuthorizeParams[Math.floor(Math.random() * enabledSubjectAuthorizeParams.length)] || null;
            } else {
              if (queryStringParameters.subjectAuthorizeParamValue) {
                if (queryStringParameters.subjectAuthorizeParamKind) {
                  let subjectParamKindSplit = queryStringParameters.subjectAuthorizeParamKind;
                  if (queryStringParameters.subjectAuthorizeParamKind.startsWith("IDENTITY")) {
                    subjectParamKindSplit = queryStringParameters.subjectAuthorizeParamKind.split("|");
                    if (Array.isArray(subjectParamKindSplit) && subjectParamKindSplit.length === 2) {
                      queryStringParameters.subjectAuthorizeParamKind = subjectParamKindSplit[0];
                    }
                  }
  
                  let searchedNode = clientSourceDocumentFieldMappings[globals.specs.availableSubjectAuthorizeParamKindsMap[queryStringParameters.subjectAuthorizeParamKind]];

                  
                  if (Array.isArray(subjectParamKindSplit) && subjectParamKindSplit.length === 2) {
                    queryStringParameters.subjectAuthorizeParamKind = subjectParamKindSplit.join("|");
                  }
  
                  if (searchedNode) {
                    let documentRootNode =  clientSourceDocumentFieldMappings.rootNode || null;
                    let authorizeNodeValue = (documentRootNode ? (parsedUnsignedXmlContent[documentRootNode] || {}) : parsedUnsignedXmlContent)[searchedNode];

                    let paramValueClean = parseInt(queryStringParameters.subjectAuthorizeParamValue)                    
  
                    if (authorizeNodeValue && (authorizeNodeValue.toString().trim() === paramValueClean.toString().replace(/\s\-\.\//g,'')
                      || authorizeNodeValue.toString().trim() === paramValueClean)) {
                      isDocumentFileViewAuthorized = true;
                      if (clientSourceDocumentFieldMappings.subjectNameNode) {
                        subjectName = (documentRootNode ? (parsedUnsignedXmlContent[documentRootNode] || {}) : parsedUnsignedXmlContent)[clientSourceDocumentFieldMappings.subjectNameNode];
                      }
                    } else {
                      sourceDocumentFiles.status = "UNAUTHORIZED";
                    }
                  }
                }
              }
            }
          }
  
          if (documentRealm === "public" || isDocumentFileViewAuthorized === true) {
            sourceDocumentFiles = await fetchSourceDocumentPDFFiles(signatureRecord.shortId, signatureRecordDetails.requestOrigin.client, signatureRecordDetails.unsignedDocument.correlationId, signatureRecord.requestId);
            sourceDocumentFiles.files = sourceDocumentFiles.files.map((sourceDocumentFile) => {
              if (!sourceDocumentFile || sourceDocumentFile instanceof Error) {
                return "DOWNLOAD_ERROR";
              } else {
                return sourceDocumentFile;
              }
            });
          }
        }
      } catch (e) {
        if (!documentKind) {
          throw e;
        }
        sourceDocumentFiles.status === "ERROR";
        console.warn("Failed to retrieve details for signed document. Not so terrible situation. Returning just the status anyway.", e)
      }

      let totCertificates = (signingTimeStampAndCertificates.certificates || []).length;
      
      if (totCertificates > 0) {
        let signerCertificate = signingTimeStampAndCertificates.certificates[totCertificates - 1];
        signerCertificate = ((signerCertificate || "").split(",") || []).pop();
        if (typeof signerCertificate === "string") {
            let signerIdentityLabel = ((signerCertificate.split("=") || []).pop() || "").split(":");
            if (Array.isArray(signerIdentityLabel) && signerIdentityLabel.length === 2 && signerIdentityLabel[1].trim() === signatureRecord.signerIdentity.trim()) {
              signerName = signerIdentityLabel[0];
              let maskedSignerIdentityPrefix = signatureRecord.signerIdentity.substring(0, 3);
              signingTimeStampAndCertificates.certificates[totCertificates - 1] = signingTimeStampAndCertificates.certificates[totCertificates - 1].replace(signatureRecord.signerIdentity, maskedSignerIdentityPrefix + '*'.repeat(signatureRecord.signerIdentity.length - maskedSignerIdentityPrefix.length));
            }
        }
      }
    } else {
      signatureRecordDetails = await signaturesTable.queryByRequestId(signatureRecord.requestId, ["checkCounter"]);
    }

    let resultToReturn = {
      "status": signatureStatusToReturn,
      "documentRealm": documentRealm,
      "signingTimeStamp": signingTimeStampAndCertificates.signingTimeStamp || null,
      "kind": documentKind,
      "signerName": signerName || null,
      "certificates": signingTimeStampAndCertificates.certificates || [],
      "rawContent": ((documentRealm === "public" || isDocumentFileViewAuthorized === true) && CLASSIFIED_DOCUMENT_KINDS.indexOf(documentKind) === -1) ? unsignedDocumentXmlContent : null,
      "subjectName": subjectName || null,
      "subjectAuthorize" : {
        "paramKind": (documentRealm === "private") ? (queryStringParameters.subjectAuthorizeParamKind || subjectAuthorizeParamToRequire) : null,
        "paramValue": queryStringParameters.subjectAuthorizeParamValue || null,
      },
      "sourceDocumentFiles": sourceDocumentFiles,
      "verifyingTimeStamp": Date.now()
    };

    try {
      let tableKey = {
        "requestId": lambdaContext.awsRequestId,
        "signatureRequestId": signatureRecord.requestId,
        "signatureShortId":  signatureRecord.shortId
      };

      let dataToPersist = {
        "checkParameter": pathParameters.requestIdOrShortId,
        "checkResult": JSON.parse(JSON.stringify(resultToReturn))
      };

      await signaturesCheckTable.put(tableKey, dataToPersist, lambdaEvent.requestContext.identity);

      resultToReturn.authenticityCode = tableKey.requestId;
      resultToReturn.verifierKey = pathParameters.requestIdOrShortId;
      resultToReturn.longId = signatureRecord.requestId;
      resultToReturn.replacedBy = replacedBy;
    }  catch (e) {
      throw errorHandlerHelper.error(500, "StatusCheckPersistenceError", "Failed to persist signature status check request.", e); 
    }

    const signatureTableKey = {
      "requestId": signatureRecord.requestId,
      "signerIdentity": signatureRecord.signerIdentity
    }; 

    await signaturesTable.incrementCheckCounter(signatureTableKey, lambdaContext.awsRequestId, (typeof signatureRecordDetails.checkCounter === "undefined"));

    const omitFromLog = [
      "sourceDocumentFiles",
      "rawContent",
      "certificates"
    ];

    return responseHelper.success(lambdaContext.awsRequestId, resultToReturn, null, null, null, omitFromLog);
  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
};

const fetchSourceDocumentPDFFiles = async (signatureRecordShortId, clientName, correlationId, signatureRequestId) => {
  try {
    if (!clientName || !correlationId) {
      throw errorHandlerHelper.error(400, "MissingParametersError", "Either clientName or correlationId were not informed to fetch source documet files."); 
    }

    const enabledClientSourceDocumentsOrigins = globals.specs.enabledClientSourceDocumentsOrigins;

    if (!enabledClientSourceDocumentsOrigins) {
      return [];
    }

    if (!Array.isArray(enabledClientSourceDocumentsOrigins)) {
      throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", "There is an error in configuration for source document origins."); 
    }

    let sourceDocumentOriginSpecs = enabledClientSourceDocumentsOrigins.find((clientSrcDocOrigSpec) => {
      return clientSrcDocOrigSpec.client === clientName;
    });

    if (typeof sourceDocumentOriginSpecs  === "undefined") { //no source origin for the client who requested the document signature being checked
      return [];
    }

    if (sourceDocumentOriginSpecs.origin === undefined) {
      throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Source document origin for client ${clientName} is misconfigured. Property "origin" is not set.`); 
    }

    if (sourceDocumentOriginSpecs.origin.domain === undefined || typeof sourceDocumentOriginSpecs.origin.domain !== "string") {
      throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Source document origin for client ${clientName} is misconfigured. Property "origin.domain" is not set or it is not a valid string.`); 
    }

    if (sourceDocumentOriginSpecs.origin.port === undefined) {
      throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Source document origin for client ${clientName} is misconfigured. Property "origin.port" is not set.`); 
    }

    if (sourceDocumentOriginSpecs.origin.route === undefined || typeof sourceDocumentOriginSpecs.origin.route !== "string") {
      throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Source document origin for client ${clientName} is misconfigured. Property "origin.route" is not set or it is not a valid string.`); 
    }

    let formDataToSubmit = new formData();
    formDataToSubmit.append("correlationId", correlationId);
    formDataToSubmit.append("signatureRequestId", signatureRequestId);
  
    let requestParams = {
      "baseURL": `https://${sourceDocumentOriginSpecs.origin.domain + (sourceDocumentOriginSpecs.origin.port ? ":"+sourceDocumentOriginSpecs.origin.port : "")}`,
      "url": `${sourceDocumentOriginSpecs.origin.route}`,
      "data": formDataToSubmit,
      "headers": formDataToSubmit.getHeaders(),
      "responseType": "json"
    };

    let resultToReturn = {
      "status": "ERROR",
      "files": []
    };

    try {
      let sourceDocumentOriginResponse = await httpClientHelper.post(requestParams, sourceDocumentOriginSpecs.origin);
      if (sourceDocumentOriginResponse.responseStatus >= 200 && sourceDocumentOriginResponse.responseStatus < 300) {
        let returnedFilesMetadata = {};

        if (!sourceDocumentOriginResponse.responseData) {
          throw errorHandlerHelper.error(409, "CallSourceDocumentOriginError", `Origin responded with a success status code, but with an empty body.`); 
        }

        let acceptableMediaTypes = sourceDocumentOriginSpecs.origin.acceptableMediaTypes ;
        if (!Array.isArray(acceptableMediaTypes) || acceptableMediaTypes.length === 0) {
          acceptableMediaTypes = DEFAULT_ACCEPTABLE_ORIGIN_MEDIATYPES;
        }

        let dataProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataProperty;
        if (!dataProperty || typeof dataProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.dataProperty" is not set or it is not a valid string.`); 
        }

        let fileUrlProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.fileUrl;
        if (!fileUrlProperty || typeof fileUrlProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.fileUrl" is not set or it is not a valid string.`); 
        }

        let fileTitleProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.fileTitle;
        if (!fileTitleProperty || typeof fileTitleProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.fileTitle" is not set or it is not a valid string.`); 
        }

        let originFileIdProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.originFileId;
        if (!originFileIdProperty || typeof originFileIdProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.originFileId" is not set or it is not a valid string.`); 
        }

        let isFileAvailableProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.isFileAvailable;
        if (!isFileAvailableProperty || typeof isFileAvailableProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.isFileAvailable" is not set or it is not a valid string.`); 
        }

        let isFileAvailableMapProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.isFileAvailableMap;
        if (!isFileAvailableMapProperty || (Object.keys(isFileAvailableMapProperty) || []).length === 0) {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.isFileAvailableMap" is not set or it is not a valid object.`); 
        }

        let fileAvailableStampProperty = sourceDocumentOriginSpecs.origin.responseMapping && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate && sourceDocumentOriginSpecs.origin.responseMapping.dataTemplate.fileAvailableStamp;
        if (!fileAvailableStampProperty || typeof fileAvailableStampProperty !== "string") {
          throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "origin.responseMapping.dataTemplate.fileAvailableStamp" is not set or it is not a valid string.`); 
        }
        
        if (dataProperty.length > 0) {
          returnedFilesMetadata = sourceDocumentOriginResponse.responseData[sourceDocumentOriginSpecs.origin.responseMapping.dataProperty];
          if (!returnedFilesMetadata) {
            throw errorHandlerHelper.error(500, "SourceDocumentOriginMisconfigError", `Origin response data mapping for client ${clientName} is misconfigured. Property "${dataProperty}" does not exist in origin response body.`); 
          }
        } else {
          returnedFilesMetadata = sourceDocumentOriginResponse.responseData;
        }

        if (returnedFilesMetadata) {
          if (!Array.isArray(returnedFilesMetadata)) {
            returnedFilesMetadata = [returnedFilesMetadata];
          }

          resultToReturn.files = await downloadAllFiles(acceptableMediaTypes, signatureRecordShortId, returnedFilesMetadata, fileUrlProperty, fileTitleProperty, originFileIdProperty, isFileAvailableProperty, isFileAvailableMapProperty, fileAvailableStampProperty);
          resultToReturn.status = "FETCHED";
        }
      } else {
        throw errorHandlerHelper.error(500, "CallSourceDocumentOriginError", `Failed to fetching source document files from origin. Origin responded with status code ${sourceDocumentOriginResponse.responseStatus} and body ${JSON.stringify(sourceDocumentOriginResponse.responseData || {})}.`); 
      }
    } catch (e) {
      console.warn("An error has ocurred while trying to fetch source document files from origin. Proceeding without returning the files anyway to give requester the status response at least.", e);
    } finally {
      return resultToReturn;
    }
  } catch (e) {
    throw errorHandlerHelper.error(500, "FetchSourceDocumentPDFFilesError", "Failed to fetching source document files from origin.", e); 
  }
};

const downloadAllFiles = (acceptableMediaTypes, signatureRecordShortId, filesToDownload, fileUrlProperty, fileTitleProperty, originFileIdProperty, isFileAvailableProperty, isFileAvailableMapProperty, fileAvailableStampProperty) => {
  const uriRegex = new RegExp(/[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi);
  let promises = [];

  for (let i = 0, totI = filesToDownload.length; i < totI; i++) {
    if (filesToDownload[i][fileUrlProperty] && (filesToDownload[i][fileUrlProperty].match(uriRegex) || filesToDownload[i][fileUrlProperty] === null)) {
      promises.push(downloadFile(acceptableMediaTypes, signatureRecordShortId, filesToDownload[i], fileUrlProperty, fileTitleProperty, originFileIdProperty, isFileAvailableProperty, isFileAvailableMapProperty, fileAvailableStampProperty));
    }
  }

  return Promise.all(promises.map((pendingPromise) => {
    return pendingPromise.catch((e) => {
      console.warn("An error has occurred while downloading a file from origin.", e);
      return e; 
    });
  })).then((results) => {
    return results;
  }).catch((e) => {
    throw errorHandlerHelper.error(500, "DownloadAllFilesFromOriginError", "An unexpected error has ocurred while downloading all files from origin.", e);
  });
};

const downloadFile = (acceptableMediaTypes, signatureRecordShortId, fileSpecs, fileUrlProperty, fileTitleProperty, originFileIdProperty, isFileAvailableProperty, isFileAvailableMapProperty, fileAvailableStampProperty) => {
  return new Promise((resolve, reject) => {
    if (fileSpecs[fileUrlProperty] === undefined) {
      return reject(`No file URL informed. File specs received: ${JSON.stringify(fileSpecs)}`);
    }

    let fileAvailableValue = fileSpecs[isFileAvailableProperty];
    let isFileAvailable = (fileAvailableValue === undefined) || !!isFileAvailableMapProperty[fileAvailableValue]; //if requester client API did not send the availability data, then assumes the file is available

    if (isFileAvailable === false) {
      return resolve({
        "originFileId": fileSpecs[originFileIdProperty],
        "fileName": null,
        "fileTitle": fileSpecs[fileTitleProperty],
        "fileContent": null,
        "isBase64Encoded": false,
        "mediaType": null,
        "isFileAvailable": isFileAvailable,
        "fileAvailableAt": fileSpecs[fileAvailableStampProperty],
        "invalidAcceptableMediaType": false
      });
    }

    const req = https.request(fileSpecs[fileUrlProperty], (res) => {
      let wholeBody = [];

      res.on("data", (chunk) => {
        wholeBody.push(chunk);
      })
      .on("end", () => {
        let isBase64Encoded = true;
        wholeBody = Buffer.concat(wholeBody).toString("base64");

        let parsedFileUrl = urlLib.parse(fileSpecs[fileUrlProperty]);
        let fileName = signatureRecordShortId + "_" + fileSpecs[originFileIdProperty] + "_" +  ((parsedFileUrl) ? pathLib.basename(parsedFileUrl.pathname) : (res.headers["x-amz-request-id"] || ""));

        if (acceptableMediaTypes.indexOf(res.headers["content-type"]) >= 0) {
          return resolve({
            "originFileId": fileSpecs[originFileIdProperty],
            "fileName": fileName,
            "fileTitle": fileSpecs[fileTitleProperty],
            "fileContent": wholeBody,
            "isBase64Encoded": isBase64Encoded,
            "mediaType": res.headers["content-type"],
            "isFileAvailable": isFileAvailable,
            "fileAvailableAt": fileSpecs[fileAvailableStampProperty] || null,
            "invalidAcceptableMediaType": false
          });
        } else {
          return resolve({
            "originFileId": fileSpecs[originFileIdProperty],
            "fileName": fileName,
            "fileTitle": fileSpecs[fileTitleProperty],
            "fileContent": null,
            "isBase64Encoded": false,
            "mediaType": res.headers["content-type"],
            "isFileAvailable": isFileAvailable,
            "fileAvailableAt": fileSpecs[fileAvailableStampProperty],
            "invalidAcceptableMediaType": true
          });
        }
      });
    });

    req.on("error", (err) => {
      return reject(err);
    });

    req.end();
  });
};

const getClientSourceDocumentFieldMappings = (clientName, documentKind) => {
  try {

    clientFieldMappings[clientName] = clientFieldMappings[clientName] || {};

    if (clientFieldMappings[clientName][documentKind]) {
      return clientFieldMappings[clientName][documentKind];
    }
    
    const currentClientSourceDocumentFieldMappings =  (globals.specs.clientSourceDocumentFieldMappings || []).find((clientFieldMapping) => {
      return clientFieldMapping.client === clientName;
    });

    if (!currentClientSourceDocumentFieldMappings) {
      throw errorHandlerHelper.error(500, "ClientDocumentFieldsMappingsError", `No document fields mapping were found for client ${clientName}.`); 
    }

    if (!Array.isArray(currentClientSourceDocumentFieldMappings.fieldMappings)) {
      throw errorHandlerHelper.error(500, "ClientDocumentFieldsMappingsError", `There is a misconfiguration in field mappings entry for client ${clientName}.`); 
    }

    const clientSourceDocumentFieldMappingsForActualDocKind = currentClientSourceDocumentFieldMappings.fieldMappings.filter((fieldMapping) => {
      return fieldMapping.applicableDocumentKinds.indexOf("*") >= 0 || fieldMapping.applicableDocumentKinds.indexOf(documentKind) >= 0;
    });

    if (!Array.isArray(clientSourceDocumentFieldMappingsForActualDocKind) || clientSourceDocumentFieldMappingsForActualDocKind.length === 0) {
      throw errorHandlerHelper.error(500, "ClientDocumentFieldsMappingsError", `No document fields mapping were found for client ${clientName} and document kind ${documentKind}.`); 
    }

    let clientFieldMapppingSelected = clientSourceDocumentFieldMappingsForActualDocKind.find((clientFieldMapping) => {
      return clientFieldMapping.applicableDocumentKinds.indexOf(documentKind) >=0;
    });

    if (!clientFieldMapppingSelected) {
      clientFieldMapppingSelected = clientSourceDocumentFieldMappingsForActualDocKind.find((clientFieldMapping) => {
        return clientFieldMapping.applicableDocumentKinds.indexOf("*") >=0;
      });
    }

    if (!clientFieldMapppingSelected) {
      throw errorHandlerHelper.error(500, "ClientDocumentFieldsMappingsError", `No document fields mapping were found for client ${signatureRecordDetails.requestOrigin.client} and document kind ${documentKind}.`); 
    }

    clientFieldMappings[clientName][documentKind] = clientFieldMapppingSelected;

    return clientFieldMapppingSelected;

  } catch (e) {
    throw errorHandlerHelper.error(500, "GetClientSourceDocumentFieldMappings", "Failed to get client document field mappings.", e); 
  }
};
