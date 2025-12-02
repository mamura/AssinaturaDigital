"use strict";

const globals = require("../../config/globals");
const formData = require("form-data");
const httpClientHelper = require("../../helpers/httpClient");
const errorHandlerHelper = require("../../helpers/errorHandler");
const ssmParameterStoreHelper = require("../../helpers/ssmParameterStore");
const cacheTableHelper = require("../../helpers/cacheTable");
const requestHelper = require("../../helpers/request");
const url = require("url");

module.exports.authorizeSignerKey = async (params) => {
  try {
    let enabledEnvironmentRouteLabels = getEnabledProviderEnvironmentRouteLabels();

    let signerDiscoveryPromises = [];

    enabledEnvironmentRouteLabels.forEach(environmentRouteLabel => {
      if (environmentRouteLabel !== "VAULTID") { //bypass as workaround for latency and timout issues at endpoint /oauth/user-discovery
        signerDiscoveryPromises.push({
          "environment": environmentRouteLabel,
          "promise": signerEnvironmentRouteDiscovery(environmentRouteLabel, params.signerIdentity)
        });
      }
    });

    let signerDiscoveryPromisesResults = await Promise.all(signerDiscoveryPromises.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Request to discovery signer ${params.signerIdentity} at provider's environment ${pendingPromise.environment} successfully completed. Result returned: ${JSON.stringify(res || {})}`);
        return {
          "environment": pendingPromise.environment,
          "response": res 
        };
      })
      .catch((e) => {
        console.warn(`An error has occurred while discoverying signer ${params.signerIdentity} at provider's environment ${pendingPromise.environment}.`, e);
        return {
          "environment": pendingPromise.environment,
          "response": {
            "status": "ERROR",
            "details": e
          } 
        };
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "SignerDiscoveryPromisesResultsError", "An unexpected error has ocurred while executing promises for discoverying signer in provider's environments.", e);
    });

    let signerAuthenticated = false;
    let authErrors = [];
    let authenticationResult = null;

    for (let signerDiscoveryResult of signerDiscoveryPromisesResults) {
      try {
        authenticationResult = null;

        if (!signerAuthenticated) {
          if (signerDiscoveryResult.response.status === "S") {
            authenticationResult = await requestSignerKeyAuthorization(signerDiscoveryResult.environment, params);
            signerAuthenticated = true;
            break;
          }
          
          if (signerDiscoveryResult.response.status === "N") {
            authErrors.push(errorHandlerHelper.error(404, "SignerDiscoveryFailed", `Signer not found at provider's environment: [${signerDiscoveryResult.environment}].`));
          }
          
          if (signerDiscoveryResult.response.status === "ERROR") {
            if (signerDiscoveryResult.response.details instanceof Error) {
              authErrors.push(signerDiscoveryResult.response.details);
            } else {
              authErrors.push(errorHandlerHelper.error(500, "SignerKeyAuthorizationError", `An unexpected response found while checking failure response result from provider's environment ${signerDiscoveryResult.environment} for signer ${params.signerIdentity}. Result details: ${JSON.stringify(signerDiscoveryResult || {})}.`));
            }
          }
        }
      } catch (e) {
        authErrors.push(e);
      }
    }

    if (!signerAuthenticated) { //workaround for latency and timout issues at endpoint /oauth/user-discovery
      try { 
        authenticationResult = await requestSignerKeyAuthorization("VAULTID", params);
        signerAuthenticated = true;
      } catch (e) {
        authErrors.push(e);
      }
    }

    if (!signerAuthenticated) {
      if (authErrors.length == 0) { //just in case
        authErrors.push(errorHandlerHelper.error(401, "UnauthorizedError", "Invalid credentials sent to authorize signer's key."));
      }

      throw errorHandlerHelper.error(401, "UnauthorizedErrors", "Unable to authorize signer's key in provider's multi-cloud environment.", (authErrors.length === 1 ? authErrors[0] : authErrors));
    }

    if (Array.isArray(authErrors) && authErrors.length > 0) {
      console.warn(`Singer's authorization has failed at least in one of provider's environmnt: ${JSON.stringify(authErrors)}`)
    }

    return authenticationResult;
    
  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "SignerKeyAuthorizationNotPerformed", "Failed to perform signer's key authorization.", e);
  }
};

