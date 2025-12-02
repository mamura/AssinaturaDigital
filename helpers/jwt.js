"use strict";

const globals = require("../config/globals");
const jwt = require("jwt-simple");
const errorHandlerHelper = require("./errorHandler");
const ssmParameterStoreHelper = require("./ssmParameterStore");

let jwtSecret = null;

module.exports.encode = async (jwtPayload) => {
    try {
        if (!jwtPayload) {
            throw errorHandlerHelper.error(500, "MissingParameterError", "Empty payload sent do encode JWT token."); 
        }

        jwtPayload.aud = `${process.env.STAGE}.${globals.specs.jwt.aud}`;
        delete jwtPayload.audience; // for precaution, deleting any possible dirty audience

        if (!jwtPayload.iat || typeof jwtPayload.iat !== "number") {
            jwtPayload.iat = Date.now();
        }

        if (!jwtPayload.exp) {
            jwtPayload.exp = jwtPayload.iat + (globals.specs.jwt.defaultExpirationMinutes * 60 * 1000);
        }

        let secret = await getJwtSecret();
          
        let jwtTokenEncoded = jwt.encode(jwtPayload, secret, globals.specs.jwt.algorithm);
    
        return jwtTokenEncoded;
    } catch (e) {
        throw errorHandlerHelper.error(500, "JWTEncodingError", "Something went wrong while encoding JWT token.", e); 
    }
};

module.exports.decode = async (jwtEncoded) => {
    try {
        if (!jwtEncoded) {
            throw errorHandlerHelper.error(500, "MissingParameterError", "Empty jwt sent do be decoded."); 
        }

        let secret = null;
        
        if (process.env.JWT_VERIFY_SIGNATURE) {
            secret = await getJwtSecret();
        }
        
        let jwtTokenDecoded = jwt.decode(jwtEncoded, secret, !process.env.JWT_VERIFY_SIGNATURE);

        if (jwtTokenDecoded.aud !== `${process.env.STAGE.toLowerCase()}.${globals.specs.jwt.aud}`) {
            throw errorHandlerHelper.error(403, "ForbiddenJWTAudience", "Target audience in JWT token is not a valid audience for this environment."); 
        }
    
        return jwtTokenDecoded;
    } catch (e) {
        throw errorHandlerHelper.error(500, "JWTDecodingError", "Something went wrong while decoding JWT token.", e); 
    }
};

const getJwtSecret = async () => {
    if (!jwtSecret) {
        jwtSecret =  await ssmParameterStoreHelper.getParameter("jwtIssueSecret", true);
        jwtSecret = Buffer.from(jwtSecret, "hex");
    }
    return jwtSecret;
};