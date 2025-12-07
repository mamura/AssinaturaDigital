"use strict";

const errorHandlerHelper = require("../helpers/errorHandler");

module.exports.loadProvider = (provider) => {
  try {
    if (!provider) {
        throw errorHandlerHelper.error(500, "InvalidProviderName", "No provider name has been informed to load corresponding provider library!");
    }  
    return require(`./${provider.toLowerCase()}`); 
  } catch (e) {
    throw errorHandlerHelper.error(500, "FailedProviderLoading", `Failed to load ${provider} provider library`, e);
  }
};