module.exports.startSignatureTransaction = async (params) => {
  try {
    const providerEndpoint = "/signature-service";
    const signatureType = "CAdEs-attached";
    const signaturePolicy = "AD_RT";
    //const signaturePolicy = "AD_RB";
    const signatureDocumentSource = "UPLOAD_REFERENCE";
    const signatureHashAlgorithm = "SHA256";
    const tsaHashAlgorithm = "SHA256";
    const tsaServerId = process.env.CA_PRV_SOLUTI_TIMESTAMP_AUTHORITY_SERVER_ID;
    
    const commitmentTypeIndication = (params.signatureAttributes || {}).commitmentTypeIndication 
                                    || globals.specs.signatureAttributes.commitmentTypeIndication.defaultValue;
    const commitmentType = globals.specs.signatureAttributes.commitmentTypeIndication.allowedValues[commitmentTypeIndication];
    
    const signatureSettingsProfileId = (typeof commitmentType !== undefined) ? `commitmentType_${commitmentTypeIndication}` : null;

    let requestParams = {
      "baseURL": process.env.CA_PRV_SOLUTI_BASE_CESS_API_URL,
      "url": providerEndpoint,
      "data": {
        "certificate_alias": params.signerCertificateAlias || "",
        "notification_callback": params.serviceNotificationCallback,
        "type": signatureType,
        "policy": signaturePolicy,
        "hash_algorithm": signatureHashAlgorithm,
        "documents_source": signatureDocumentSource,
        "tsa_hash_algorithm": tsaHashAlgorithm,
        "tsa_server_id": tsaServerId,
        "signature_settings": (() => {
          let settingsToApply = [];
          if (typeof commitmentType !== undefined) {
            settingsToApply.push({
              "id": signatureSettingsProfileId,
              "commitmentType": {
                "id": commitmentType,
                "qualifier": params.signerIdentity
              }
            });
          }
          return settingsToApply;
        })()
      },
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${params.signerAuthorization}`
      },
      "responseType": "json"
    };

    let providerStartTransactionResponse = await httpClientHelper.post(requestParams);

    if (!(providerStartTransactionResponse.responseStatus >= 200 && providerStartTransactionResponse.responseStatus < 300)) {
      if (providerStartTransactionResponse.responseStatus === 401 || providerStartTransactionResponse.responseStatus === 404) {
        throw errorHandlerHelper.error(providerStartTransactionResponse.responseStatus, "AuthorizationError", `Unable to start signature transaction due to authorization issues. Provider returned with status code ${providerStartTransactionResponse.responseStatus} and body details: ${JSON.stringify(providerStartTransactionResponse.responseData || {})}`);
      }
      throw errorHandlerHelper.error(500, "RequestError", `Provider returned with status code ${providerStartTransactionResponse.responseStatus} and body details: ${JSON.stringify(providerStartTransactionResponse.responseData || {})}`);
    }

    if (!(providerStartTransactionResponse.responseData && providerStartTransactionResponse.responseData.tcn)) {
      throw errorHandlerHelper.error(500, "RequestError", `Something went wrong while requesting provider to start signature transaction. Transaction control (TCN) token has not been returned on response. Body returned: ${JSON.stringify(providerStartTransactionResponse.responseData || {})}`);
    }

    if (!(providerStartTransactionResponse.responseData && providerStartTransactionResponse.responseData.certificate_alias)) {
      throw errorHandlerHelper.error(500, "RequestError", `Something went wrong while requesting provider to start signature transaction. Selected signer's certificate has not been returned on response. Value returned: ${providerStartTransactionResponse.responseData.certificate_alias}`);
    }

    if (params.signerCertificateAlias && params.signerCertificateAlias !== providerStartTransactionResponse.responseData.certificate_alias) {
      throw errorHandlerHelper.error(409, "FailedSignatureRequest", "Selected signer's certificate returned on provider's response diverges from the one informed on request.");
    }

    let resultToReturn = {
      "providerSignatureId": providerStartTransactionResponse.responseData.tcn,
      "signerCertificateAlias": providerStartTransactionResponse.responseData.certificate_alias,
      "signatureType": signatureType,
      "signaturePolicy": signaturePolicy,
      "signatureHashAlgorithm": signatureHashAlgorithm,
      "signatureDocumentSource": signatureDocumentSource,
      "tsaHashAlgorithm": tsaHashAlgorithm,
      "tsaServerId": tsaServerId,
      "signatureSettingsProfileId": (typeof commitmentType !== undefined) ? signatureSettingsProfileId : null
    };

    return resultToReturn;

  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedSignatureRequest", "Failed to start signature transaction at provider.", e);
  }
};

