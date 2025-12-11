"use strict";

const url  = require("url");
const globals = require("../config/globals");
const apiGatewayHelper = require("./apiGateway");
const errorHandlerHelper = require("./errorHandler");
const ssmParameterStoreHelper = require("./ssmParameterStore");

let auths = {};
let clientNames = {};

module.exports.checkRequesterCallbackUrlByApiKey = async (apiKeyId, requesterCallbackUrl) => {
    try {
        let clientName = await getClientName(apiKeyId);
        return module.exports.checkRequesterCallbackUrlByClientName(clientName, requesterCallbackUrl);
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode, "RequesterCallbackCheckByApiKeyError", "Failed to check validity of requerster's callback URL by API Key ID.", e);
    }
};

module.exports.checkRequesterCallbackUrlByClientName = (clientName, requesterCallbackUrl) => {
   try {
    let requesterCallbackDomainSpec =  getRequesterCallbackSpecs(clientName, requesterCallbackUrl);

    if (!requesterCallbackDomainSpec) {
        throw errorHandlerHelper.error(400, "InvalidRequesterCallbackUrl", `Callback URL ${requesterCallbackUrl} is invalid.`);
    }
    return requesterCallbackDomainSpec;
   } catch (e) {
    throw errorHandlerHelper.error(e.statusCode, "RequesterCallbackCheckByClientNameError", "Failed to check validity of requerster's callback URL by client name.", e);
   }
};

module.exports.retrieveRequesterCallbackAuthParameters = async (apiKeyId, requesterCallbackUrl) => {
    try {
        let requesterCallbackDomainSpec = await module.exports.checkRequesterCallbackUrlByApiKey(apiKeyId, requesterCallbackUrl); 
        let authParameters = await module.exports.getClientDomainAuthParameters(requesterCallbackDomainSpec);
        return authParameters;
    } catch (e) {
        throw errorHandlerHelper.error(500, "RequesterCallbackAuthParamsRetrievalError", "An error has ocurred while retrieving requerter's callback authentication parameters.", e);
    }
};

module.exports.getClientDomainAuthParameters = async (domainSpecs) => {
    try {
        if (!domainSpecs) {
            throw errorHandlerHelper.error(400, "MissingParametersError", "Domain specs were not informet to retrieve authentication parameters."); 
        }

        let authParameters = null;

        if (domainSpecs.auth.enabled === true) {
            authParameters = auths[domainSpecs.domain];

            if (!authParameters) {
                let retrievedFromSsmStore = await ssmParameterStoreHelper.getParameter(`${domainSpecs.auth.type}-${domainSpecs.domain}`, true);
                switch (domainSpecs.auth.type) {
                    case "basicAuth":
                        let authParamsBasicParts = retrievedFromSsmStore.split(":");
                        if (!Array.isArray(authParamsBasicParts) || authParamsBasicParts.length !== 2) {
                            throw errorHandlerHelper.error(500, "MisconfigClientAuthDomain", "There is a misconfiguration on client's domain auth parameters.");
                        }
                        authParameters = {
                            "username": authParamsBasicParts[0],
                            "password": authParamsBasicParts[1]
                        };
                        break;
                    case "apiKey":
                        let authParametersApiKeyParts = retrievedFromSsmStore.split(":");
                        if (!Array.isArray(authParametersApiKeyParts) || authParametersApiKeyParts.length !== 2) {
                            throw errorHandlerHelper.error(500, "MisconfigClientAuthDomain", "There is a misconfiguration on client's domain auth parameters.");
                        }
                        authParameters = {};
                        authParameters[authParametersApiKeyParts[0]] = authParametersApiKeyParts[1];
                        break;
                    default:
                        authParameters = null;
                }
            }
        }

        if (authParameters && !auths[domainSpecs.domain]) {
            auths[domainSpecs.domain] = authParameters;
        }

        return authParameters;
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetDomainAuthParametersError", "An error has ocurred while retrieving authentication parameters for the especified domain.", e);
    }
}

const getRequesterCallbackSpecs = (clientName, requesterCallbackUrl) => {
    try {
        if (!Array.isArray(globals.specs.enabledCallbackDomains)) {
            throw errorHandlerHelper.error(500, "RequesterCallbackMisconfigError", "There is an error in configuration for requester callback specs."); 
        }

        let requesterCallbackSpecs = globals.specs.enabledCallbackDomains.find((enabledCallback) => {
            return enabledCallback.client === clientName;
        });
    
        if (!requesterCallbackSpecs) {
            return null;
        }
    
        let foundRequesterCallbackDomainSpec = null;
    
        let requesterCallbackUrlParts = url.parse(requesterCallbackUrl);
            
        for (let i = 0, totI = requesterCallbackSpecs.domains.length; i < totI && !foundRequesterCallbackDomainSpec; i++) {
            if (requesterCallbackSpecs.domains[i].domain === requesterCallbackUrlParts.hostname) {
                foundRequesterCallbackDomainSpec = requesterCallbackSpecs.domains[i];
            }
        }
    
        return foundRequesterCallbackDomainSpec;
    } catch (e) {
        throw errorHandlerHelper.error(500, "LoadRequesterCallbackSepcsError", "An error has ocurred while loading requerster callback specs.", e); 
    }
};

const getClientName = async (apiKeyId) => {
    let clientName = clientNames[apiKeyId];

    if (!clientName) {
        clientName = await apiGatewayHelper.getClientName(apiKeyId);
        clientNames[apiKeyId] = clientName;
    }

    return clientName;
};

