"use strict";

const errorHandlerHelper = require("./errorHandler");
const serviceCacheTable = require("../resources/tables/serviceCache");

module.exports.get = async (entryKey) => {
    if (!entryKey) {
        throw errorHandlerHelper.error(500, "MissingParameterError", "No key has been informed to retrieve entry from cache.");
    }
    
    let entryInCache = null;

    try {
        entryInCache = await serviceCacheTable.get(entryKey);

        if (!entryInCache || !entryInCache.entryValue) {
            throw errorHandlerHelper.error(404, "CacheEntryFault", `The entry ${entryKey} was not found in cache!`);
        }

        let resultToReturn = {
            ...(entryInCache.entryValue),
            '_createdAt': entryInCache.createdAt,
            '_updatedAt': entryInCache.updatedAt
        };

        return resultToReturn;
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode, "RetrieveCacheEntryError", "Failed to retrieve entry from cache.", e);
    }
};

module.exports.set = async (entryKey, entryValue) => {
    if (!entryKey) {
        throw errorHandlerHelper.error(500, "MissingParameterError", "No key has been informed to insert entry into cache.");
    }

    if (!entryValue) {
        throw errorHandlerHelper.error(500, "MissingParameterError", "No value has been informed to insert entry into cache.");
    }

    let existingEntry = null;

    try {
        existingEntry = await module.exports.get(entryKey);
    } catch (e) {
        if (e.statusCode === 404) {
            console.warn(`Entry ${entryKey} not found in cache. Inserting it as new entry into cache.`, e);
        } else {
            throw e;
        }
    }

    try {
        const cacheTableOperation = (existingEntry) ? "update" : "put";
        await serviceCacheTable[cacheTableOperation](entryKey, entryValue);
    } catch (e) {
        throw errorHandlerHelper.error(500, "InsertEntryInCacheError", `Failed to insert entry ${entryKey} into cache.`, e);
    }
};