module.exports.uploadDocument = async (params) => {
  try {
    const providerEndpoint = "/file-transfer";

    var formDataToSubmit = new formData();
    formDataToSubmit.append("document[0]", params.unsignedDocument.xmlContent, params.unsignedDocument.fileName);

    let requestParams = {
      "baseURL": process.env.CA_PRV_SOLUTI_BASE_CESS_API_URL,
      "url": `${providerEndpoint}/${params.providerSignatureId}/eot${params.signatureSettingsProfileId ? "/" + params.signatureSettingsProfileId : ""}`,
      "data": formDataToSubmit,
      "headers": formDataToSubmit.getHeaders(),
      "responseType": "json"
    };

    let uploadDocumentResponse = await httpClientHelper.post(requestParams);

    if (!(uploadDocumentResponse.responseStatus >= 200 && uploadDocumentResponse.responseStatus < 300)) {
      throw errorHandlerHelper.error(500, "RequestError", `Provider returned with status code ${uploadDocumentResponse.responseStatus} and body details: ${JSON.stringify(uploadDocumentResponse.responseData || {})}`);
    }

    if (!(uploadDocumentResponse.responseData && uploadDocumentResponse.responseData.tcn)) {
      throw errorHandlerHelper.error(500, "RequestError", "Something went wrong while uploading document to provider. Transaction control (TCN) token has not been returned on response.");
    }

    if (params.providerSignatureId !== uploadDocumentResponse.responseData.tcn) {
      throw errorHandlerHelper.error(409, "FailedUploadRequest", `Transaction control TCN on provider's response diverges from the providerSignatureId informed on request. Value returned: ${uploadDocumentResponse.responseData.tcn}`);
    }

    if (!(uploadDocumentResponse.responseData && uploadDocumentResponse.responseData.eot === true)) {
      throw errorHandlerHelper.error(500, "RequestError", `Something went wrong while uploading document to provider. Provider eot flag returned must has value true. Current value: ${uploadDocumentResponse.responseData.eot}`);
    }

    let resultToReturn = {
      "providerSignatureId": uploadDocumentResponse.responseData.tcn,
      "uploadConcluded": (uploadDocumentResponse.responseData.eot === true)
    };

    return resultToReturn;

  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedDocumentUpload", "Failed to upload document to provider.", e);
  }
};

module.exports.getReadySignatureFileUrl = async (callbackRequestBody) => {
  try {
    let parsedCallbackBody = await parseCallbackBody(callbackRequestBody);
    let readySignatureFileUrl = parsedCallbackBody.documents[0].result;

    let readySignatureFileUrlParts = url.parse(readySignatureFileUrl);
    let providerBaseUrlParts = url.parse(process.env.CA_PRV_SOLUTI_BASE_CESS_API_URL);

    if (readySignatureFileUrlParts.hostname !== providerBaseUrlParts.hostname) {
      throw errorHandlerHelper.error(404, "InvalidReadySignatureFileUrl", "URL for ready signature file is not allowed.");
    }

    let readySignatureFileUrlComponents = {
      "baseURL": process.env.CA_PRV_SOLUTI_BASE_CESS_API_URL,
      "url": readySignatureFileUrlParts.pathname
    };

    return readySignatureFileUrlComponents;
  } catch (e) {
    throw errorHandlerHelper.error(400, "ReadySignatureFileUrlResolutionFail", `An error has ocurred while trying to resolve URL for ready signature file from provider's callback request body. Returned callback body: ${JSON.stringify(callbackRequestBody || {})}`, e);
  }
};

module.exports.checkSignatureTransactionStatus = async (providerSignatureId) => {
  try {
    const providerEndpoint = `/signature-service/${providerSignatureId}`;

    let requestParams = {
      "baseURL": process.env.CA_PRV_SOLUTI_BASE_CESS_API_URL,
      "url": providerEndpoint,
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      "responseType": "json"
    };

    let providerCheckSignatureTransactionStatusResponse = await httpClientHelper.get(requestParams);

    if (!(providerCheckSignatureTransactionStatusResponse.responseStatus >= 200 && providerCheckSignatureTransactionStatusResponse.responseStatus < 300)) {
      let statusToReturn = providerCheckSignatureTransactionStatusResponse.responseStatus;
      throw errorHandlerHelper.error(statusToReturn, "RequestError", `Provider returned with status code ${providerCheckSignatureTransactionStatusResponse.responseStatus} and body details: ${JSON.stringify(providerCheckSignatureTransactionStatusResponse.responseData || {})}`);
    }

    if (!providerCheckSignatureTransactionStatusResponse.responseData || Object.keys(providerCheckSignatureTransactionStatusResponse.responseData).length === 0) {
      throw errorHandlerHelper.error(409, "EmptyBodyError", `Provider returned an empty body.`);
    }

    if (!Array.isArray(providerCheckSignatureTransactionStatusResponse.responseData.documents) || providerCheckSignatureTransactionStatusResponse.responseData.documents.length === 0) {
      throw errorHandlerHelper.error(409, "MissingExpectedResultError", `No document data has been returned on provider response.`);
    }

    if (providerCheckSignatureTransactionStatusResponse.responseData.documents.length > 1) {
      throw errorHandlerHelper.error(409, "IndeterministicResultError", `Indeterministic error: more than one document has been returned on provider response.`);
    }

    let resultToReturn = {
      "providerSignatureId": providerCheckSignatureTransactionStatusResponse.responseData.tcn,
      "signerCertificateAlias": providerCheckSignatureTransactionStatusResponse.responseData.certificate_alias,
      "signatureType": providerCheckSignatureTransactionStatusResponse.responseData.type,
      "signatureHashAlgorithm": providerCheckSignatureTransactionStatusResponse.responseData.hash_algorithm,
      "signatureDocumentSource": providerCheckSignatureTransactionStatusResponse.responseData.documents_source,
      "useTsa": providerCheckSignatureTransactionStatusResponse.responseData.tsa,
      "transactionCompleted":  providerCheckSignatureTransactionStatusResponse.responseData.eot,
      "document": {
        "transactionDocumentIndex": providerCheckSignatureTransactionStatusResponse.responseData.documents[0].id,
        "mediaType": providerCheckSignatureTransactionStatusResponse.responseData.documents[0].mediatype,
        "signatureStatus": providerCheckSignatureTransactionStatusResponse.responseData.documents[0].status,
        "signedFileUrl": providerCheckSignatureTransactionStatusResponse.responseData.documents[0].result
      }
    };

    return resultToReturn;

  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedSignatureTransactionStatusRequest", "Failed to check signature status at provider.", e);
  }
};

