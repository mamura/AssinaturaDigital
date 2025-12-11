"use strict";

const errorHandlerHelper = require("./errorHandler");

const AWS = require("aws-sdk");
AWS.config.update({region: process.env.CLOUD_REGION});
const ssm = new AWS.SSM({"apiVersion": "2014-11-06"});

let memCachedParams = {};

module.exports.getParameter = async (paramName, withDecryption, useCache = true) => {
    try {
        let stagedParamName = `${process.env.STAGE || "dev"}-${paramName}`
        let paramValue = null;

        if (useCache && memCachedParams[stagedParamName] !== undefined) {
            paramValue = memCachedParams[stagedParamName];
        } else {
            let params = {
                "Name": stagedParamName,
                "WithDecryption": withDecryption || false
            };
            paramValue = await ssm.getParameter(params).promise();
            memCachedParams[paramValue.Parameter.Name] = paramValue.Parameter.Value;
        }
        return paramValue.Parameter.Value;
    } catch (e) {
        if (e.code === "ParameterNotFound") {
            throw errorHandlerHelper.error(500, "ParameterNotFound", `Parameter ${paramName} was not found in store.`, e);
        }
        throw errorHandlerHelper.error(500, "FailedParameterRetrieval", "Failed to retrieve parameter from store.", e);
    }
};

module.exports.getParameters = async (paramsName, withDecryption, useCache = true) => {
    try {
        let paramsValueToReturn = {};

        let stagedParamsName = [];

        paramsName.filter((paramName) => {
            let stagedParamName =  `${process.env.STAGE || "dev"}-${paramName}`;
            
            if (useCache && memCachedParams[stagedParamName] !== undefined) {
                paramsValueToReturn[paramName] = memCachedParams[stagedParamName];
                return false;
            }
        
            stagedParamsName.push(stagedParamName);
            return true;
        });

        if (stagedParamsName.length > 0) {
            let params = {
                "Names": stagedParamsName,
                "WithDecryption": withDecryption || false
            };
    
            let paramValues = await ssm.getParameters(params).promise();
    
            paramValues.InvalidParameters.forEach(invalidParameter => {
                paramsValueToReturn[invalidParameter.split("-").slice(1).join("-")] = null;
            });
    
            paramValues.Parameters.forEach(parameter => {
                memCachedParams[parameter.Name] = parameter.Value;
                paramsValueToReturn[parameter.Name.split("-").slice(1).join("-")] = parameter.Value;
            });
        }

        return paramsValueToReturn;
    } catch (e) {
        throw errorHandlerHelper.error(500, "FailedParameterRetrieval", "Failed to retrieve parameter from store.", e);
    }
};