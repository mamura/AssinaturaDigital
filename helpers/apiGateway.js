"use strict";

const errorHandlerHelper = require("./errorHandler");

const AWS = require("aws-sdk");
AWS.config.update({region: process.env.CLOUD_REGION});

const apiGateway = new AWS.APIGateway();

let clientNames = {};

module.exports.getClientName = async (apiKeyId) => {
    try {
        if (!apiKeyId) {
            throw errorHandlerHelper.error(500, "MissingParameter", "No identifier for API Key has been informed.");
        }

        if (clientNames[apiKeyId]) {
            return clientNames[apiKeyId];
        }

        let apiKeyParams = {
            "apiKey": apiKeyId,
            "includeValue": false
        }; 

        let apiKeyInfos = await apiGateway.getApiKey(apiKeyParams).promise();
        let clientName = apiKeyInfos.description;

        if (!clientName) {
            throw errorHandlerHelper.error(500, "MisconfigError", `API Key ${apiKeyId} is misconfigured. Unable to retrieve client app name from its description metadata.`);
        }

        clientNames[apiKeyId] = clientName;

        return clientName;
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetAppNameError", "Failed to retrieve client application name from API Key data.", e);
    }
};