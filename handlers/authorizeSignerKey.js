"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const jwtHelper = require("../helpers/jwt");
const cacheTableHelper = require("../helpers/cacheTable");
const apiGatewayHelper = require("../helpers/apiGateway");
const providers = require("../providers");
const signersAuthorizationTable = require("../resources/tables/signersAuthorization");
const uuid = require("uuid");

let lambdaInstanceId = null;

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

    const inputBodySchema = {
      "$id": "signer-authorizeKey",
      "$async": true,
      "type": "object",
      "properties": {
        "provider": {
          "type": "string",
          "enum": globals.specs.enabledProviders
        },
        "signerIdentity": { 
          "type": "string",
          "oneOf": globals.specs.allowedIdentityPatterns.map((signerIdentityPattern) => {
              return {
                "pattern": signerIdentityPattern
              }
            })
        },
        "otp": {
          "type": "string",
          "minLength": 6
        },
        "useCache": {
          "type": "boolean"
        }
      },
      "additionalProperties": false,
      "required": [
        "provider",
        "signerIdentity",
        "otp"
      ]
    };

    let requestBody = await requestHelper.parseBody(lambdaEvent.body, inputBodySchema);

    requestBody.signerIdentity = requestBody.signerIdentity.replace(/(\.|\-)/g, "");

    let dataToPersist = {
      "provider": requestBody.provider, 
      "sts": "PENDING",
      "useCache": requestBody.useCache || false
    };

    const tableKey = {
      "requestId": lambdaContext.awsRequestId,
      "signerIdentity": requestBody.signerIdentity
    };

    await signersAuthorizationTable.put(tableKey, dataToPersist, lambdaEvent.requestContext.identity);

    const now = new Date();

    let signerKeyAuthorization = null;

    const clientName = await apiGatewayHelper.getClientName(lambdaEvent.requestContext.identity.apiKeyId);
    const provider = await providers.loadProvider(requestBody.provider);

    try {
      if (requestBody.useCache === true) {
        signerKeyAuthorization = await provider.getCachedSignerKeyAuthorization(null, requestBody.signerIdentity, clientName);
      }
    } catch (e) {
      console.warn("Unable to retrieve signer's authorization token from cache table. Not so critical. Proceeding anyway.", e);
    }

    if (requestBody.useCache && signerKeyAuthorization && signerKeyAuthorization.jwtTokenPayload && signerKeyAuthorization.jwtTokenPayload.sub != requestBody.signerIdentity) {
      throw errorHandlerHelper.error(409, "CachedAuthorizationTokenInconsistency", "The cached key authorization token does not pertain to the signer."); 
    }

    let mustUpdateTokenInCache = false;
    let authCallError = null;
    let jwtTokenPayload = null;

    const toleranceCacheMilisseconds = 5 * 60 * 1000; // 5 minutes

    if (!requestBody.useCache
        || !signerKeyAuthorization 
        || !signerKeyAuthorization.jwtTokenPayload
        || (((signerKeyAuthorization.jwtTokenPayload.exp * 1000) - now.getTime()) < toleranceCacheMilisseconds) 
        || requestBody.provider !== signerKeyAuthorization.jwtTokenPayload.provider
    ) {
      mustUpdateTokenInCache = true;
      
      try {
        signerKeyAuthorization = await provider.authorizeSignerKey(requestBody);

        let sts = ((signerKeyAuthorization.accessToken) ? "AUTHORIZED" : "ERROR");

        dataToPersist = {
          sts
        };

        if (sts === "AUTHORIZED") {
          jwtTokenPayload = {
            "jti": uuid.v4(),
            "sub": signerKeyAuthorization.signerIdentity,
            "iat": signerKeyAuthorization.issuedAt,
            "exp": signerKeyAuthorization.expiresAt,
            "accessToken": signerKeyAuthorization.accessToken,
            "tokenType": signerKeyAuthorization.tokenType,
            "provider": requestBody.provider,
            "environment": signerKeyAuthorization.environment || null
          };
          
          let jwtAccessToken = await jwtHelper.encode(jwtTokenPayload);

          signerKeyAuthorization = {
            "signerCertificates": signerKeyAuthorization.certificates,
            "signerAuthToken": jwtAccessToken,
            "expiresInSeconds": signerKeyAuthorization.expiresInSeconds,
            "cached": false
          };

          dataToPersist.jti = jwtTokenPayload.jti;
          dataToPersist.expiresInSeconds = signerKeyAuthorization.expiresInSeconds;
          dataToPersist.signerCertificates = signerKeyAuthorization.signerCertificates;
          dataToPersist.stampExpiration = jwtTokenPayload.exp * 1000;
          dataToPersist.cached = false;
          dataToPersist.environment = jwtTokenPayload.environment || null;
          
        } else {
          authCallError = errorHandlerHelper.error(500, "SignerKeyAuthorizationError", "Something went wrong while authorizing signer's key."); 
        }
      } catch (e) {
        authCallError = e;

        dataToPersist = {
          "sts": (e.statusCode === 401) ? "UNAUTHORIZED" : "ERROR", 
          "err": e
        };
      }
    } else if (requestBody.useCache === true && signerKeyAuthorization) {
      console.info(`Signer ${requestBody.signerIdentity} has already a valid authorization token stored into cache that has been requested by client ${clientName} previously. Ignoring OTP sent and using the existing token instead.`);
      
      mustUpdateTokenInCache = false;

      jwtTokenPayload = {
        "jti": signerKeyAuthorization.jwtTokenPayload.jti,
        "sub": signerKeyAuthorization.jwtTokenPayload.sub,
        "iat": signerKeyAuthorization.jwtTokenPayload.iat,
        "exp": signerKeyAuthorization.jwtTokenPayload.exp,
        "accessToken": signerKeyAuthorization.jwtTokenPayload.accessToken,
        "tokenType": signerKeyAuthorization.jwtTokenPayload.tokenType,
        "provider": signerKeyAuthorization.jwtTokenPayload.provider,
        "environment": signerKeyAuthorization.jwtTokenPayload.environment || null
      };

      dataToPersist = {
        "sts": "AUTHORIZED",
        "jti": signerKeyAuthorization.jwtTokenPayload.jti,
        "expiresInSeconds": Math.floor(signerKeyAuthorization.jwtTokenPayload.exp - (Date.now() / 1000)),
        "signerCertificates": signerKeyAuthorization.signerCertificates,
        "stampExpiration": signerKeyAuthorization.stampExpiration,
        "cached": true,
        "environment": signerKeyAuthorization.jwtTokenPayload.environment || null
      }

      signerKeyAuthorization.signerAuthToken = await jwtHelper.encode(jwtTokenPayload);
      signerKeyAuthorization.expiresInSeconds = dataToPersist.expiresInSeconds;
      signerKeyAuthorization.cached = dataToPersist.cached;
      delete signerKeyAuthorization.jwtTokenPayload;
      delete signerKeyAuthorization.stampExpiration;
    } else {
      dataToPersist = {
        "sts": "UNAUTHORIZED", 
        "err": errorHandlerHelper.error(401, "AuthorizationFailed", "Unable to get singer's key authorization.")
      };
    }

    await signersAuthorizationTable.update(tableKey, dataToPersist);

    if (authCallError) {
      throw authCallError;
    }

    try {
      if (mustUpdateTokenInCache && dataToPersist.sts === "AUTHORIZED") {
        let dataToCache = {
          "jwtTokenPayload": jwtTokenPayload,
          "signerCertificates": signerKeyAuthorization.signerCertificates,
          "stampExpiration": jwtTokenPayload.exp * 1000 //Milliseconds
        };
        await provider.storeSignerKeyAuthorizationInCache(jwtTokenPayload.environment, requestBody.signerIdentity, clientName, dataToCache);
      }
    } catch (e) {
      console.warn("Unable to persist signer's authorization token into cache table. Not so critical. Proceeding anyway.", e);
    }

    const omitFromLog = [
      "signerAuthToken"
    ];

    return responseHelper.success(lambdaContext.awsRequestId, signerKeyAuthorization, null, null, null, omitFromLog);

  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
};