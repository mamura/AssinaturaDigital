"use strict";

const axios = require("axios");
const http = require("http");
const https = require("https");
const axiosRetry = require("axios-retry");
const errorHandlerHelper = require("./errorHandler");
const requesterClientHelper = require("./requesterClient");

const DEFAULT_REQUEST_RETRIES = 3;
const RETRYABLE_HTTP_METHODS = ['get', 'head', 'options', 'put', 'delete'];

module.exports.get = async (config, callingDomainSpecs) => {
    let result = await request({"method": "get", ...(config || {})}, callingDomainSpecs);
    return result;
};

module.exports.post = async (config, callingDomainSpecs) => {
    let result = await request({"method": "post", ...(config || {})}, callingDomainSpecs);
    return result;
};

module.exports.put = async (config, callingDomainSpecs) => {
    let result = await request({"method": "put", ...(config || {})}, callingDomainSpecs);
    return result;
};

module.exports.delete = async (config, callingDomainSpecs) => {
    let result = await request({"method": "delete", ...(config || {})}, callingDomainSpecs);
    return result;
};

const request = async (config, callingDomainSpecs) => {
    let responseData = null;
    let responseStatus = null;
    let responseStatusText = null;
    let responseHeaders = null;

    if (!config.url) {
        throw errorHandlerHelper.error(500, "MissingURL", "No URL has been informed to request.");
    }

    try {
        const requestConfig = {
            "url": config.url,
            "method": config.method || "get",
            "headers": config.headers || {},
            "params": config.params || null,
            "data": config.data || null,
            "timeout": config.timeout || 15000,
            "withCredentials": config.withCredentials || false,
            "auth": config.auth || null,
            "responseType": config.responseType || "json",
            "responseEncoding": config.responseEncoding || "utf8", 
            "maxContentLength": config.maxContentLength || 5000000,
            "validateStatus": function (status) {
              return status >= 200 && status < 300;
            },
            "maxRedirects": 5, // default
            "httpAgent": new http.Agent({ "keepAlive": true }),
            "httpsAgent": new https.Agent({ "keepAlive": true }),
        };

        if (callingDomainSpecs && callingDomainSpecs.auth && callingDomainSpecs.auth.enabled === true) {
            let authParams = await requesterClientHelper.getClientDomainAuthParameters(callingDomainSpecs);
            
            if (!authParams) {
              throw errorHandlerHelper.error(409, "EmptyAuthParams", "Auth params returned is empty. Unable to proceed.");
            }
      
            switch (callingDomainSpecs.auth.type) {
              case "basicAuth":
                requestConfig.auth = authParams;
                break;
              case "apiKey":
                requestConfig.headers = {
                  ...(requestConfig.headers),
                  ...authParams
                }
                break;
              default:
                throw errorHandlerHelper.error(500, "UnknownAuthType", `Domain authentication type ${callingDomainSpecs.auth.type} is unknowun.`);
            }
        }

        let response = await getHttpClientInstance(config.baseURL).request(requestConfig); 

        responseStatus = response.status;
        responseStatusText = response.statusText;
        responseData = response.data,
        responseHeaders = response.headers;
    } catch (e) {
        if (e.response) { // The request was made and the server responded with a status code that falls out of the range of 2xx
            responseStatus = e.response.status;
            responseStatusText = e.response.statusText;
            responseData = e.response.data;
            responseHeaders = e.response.headers;
        } else if (e.request) { // The request was made but no response was received
            throw errorHandlerHelper.error(504, "GatewayTimeout", "No response was received.", e);
        } else {  // Something happened in setting up the request that triggered an Error
            throw errorHandlerHelper.error(500, "RequestError", "Something went wrong while setting up request.", e);
        }
    }

    return {
        responseStatus,
        responseStatusText,
        responseHeaders,
        responseData 
    };
};

const getHttpClientInstance = (baseURL) => {
    let axiosClient = (baseURL) ? axios.create({"baseURL": baseURL}) : axios.create();
    axiosRetry(axiosClient, {
        "retries": DEFAULT_REQUEST_RETRIES,
        "retryDelay": (retryCount) => {
            return retryCount * 1000;
        },
        "retryCondition": (err) => {
            console.warn(`Request tentative${(err.config && err.config.url) ? ` "${(typeof err.config.method === "string") ? `${err.config.method.toUpperCase()} ` : ""}${err.config.url}` : ''}" failed${(err.response) ? ` with status code ${err.response.status} - ${err.response.statusText} and body: ${(err.response.data && typeof err.response.data === "string") ? err.response.data : JSON.stringify(err.response.data)}` : ""}.`);
            console.error(err);
            if (!err.config) {
                // Cannot determine if the request can be retried
                return false;
            }

            return (
                err &&
                err.code !== 'ECONNABORTED' && // Prevents retrying timed out requests
                (!err.response || (err.response && (err.response.status >= 500 && err.response.status <= 599))) // Retries if it is a network error or a 5xx error
                && RETRYABLE_HTTP_METHODS.indexOf(err.config.method) !== -1
            );
        }
    });
    return axiosClient;
};