module.exports.getCachedSignerKeyAuthorization = async (environmentRouteLabel, signerIdentity, clientName) => {
  try {
    if (!signerIdentity || !clientName) {
      throw errorHandlerHelper.error(400, "InvalidParametersError", "Either signer identity or client name is missing to retrieve cached signer's key authorization.");
    }

    let enabledEnvironmentRouteLabels = getEnabledProviderEnvironmentRouteLabels();
    let indicatedEnvironmentRouteLabel = null;

    if (environmentRouteLabel && environmentRouteLabel.length > 0) {
      if (enabledEnvironmentRouteLabels.indexOf(environmentRouteLabel) == -1) {
        throw errorHandlerHelper.error(400, "InvalidProviderEnvironmentRouteLabel", `Environment route label [${environmentRouteLabel}] is invalid for provider [SOLUTI].`);
      }
      indicatedEnvironmentRouteLabel = [environmentRouteLabel];
    }

    const newGetKeyFromCacheTablePromise = (provider, environmentRouteLabel, signerIdentity, clientName) => {
      return new Promise(async (resolve, reject) => {
        let cachedSignerAuthorizationKey = null;
        if (environmentRouteLabel) {
          cachedSignerAuthorizationKey = `signerAuthToken_${provider}_${environmentRouteLabel}_${signerIdentity}_${clientName}`;
        } else {
          cachedSignerAuthorizationKey = `signerAuthToken_${provider}_${signerIdentity}_${clientName}`; //for compatibility reasons
        }
        try {
          let signerCachedAuthToken =  await cacheTableHelper.get(cachedSignerAuthorizationKey);
          console.info(`Signer's key authorization found in cache for key ${cachedSignerAuthorizationKey}`);
          return resolve(signerCachedAuthToken);
        } catch (e) {
          console.warn(`No cached signer's key authorization found in cache for key ${cachedSignerAuthorizationKey}`);
          return reject(e);
        }
      });
    };

    let cachedSignerAuthorizationPromises = [];

    (indicatedEnvironmentRouteLabel || enabledEnvironmentRouteLabels).forEach(environmentRouteLabel => {
      cachedSignerAuthorizationPromises.push({
        "environment": environmentRouteLabel,
        "promise": newGetKeyFromCacheTablePromise("SOLUTI", environmentRouteLabel, signerIdentity, clientName)
      });
    });

    //compabitility reasons
    //to keep using cached authorization signer key before stored before using 
    if ((indicatedEnvironmentRouteLabel || []).indexOf("VAULTID") >=0 || enabledEnvironmentRouteLabels.indexOf("VAULTID") >=0) {
      cachedSignerAuthorizationPromises.push({
        "environment": "VAULTID",
        "promise": newGetKeyFromCacheTablePromise("SOLUTI", null, signerIdentity, clientName)
      });
    }

    let cachedSignerResults = await Promise.all(cachedSignerAuthorizationPromises.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Cached signer's key authorization for environment ${pendingPromise.environment} successfully retrieved for signer ${signerIdentity}`);
        return res;
      })
      .catch((e) => {
        console.warn(`An error has occurred retrieving cached signer's key authorization for environment ${pendingPromise.environment} for signer ${signerIdentity}.`, e);
        return e;
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "CachedSignerKeyAuthorizationRetrievalError", "An unexpected error has ocurred while retrieving cached singer's key authorization for provider [SOLUTI].", e);
    });

    let succeededResults = cachedSignerResults.filter((result) => {
      let notAnError = !(result instanceof Error);

      if (notAnError) {
        if (!result.jwtTokenPayload.environment || result.jwtTokenPayload.environment == "") {
          result.jwtTokenPayload.environment = "VAULTID"
        }
      }

      return notAnError;
    });

    if (succeededResults.length === 0) {
      throw errorHandlerHelper.error(404, "NoSignerKeyAuthorizationInCache", `No key authorization for signer ${signerIdentity} found in cache for provider [SOLUTI]`);
    }

    succeededResults.sort((a, b) => {
      let bTimeToCompare = b._updatedAt ? b._updatedAt : b._createdAt;
      let aTimeToCompare = a._updatedAt ? a._updatedAt : a._createdAt;

      return bTimeToCompare - aTimeToCompare; //descending order
    });

    let resultToReturn = succeededResults.shift();
    delete resultToReturn._createdAt;
    delete resultToReturn._updatedAt;

    return resultToReturn;

  } catch (e) {
    throw errorHandlerHelper.error(500, "FailedToGetCachedSignerKeyAuthorization", "Something went wrong while trying to recovery cached signer's key authorization for provider [SOLUTI].", e);
  }
};

