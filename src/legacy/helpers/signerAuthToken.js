"use strict";

const globals = require("../config/globals");
const errorHandlerHelper = require("./errorHandler");
const jwtHelper = require("./jwt");
const jsonSchemaHelper = require("./jsonSchema");

module.exports.validateSignerAuthToken = async (signerAuthToken) => {
    try {
        const signerAuthTokenPayloadSchema = {
            "$id": "signerAuthToken-payload",
            "$async": true,
            "type": "object",
            "properties": {
              "jti": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
              },
              "sub": { 
                "type": "string",
                "oneOf": globals.specs.allowedIdentityPatterns.map((signerIdentityPattern) => {
                    return {
                      "pattern": signerIdentityPattern
                    }
                  })
              },
              "iat": {
                "type": "integer",
                "minimum": 1
              },
              "exp": {
                "type": "number",
                "minimum": 1
              },
              "accessToken": {
                "type": "string",
                "pattern": "[0-9a-fA-F]+"
              },
              "tokenType": {
                "type": "string",
                "enum": ["bearer", "Bearer"]
              },
              "provider": {
                "type": "string",
                "enum": globals.specs.enabledProviders
              },
              "aud": {
                "type": "string",
                "minLength": 1
              },
              "environment": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
               
              }
            },
            "additionalProperties": false,
            "required": [
              "jti",
              "sub",
              "iat",
              "exp",
              "accessToken",
              "tokenType",
              "provider"
            ]
        };

        let signerAuthTokenDecoded = await jwtHelper.decode(signerAuthToken);

        await jsonSchemaHelper.validate(signerAuthTokenDecoded, signerAuthTokenPayloadSchema);

        return signerAuthTokenDecoded;
    } catch (e) {
        throw errorHandlerHelper.error(401, "InvalidSignerAuthToken", "It was not possible to validate signer's authorization token.", e);
    }
};