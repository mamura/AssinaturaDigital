"use strict";

const errorHandlerHelper = require("./errorHandler");
const {gzip, ungzip} = require("node-gzip");

const availableFormats = [
    "gzip"
];

module.exports.compress = async (uncompressedData, format) => {
    try {
        format = format || "gzip";
        let compressedData = null;

        if (availableFormats.indexOf(format) < 0) {
            throw errorHandlerHelper.error(400, "UnsuportedCompressionFormat", "The format requested to compress data is not supported.");
        }
    
        switch (format) {
            case "gzip":
            default:
                compressedData = await gzip(uncompressedData);
        }

        return {
            format, 
            compressedData
        };
    } catch (e) {
        throw errorHandlerHelper.error(500, "DataCompressionError", "Unexpected error while compressing data.", e);
    }
};

module.exports.uncompress = async (compressedData, format) => {
    try {
        format = format || "gzip";
        let uncompressedData = null;

        if (availableFormats.indexOf(format) < 0) {
            throw errorHandlerHelper.error(400, "UnsuportedCompressionFormat", "The format requested to uncompress data is not supported.");
        }
    
        switch (format) {
            case "gzip":
            default:
                uncompressedData = await ungzip(compressedData);
        }

        return uncompressedData;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DataUncompressionError", "Unexpected error while uncompressing data.", e);
    }
};