module.exports.storeSignerKeyAuthorizationInCache = async (environmentRouteLabel, signerIdentity, clientName, dataToCache) => {
  try {
    const enabledEnvironmentRouteLabels = getEnabledProviderEnvironmentRouteLabels();

    if (enabledEnvironmentRouteLabels.indexOf(environmentRouteLabel) === -1) {
      throw errorHandlerHelper.error(400, "InvalidEnvironmentRouteLabel", `Route label [${environmentRouteLabel}] is invalid for provider [SOLUTI].`);
    }

    if (!signerIdentity || !clientName) {
      throw errorHandlerHelper.error(400, "InvalidParams", `Either signer identity or requester client name was not informed. Unbale to proceed.`);
    }

    const cacheSignerAuthorizationBodySchema = {
      "$id": "soluti-signer-authorization-data-to-cache",
      "$async": true,
      "type": "object",
      "properties": {
        "jwtTokenPayload": {
          "type": "object",
          "properties": {
            "jti": {
              "type": "string",
              "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
            },
            "aud": {
              "type": "string"
            },
            "sub": {
              "type": "string"
            },
            "iat": {
              "type": "number"
            },
            "exp": {
              "type": "number"
            },
            "accessToken": {
              "type": "string"
            },
            "tokenType": {
              "type": "string",
              "enum": ["bearer"]
            },
            "provider": {
              "const": "SOLUTI"
            },
            "environment": {
              "type": "string",
              "enum": enabledEnvironmentRouteLabels
            }
          },
          "additionalProperties": true,
          "required": [
            "accessToken",
            "sub",
            "iat",
            "exp",
            "provider",
            "jti",
            "environment"
          ]
        },
        "signerCertificates": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "alias": {
                "type": "string"
              },
              "provider": {
                "const": "SOLUTI"
              },
              "environment": {
                "type": "string",
                "enum": enabledEnvironmentRouteLabels
              }
            },
            "additionalProperties": true,
            "required": [
              "alias"
            ]
          },
          "minItems": 1
        },
        "stampExpiration": {
          "type": "number"
        }
      },
      "additionalProperties": false,
      "required": [
        "jwtTokenPayload",
        "signerCertificates",
        "stampExpiration"
      ]
    };

    let parsedDataToCache = null;

    try {
      parsedDataToCache = await requestHelper.parseBody(dataToCache, cacheSignerAuthorizationBodySchema);
    } catch (e) {
      throw errorHandlerHelper.error(400, "InvalidParams", `Incomplete signer's key authorization token data sent to be stored into cache. Unbale to proceed.`);
    }
    
    await cacheTableHelper.set(`signerAuthToken_SOLUTI_${environmentRouteLabel}_${signerIdentity}_${clientName}`, parsedDataToCache); 
  } catch (e) {
    throw errorHandlerHelper.error(500, "FailedToStoreSignerKeyAuthorizationIntoCache", "Something went wrong while trying to store signer's key authorization into cache for provider [SOLUTI].", e);
  }
};

