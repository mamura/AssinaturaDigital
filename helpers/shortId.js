"use strict";

const globals = require("../config/globals");
const errorHandlerHelper = require("./errorHandler");
const shortIdLib = require("shortid");

shortIdLib.characters(globals.specs.shortIdAlphabet);

module.exports.generateShortId = () => {
    try {
        let shortId = shortIdLib.generate();
        let timestampBase64 = Buffer.from(Date.now().toString()).toString('base64');
        let shortIdLength = shortId.length;
        let diff = 9 - shortIdLength;

        if (diff > 0) {
            shortId += timestampBase64.slice(-9-diff, -2);
        } else if (diff < 0) {
            shortId += timestampBase64.slice(-9, -2+diff)
        } else {
            shortId += timestampBase64.slice(-9,-2) 
        }

        return shortId.slice(0, 9) + "." + shortId.slice(9);
    } catch (e) {
        throw errorHandlerHelper.error(500, "ShortIdGenerationError", "Failed to generate short id for signature request.", e); 
    }
};