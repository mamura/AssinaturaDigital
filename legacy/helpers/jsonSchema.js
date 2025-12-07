"use strict";

const errorHandlerHelper = require("./errorHandler");
const Ajv = require("ajv");
const ajv = new Ajv({"allErrors": true});
require("ajv-async")(ajv);

let compiledSchemas = [];

module.exports.validate = async (jsonObject, jsonSchema) => {
    if (!jsonObject) {
        throw errorHandlerHelper.error(500, "MissingDataObject", "Invalid data object to be checked.")
    }

    if (!jsonSchema) {
        throw errorHandlerHelper.error(500, "MissingSchema", "Invalid schema definition.")
    }

    let validateSchema = null;

    try {
        validateSchema = compileSchema(jsonSchema);
    } catch (e) {
        throw errorHandlerHelper.error(500, "SchemaCompilationError", "Failed to compile JSON schema.", e);
    }

    try {
        if (jsonSchema.$async) {
            await validateSchema(jsonObject);
        } else {
            if (!validateSchema(jsonObject)) {
                throw new Ajv.ValidationError(validateSchema.errors);
            }
        }
    } catch (e) {
        if (e instanceof Ajv.ValidationError) {
            throw errorHandlerHelper.error(400, "ValidationError", JSON.stringify(e.errors));
        } else {
            throw errorHandlerHelper.error(500, "InternalError", "Unexpected error while validating JSON schema.", e);
        }
    }
};  

const compileSchema = (jsonSchema) => {
    let compiledSchema = compiledSchemas[jsonSchema.$id];

    if (!compiledSchema) {
        compiledSchema = ajv.compile(jsonSchema);
        compiledSchemas[jsonSchema.$id] = compiledSchema;
    }
    
    return compiledSchema;
};