const requestSignerKeyAuthorization = async (environmentRouteLabel, params) => {
  try {

    let serviceAuthParameters = await ssmParameterStoreHelper.getParameters([`serviceSolutiClientId-${environmentRouteLabel}`, `serviceSolutiClientSecret-${environmentRouteLabel}`], true, true);
      
    const providerEndpoint = "/oauth";
    const authTokenLifetimeSeconds = 12 * 60 * 60; // 12 hours at least
    const authTokenLifetimeOffSeconds = 0 * 60; // 0 minutes
    const authScope =  "signature_session";

    let requestParams = {
      "baseURL": getProviderEnvironmentAPIRoute(environmentRouteLabel), 
      "url": providerEndpoint,
      "data": {
        "client_id": serviceAuthParameters[`serviceSolutiClientId-${environmentRouteLabel}`],
        "client_secret": serviceAuthParameters[`serviceSolutiClientSecret-${environmentRouteLabel}`],
        "username": params.signerIdentity,
        "password": params.otp,
        "grant_type": "password",
        "scope": authScope,
        "lifetime": authTokenLifetimeSeconds
      },
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      "responseType": "json",
      "timout": 20000
    };

    const now = new Date();
    let signerKeyAuthorizationResponse = await httpClientHelper.post(requestParams);

    if (signerKeyAuthorizationResponse.responseStatus === 200) {
      let signerCertificates = await discoverySignerCertificates(environmentRouteLabel, params.signerIdentity, {"returnChain": false}, true);

      if (!signerCertificates || signerCertificates.length === 0) {
        throw errorHandlerHelper.error(401, "SignerCertificateNotFound", `Unable to retrieve signer's certificate at provider environment: [${environmentRouteLabel}].`);
      }

      let expiresInSeconds = Number(((signerKeyAuthorizationResponse.responseData.expires_in) ? signerKeyAuthorizationResponse.responseData.expires_in : 0));
      expiresInSeconds = (expiresInSeconds > authTokenLifetimeOffSeconds) ? (expiresInSeconds - authTokenLifetimeOffSeconds) : expiresInSeconds;

      return {
        "signerIdentity": params.signerIdentity,
        "certificates": signerCertificates,
        "accessToken": signerKeyAuthorizationResponse.responseData.access_token,
        "tokenType": signerKeyAuthorizationResponse.responseData.token_type,
        "issuedAt": Math.floor(now.getTime() / 1000),
        "expiresAt": Math.floor((now.getTime() + (expiresInSeconds * 1000)) / 1000),
        "expiresInSeconds": expiresInSeconds,
        "environment": environmentRouteLabel
      };
    } else {
      if (signerKeyAuthorizationResponse.responseData && signerKeyAuthorizationResponse.responseData.detail && signerKeyAuthorizationResponse.responseData.detail.status === "INVALID_CREDENTIALS") {
        throw errorHandlerHelper.error(401, "UnauthorizedError", "Invalid credentials sent to authorize signer's key.");
      } else {
        throw errorHandlerHelper.error(500, "RequestError", `Unable to authorize signer's key at provider. Provider returned with status code ${signerKeyAuthorizationResponse.responseStatus} and body details: ${JSON.stringify(signerKeyAuthorizationResponse.responseData || {})}.`);
      }
    }
  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedSignerKeyAuthorization", `Failed to authorize signer's key at provider's environment: [${environmentRouteLabel}].`, e);
  }
};

const parseCallbackBody = async (callbackRequestBody) => {
  try {
    const callbackBodySchema = {
      "$id": "soluti-callback-inputBody",
      "$async": true,
      "type": "object",
      "properties": {
        "documents": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "result": {
                "type": "string",
                "format": "uri"
              }
            },
            "additionalProperties": true,
            "required": [
              "result"
            ]
          },
          "minItems": 1,
          "maxItems": 1
        }
      },
      "additionalProperties": true,
      "required": [
        "documents"
      ]
    };

    let parsedCallbackBody = await requestHelper.parseBody(callbackRequestBody, callbackBodySchema);
    return parsedCallbackBody;
  } catch (e) {
    throw errorHandlerHelper.error(400, "CallbackBodyValidationError", "Failed to validate provider's callback request body.", e);
  }
};

const discoverySignerCertificates = async (environmentRouteLabel, signerIdentity, params, onlyAliases) => {
  try {
    let serviceAuthorizationToken = await authenticateService(environmentRouteLabel, false);

    const providerEndpoint = "/user-discovery";

    const pathParams = {
      "document": signerIdentity,
      "return_chain": params.returnChain || false,
      "return_chain_by_reference": false,
      "return_fields_format": false,
      "return_additional_fields": true
    };

    let requestParams = {
      "baseURL": getProviderEnvironmentAPIRoute(environmentRouteLabel),
      "url": providerEndpoint,
      "params": pathParams,
      "data": null,
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${serviceAuthorizationToken}`
      },
      "responseType": "json"
    };

    let signerCertificates = await httpClientHelper.get(requestParams);

    if (signerCertificates.responseStatus !== 200) {
      if (signerCertificates.responseStatus === 401) {
        try {
          await authenticateService(environmentRouteLabel, true); //forces re-authenticate service and store the new token
        } catch (e) {
          console.warn(`For some reason, service token for provider environment [${environmentRouteLabel}] is not valid anymore. Tentative to re-authenticate service failed as well`, e);
        }
        throw errorHandlerHelper.error(500, "UnauthorizedError", "Service failed to access provider's endpoint due to authorization issues. Possibly, sercice access token is no longer valid.");
      } else {
        if (signerCertificates.responseData && signerCertificates.responseData.detail) {
          switch (signerCertificates.responseData.detail.status) {
            case "INVALID_ACCESS_TOKEN":
              throw errorHandlerHelper.error(500, "UnauthorizedError", `Service failed to access provider's endpoint due to authorization issues. Status returned by provider: ${signerCertificates.responseData.detail.status}`);
            case "USERS_EXCEEDED_MAXIMUM_ALLOWED":
              throw errorHandlerHelper.error(500, "BadRequestError", `Service failed to access provider's endpoint due to bad use. Status returned by provider: ${signerCertificates.responseData.detail.status}`);
            default:
              throw errorHandlerHelper.error(500, "RequestError", `Service failed to access provider's endpoint. Status returned by provider: ${signerCertificates.responseData.detail.status}`);
          }
        } else {
          throw errorHandlerHelper.error(500, "RequestError", `Service received an error status from provider: ${signerCertificates.responseStatus}.`);
        }
      } 
    }

    if (signerCertificates.responseData && signerCertificates.responseData.detail && signerCertificates.responseData.detail.status === "NO_CERTIFICATE_FOUND") {
      throw errorHandlerHelper.error(401, "SignerCertificateNotFound", `Signer has no certificate registered at provider. Status returned by provider: ${signerCertificates.responseData.detail.status}.`);
    }

    let toleranceTimeUntilExpirationInMiliseconds = 5 * 60 * 1000; // 5 minutes 

    let retrievedSignerCertificates = (signerCertificates.responseData.certificates || []).filter((signerCertificate) => {
      return !signerCertificate.is_revoked || (signerCertificate.expire_time && (Date.parse(`${signerCertificate.expire_time} GMT-0300`) - toleranceTimeUntilExpirationInMiliseconds) > Date.now() );
    });

    if (!onlyAliases) {
      return retrievedSignerCertificates;
    } else {
      return retrievedSignerCertificates.map((crt) => {
        return {
          "alias": crt.alias,
          "provider": "SOLUTI",
          "environment": environmentRouteLabel
        };
      });
    }
  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedSignerCertificatesDiscovery", "Failed to discovery signer's certificates at provider.", e);
  }
};

