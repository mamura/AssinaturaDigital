"use strict";

const apiGatewayHelper = require("../../helpers/apiGateway");

module.exports.formatRequestIdentityMetadata = async (requestContextIdentity) => {
    let requestContextIdentityMetadata = {};

    if (requestContextIdentity) {
        let clientName = null;

        if (requestContextIdentity.apiKeyId) {
            clientName = await apiGatewayHelper.getClientName(requestContextIdentity.apiKeyId);
        }

        requestContextIdentityMetadata.requestOrigin = {
            "client": clientName || "ANONYMOUS",
            "apiKey": requestContextIdentity.apiKey, 
            "apiKeyId": requestContextIdentity.apiKeyId, 
            "sourceIp": requestContextIdentity.sourceIp, 
            "userAgent": requestContextIdentity.userAgent
        };
    }

    return requestContextIdentityMetadata;
};