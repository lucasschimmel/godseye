import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import actionSchema from "../../../docs/contracts/action.schema.json" with { type: "json" };
import operationSchema from "../../../docs/contracts/operation.schema.json" with { type: "json" };
import manifestSchema from "../../../docs/contracts/project.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
export const validateManifest = ajv.compile(manifestSchema);
export const validateAction = ajv.compile(actionSchema);
export const validateOperation = ajv.compile(operationSchema);