const signerEnvironmentRouteDiscovery = (environmentRouteLabel, signerIdentity) => {
  return new Promise(async (resolve, reject) => {
    try {
      let providerRouteBaseUri = getProviderEnvironmentAPIRoute(environmentRouteLabel);
      let providerEndpoint = "/oauth/user-discovery";
      
      let serviceAuthParameters = await ssmParameterStoreHelper.getParameters([`serviceSolutiClientId-${environmentRouteLabel}`, `serviceSolutiClientSecret-${environmentRouteLabel}`], true, true);
      
      let requestParams = {
        "baseURL": providerRouteBaseUri,
        "url": providerEndpoint,
        "data": {
          "client_id": serviceAuthParameters[`serviceSolutiClientId-${environmentRouteLabel}`],
          "client_secret": serviceAuthParameters[`serviceSolutiClientSecret-${environmentRouteLabel}`],
          "user_cpf_cnp": "CPF",
          "val_cpf_cnpj": signerIdentity
        },
        "headers": {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        "responseType": "json",
        "timeout": 16000
      };

      let signerRouteDiscoveryResponse = await httpClientHelper.post(requestParams);

      if (signerRouteDiscoveryResponse.responseStatus !== 200) {
        throw errorHandlerHelper.error(500, "RequestError", `Unable to verify signer's existence at provider's environment: [${environmentRouteLabel}]. Provider returned with status code ${signerRouteDiscoveryResponse.responseStatus} and body details: ${JSON.stringify(signerRouteDiscoveryResponse.responseData || {})}.`);
      }

      if (!signerRouteDiscoveryResponse.responseData || !signerRouteDiscoveryResponse.responseData.status) {
        throw errorHandlerHelper.error(500, "InvalidResponseError", `Provider has responded with an unexpected body: ${JSON.stringify(signerRouteDiscoveryResponse.responseData || {})}.`);
      }

      return resolve(signerRouteDiscoveryResponse.responseData);

    } catch (e) {
      let signerRouteDiscoveryError = errorHandlerHelper.error(500, "SignerEnvironmentRouteDiscoveryError", `An error has occurred while trying to discovery signer at provider's route: [${environmentRouteLabel}].`, e);
      return reject(signerRouteDiscoveryError);
    }
  });
};

const authenticateService = async (environmentRouteLabel, byPassCache = false) => {
  try {
    let serviceAuthToken = null;
    let keyOfTokenInCache = `serviceAuthToken_SOLUTI_${environmentRouteLabel}`; 

    try {
      if (!byPassCache) {
        serviceAuthToken = await cacheTableHelper.get(keyOfTokenInCache);
      }
    } catch (e) {
      console.warn(`Unable to retrieve service authorization token ${keyOfTokenInCache} from cache table. Not so critical. Proceeding anyway.`, e, e.stack);
    }
    
    const providerEndpoint = "/oauth/client_token";
    const tokenExpirationTimeOffMiliseconds = 2 * 60 * 1000; // 2 minutes before expiring
    const authTokenLifetimeSeconds = 8 * 60 * 60; // 8 hours at least
    const now = new Date();

    let mustUpdateTokenInCache = false;

    if (!serviceAuthToken || (now.getTime() > (serviceAuthToken.expiresAt - tokenExpirationTimeOffMiliseconds))) {
      mustUpdateTokenInCache = true;

      let serviceAuthParameters = await ssmParameterStoreHelper.getParameters([`serviceSolutiClientId-${environmentRouteLabel}`, `serviceSolutiClientSecret-${environmentRouteLabel}`], true, true);

      let requestParams = {
        "baseURL": getProviderEnvironmentAPIRoute(environmentRouteLabel),
        "url": providerEndpoint,
        "data": {
          "client_id": serviceAuthParameters[`serviceSolutiClientId-${environmentRouteLabel}`],
          "client_secret": serviceAuthParameters[`serviceSolutiClientSecret-${environmentRouteLabel}`],
          "grant_type": "client_credentials",
          "lifetime": authTokenLifetimeSeconds
        },
        "headers": {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        "responseType": "json"
      };

      let serviceAuthResponse = await httpClientHelper.post(requestParams);

      if (serviceAuthResponse.responseStatus === 200) {
        let expiresInSeconds = parseInt(((serviceAuthResponse.responseData.expires_in) ? serviceAuthResponse.responseData.expires_in : 0));
        //expiresInSeconds = expiresInSeconds > authTokenLifetimeSeconds ? authTokenLifetimeSeconds : expiresInSeconds;
        serviceAuthToken = {
          "accessToken": serviceAuthResponse.responseData.access_token,
          "tokenType": serviceAuthResponse.responseData.token_type,
          "issuedAt": now.getTime(),
          "expiresAt": now.getTime() + (expiresInSeconds * 1000),
          "expiresInSeconds": expiresInSeconds,
          "environment": environmentRouteLabel
        };
      } else {
        if (serviceAuthResponse.responseData && serviceAuthResponse.responseData.detail && serviceAuthResponse.responseData.detail.status === "INVALID_PARAM") {
          throw errorHandlerHelper.error(401, "UnauthorizedError", "Invalid credentials sent to authenticate service at provider.");
        } else {
          throw errorHandlerHelper.error(500, "RequestError", `Unable to authenticate service at provider. Request returned with status code ${serviceAuthResponse.responseStatus} and body details ${JSON.stringify(serviceAuthResponse.responseData || {})}.`);
        }
      }

      try {
        if (mustUpdateTokenInCache) {
          await cacheTableHelper.set(keyOfTokenInCache, serviceAuthToken); 
        }
      } catch (e) {
        console.warn(`Unable to persist service authorization token ${keyOfTokenInCache} into cache table. Not so critical. Proceeding anyway.`, e, e.stack);
      }
    }

    return serviceAuthToken.accessToken;

  } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "FailedServiceAuthentication", "Failed to authenticate service at provider.", e);
  }
};

const getProviderEnvironmentAPIRoute = (environmentRouteLabel) => {
  try {
    
    let enabledEnvironmentRouteLabels = getEnabledProviderEnvironmentRouteLabels();

    if (!environmentRouteLabel || enabledEnvironmentRouteLabels.indexOf(environmentRouteLabel) == -1) {
      throw errorHandlerHelper.error(400, "InvalidProviderRouteLabel", `The route label informed [${environmentRouteLabel}] for provider route is invalid.`);
    }

    let routeKey = 'CA_PRV_SOLUTI_BASE_PUBLIC_API_' + environmentRouteLabel + '_URL';

    if (process.env[routeKey] === undefined || process.env[routeKey] === null || process.env[routeKey] === "") {
      throw errorHandlerHelper.error(404, "NotFoundProviderAPIRoute", `No API route was found in enviroment variables for key [${routeKey}].`);
    }

    return process.env[routeKey];

  } catch (e) {
    throw errorHandlerHelper.error(500, "FailedProviderAPIRouteRetrieval", `Something went wrong while determining the provider's API route to which send requests.`, e);
  }
};

const getEnabledProviderEnvironmentRouteLabels = () => {
  try {
    const enabledEnvironmentRouteLabels = globals.specs.enabledProvidersEnvironments && globals.specs.enabledProvidersEnvironments["SOLUTI"];

    if (enabledEnvironmentRouteLabels === undefined) {
      throw errorHandlerHelper.error(500, "MissingProviderEnvironmentRouteConfiguration", "No enabled environment has been found on configuration file for provider SOLUTI.");
    }

    if (!Array.isArray(enabledEnvironmentRouteLabels)) {
      throw errorHandlerHelper.error(400, "InvalidProviderEnvironmentRouteConfiguration", "Invalid configuration of enabled environment route for provider SOLUTI.");
    }

    if (enabledEnvironmentRouteLabels.length == 0) {
      throw errorHandlerHelper.error(403, "NoProviderEnvironmentRouteEnabled", "Provider SOLUTI has no environemnt enabled yet.");
    }

    return enabledEnvironmentRouteLabels;
  } catch (e) {
    throw errorHandlerHelper.error(500, "GetEnabledProviderEnvironmentRouteLabelFailed", "Failed to retrieve enabled environment route labels for provider SOLUTI.", e);
  }
};
