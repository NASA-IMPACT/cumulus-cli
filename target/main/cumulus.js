#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const FS = __importStar(require("fs"));
const cumulusApiClient_js_1 = require("@cumulus/api-client/cumulusApiClient.js");
const Cmd = __importStar(require("cmd-ts"));
const Result = __importStar(require("cmd-ts/dist/cjs/Result"));
const effects_1 = require("cmd-ts/dist/cjs/effects");
const fp = __importStar(require("lodash/fp"));
const unfold_1 = require("./unfold");
const NO_RETRY_STATUS_CODES = [
    200,
    201,
    202,
    204,
    ...Array.from({ length: 100 }, (_, k) => 400 + k), // 400-499
];
const JSONData = {
    description: "Literal JSON value or path to JSON file",
    displayName: "JSON",
    from(dataOrPath) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            // Parse only to validate, returning original string, not parsed value.
            if (Result.isOk(safe(JSON.parse)(dataOrPath))) {
                return dataOrPath;
            }
            // Invalid JSON, so see if it's a file path
            const stats = safe(FS.statSync)(dataOrPath);
            const result = Result.isOk(stats)
                ? ((_a = stats.value) === null || _a === void 0 ? void 0 : _a.isFile())
                    ? safe(() => FS.readFileSync(dataOrPath, "utf8"))()
                    : Result.err(new Error("Value is a directory, not a file"))
                : Result.err(new Error("Value is neither a file, nor a valid JSON literal"));
            return Result.isOk(result) ? result.value : Promise.reject(result.error);
        });
    },
};
const QueryStringParameter = {
    description: "Query string parameter",
    displayName: "NAME=VALUE",
    from(param) {
        return __awaiter(this, void 0, void 0, function* () {
            const [name, value, ...rest] = param.split("=");
            return !(name === null || name === void 0 ? void 0 : name.length) || !(value === null || value === void 0 ? void 0 : value.length) || rest.length
                ? Promise.reject(new Error("Option must be of the form NAME=VALUE"))
                : [name, value];
        });
    },
};
const globalArgs = {
    prefix: Cmd.option({
        type: Cmd.string,
        long: "prefix",
        description: "Cumulus stack prefix",
        env: "CUMULUS_PREFIX",
    }),
};
const listArgs = Object.assign(Object.assign({}, globalArgs), { all: Cmd.flag({
        long: "all",
        description: "List ALL records, regardless of --limit",
    }), limit: Cmd.option({
        type: Cmd.number,
        long: "limit",
        description: "Number of records to return",
        defaultValue: () => 10,
        defaultValueIsSerializable: true,
    }), page: Cmd.option({
        type: Cmd.number,
        long: "page",
        description: "Page number (1-based)",
        defaultValue: () => 1,
        defaultValueIsSerializable: true,
    }), sort_by: Cmd.option({
        type: Cmd.string,
        long: "sort-by",
        description: "Name of field to sort records by",
        defaultValue: () => "timestamp",
        defaultValueIsSerializable: true,
    }), order: Cmd.option({
        type: Cmd.oneOf(["asc", "desc"]),
        long: "order",
        description: "Name of field to sort records by",
        defaultValue: () => "asc",
        defaultValueIsSerializable: true,
    }), params: Cmd.multioption({
        type: Cmd.array(QueryStringParameter),
        long: "param",
        short: "?",
        description: "Query string parameter (may be specified multiple times)",
    }), fields: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "fields",
        description: "comma-separated list of field names to return in each record" +
            " (if not specified, all fields are returned)",
    }) });
function responseErrorMessage(response) {
    const reasons = fp.map(fp.prop("reason"), fp.pathOr([], ["meta", "body", "error", "root_cause"], response));
    return reasons.join(" | ") || JSON.stringify(response);
}
function mkClient(invoke) {
    const mkMethod = (method) => (path) => ({ prefix, params, data }) => request({ prefix, method, path, params, data, invoke });
    return {
        delete: mkMethod("DELETE"),
        get: mkMethod("GET"),
        post: mkMethod("POST"),
        put: mkMethod("PUT"),
    };
}
function mkApp(client) {
    return Cmd.binary(Cmd.subcommands({
        name: "cumulus",
        description: "Cumulus API Command-Line Interface",
        cmds: {
            "async-operations": asyncOperationsCmd(client),
            collections: collectionsCmd(client),
            elasticsearch: elasticsearchCmd(client),
            executions: executionsCmd(client),
            granules: granulesCmd(client),
            providers: providersCmd(client),
            rules: rulesCmd(client),
            stats: statsCmd(client),
            version: Cmd.command({
                name: "version",
                description: "Show the Cumulus API version",
                args: globalArgs,
                handler: client.get(`/version`),
            }),
        },
    }));
}
//------------------------------------------------------------------------------
// COMMAND: async-operations
//------------------------------------------------------------------------------
function asyncOperationsCmd(client) {
    return Cmd.subcommands({
        name: "async-operations",
        description: "Show async operations",
        cmds: {
            get: getAsyncOperationCmd(client),
            list: listAsyncOperationsCmd(client),
        },
    });
}
function getAsyncOperationCmd(client) {
    return Cmd.command({
        name: "get",
        description: "Get information about an async operation",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of an async operation",
            }) }),
        handler: ({ prefix, id }) => client.get(`/asyncOperations/${id}`)({ prefix }),
    });
}
function listAsyncOperationsCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List async operations",
        args: listArgs,
        handler: list("/asyncOperations")(client),
    });
}
//------------------------------------------------------------------------------
// COMMAND: collections
//------------------------------------------------------------------------------
function collectionsCmd(client) {
    return Cmd.subcommands({
        name: "collections",
        description: "Show and manage collections",
        cmds: {
            add: addCollectionCmd(client),
            replace: replaceCollectionCmd(client),
            upsert: upsertCollectionCmd(client),
            delete: deleteCollectionCmd(client),
            list: listCollectionsCmd(client),
        },
    });
}
function addCollectionCmd(client) {
    return Cmd.command({
        name: "add",
        description: "Add a collection",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
            }) }),
        handler: addCollection(client),
    });
}
function addCollection(client) {
    return (params) => client.post("/collections")(params);
}
function deleteCollectionCmd(client) {
    return Cmd.command({
        name: "delete",
        description: "Delete a collection",
        args: Object.assign(Object.assign({}, globalArgs), { name: Cmd.option({
                type: Cmd.string,
                long: "name",
                short: "n",
                description: "Name of the collection to delete",
            }), version: Cmd.option({
                type: Cmd.string,
                long: "version",
                short: "v",
                description: "Version of the collection to delete",
            }) }),
        handler: ({ prefix, name, version }) => client.delete(`/collections/${name}/${version}`)({ prefix }),
    });
}
function replaceCollectionCmd(client) {
    return Cmd.command({
        name: "replace",
        description: "Replace a collection",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "path to JSON file, or JSON string of collection definition",
            }) }),
        handler: replaceCollection(client),
    });
}
function replaceCollection(client) {
    return ({ prefix, data }) => {
        const result = safe(JSON.parse)(data);
        if (Result.isErr(result)) {
            return Promise.reject(result.error);
        }
        const { name, version } = result.value;
        return client.put(`/collections/${name}/${version}`)({ prefix, data });
    };
}
function listCollectionsCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List collections",
        args: listArgs,
        handler: list("/collections")(client),
    });
}
function upsertCollectionCmd(client) {
    return Cmd.command({
        name: "upsert",
        description: "Update (replace) a collection, or insert (add) it, if not found",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "path to JSON file, or JSON string of collection definition",
            }) }),
        handler: upsertCollection(client),
    });
}
function upsertCollection(client) {
    return (params) => replaceCollection(client)(params).catch((error) => error.statusCode === 404 ? addCollection(client)(params) : Promise.reject(error));
}
//------------------------------------------------------------------------------
// COMMAND: elasticsearch
//------------------------------------------------------------------------------
function elasticsearchCmd(client) {
    return Cmd.subcommands({
        name: "elasticsearch",
        description: "Show and manage Elasticsearch indices",
        cmds: {
            "current-index": elasticsearchCurrentIndexCmd(client),
            "indices-status": elasticsearchIndicesStatusCmd(client),
            "index-from-database": elasticsearchIndexFromDatabaseCmd(client),
            "change-index": elasticsearchChangeIndexCmd(client),
        },
    });
}
function elasticsearchChangeIndexCmd(client) {
    return Cmd.command({
        name: "current-index",
        description: "Change current Elasticsearch index",
        args: Object.assign(Object.assign({}, globalArgs), { currentIndex: Cmd.option({
                type: Cmd.string,
                long: "current-index",
                description: "Index to change the alias from",
            }), newIndex: Cmd.option({
                type: Cmd.string,
                long: "new-index",
                description: "Index to change the alias to",
            }), aliasName: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "alias-name",
                description: "alias to use for --new-index (default index if not provided)",
            }), deleteSource: Cmd.flag({
                long: "delete-source",
                defaultValue: () => false,
                description: "Delete the index specified for --current-index",
            }) }),
        handler: (_a) => {
            var { prefix } = _a, data = __rest(_a, ["prefix"]);
            return client
                .post("/elasticsearch/change-index")({ prefix, data })
                .then(fp.prop("message"));
        },
    });
}
function elasticsearchCurrentIndexCmd(client) {
    return Cmd.command({
        name: "current-index",
        description: "shows the current aliased index being" +
            " used by the Cumulus Elasticsearch instance",
        args: Object.assign({}, globalArgs),
        handler: client.get("/elasticsearch/current-index"),
    });
}
function elasticsearchIndexFromDatabaseCmd(client) {
    return Cmd.command({
        name: "index-from-database",
        description: "Re-index Elasticsearch from the database" +
            " (NOTE: after completion, you must run change-index to use the new index)",
        args: Object.assign(Object.assign({}, globalArgs), { indexName: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "index",
                description: "Name of an empty index",
                defaultValue: () => `cumulus-${new Date().toISOString().split("T")[0]}`,
                defaultValueIsSerializable: true,
            }) }),
        handler: (_a) => {
            var { prefix } = _a, data = __rest(_a, ["prefix"]);
            return client
                .post("/elasticsearch/index-from-database")({ prefix, data })
                .then(fp.prop("message"));
        },
    });
}
function elasticsearchIndicesStatusCmd(client) {
    return Cmd.command({
        name: "indices-status",
        description: "Display information about Elasticsearch indices",
        args: Object.assign({}, globalArgs),
        handler: fp.pipe(client.get("/elasticsearch/indices-status"), andThen(fp.prop("body"))),
    });
}
//------------------------------------------------------------------------------
// COMMAND: executions
//------------------------------------------------------------------------------
function executionsCmd(client) {
    return Cmd.subcommands({
        name: "executions",
        description: "Show workflow executions",
        cmds: {
            "find-by-list": findExecutionsByGranulesListCmd(client),
            // 'find-by-query': findExecutionsByESQuery(client),
            list: listExecutionsCmd(client),
        },
    });
}
// TODO Support many granules (currently only a single granule is supported)
function findExecutionsByGranulesListCmd(client) {
    return Cmd.command({
        name: "find-by-list",
        description: "Find executions associated with specified list of granules",
        args: Object.assign(Object.assign(Object.assign({}, globalArgs), listArgs), { collectionId: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "collection-id",
                description: "ID of the granule's collection",
            }), granuleId: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "granule-id",
                description: "ID of the granule",
            }), data: Cmd.option({
                type: Cmd.optional(JSONData),
                long: "data",
                short: "d",
            }) }),
        handler: (_a) => __awaiter(this, void 0, void 0, function* () {
            var _b;
            var { collectionId, granuleId, data } = _a, restOptions = __rest(_a, ["collectionId", "granuleId", "data"]);
            // The /executions/search-by-granules endpoint does not support field
            // selection, so we need to manually select fields, if supplied.
            const fields = (_b = restOptions.fields) === null || _b === void 0 ? void 0 : _b.split(",").map((field) => field.trim());
            const executions = yield list("/executions/search-by-granules")(client)(Object.assign(Object.assign({}, restOptions), { data: data !== null && data !== void 0 ? data : { granules: [{ collectionId, granuleId }] } }));
            return fields ? executions.map(fp.pick(fields)) : executions;
        }),
    });
}
function listExecutionsCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List executions",
        args: listArgs,
        handler: list("/executions")(client),
    });
}
//------------------------------------------------------------------------------
// COMMAND: granules
//------------------------------------------------------------------------------
function granulesCmd(client) {
    return Cmd.subcommands({
        name: "granules",
        description: "Show and manage granules",
        cmds: {
            get: granulesGetCmd(client),
            unpublish: granulesUnpublishCmd(client),
            delete: granulesDeleteCmd(client),
            reingest: granulesReingestCmd(client),
            process: granulesProcessCmd(client),
            list: granulesListCmd(client),
        },
    });
}
function granulesProcessCmd(client) {
    return Cmd.command({
        name: "process",
        description: "Process a granule via a workflow",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the granule to process",
            }), workflow: Cmd.option({
                type: Cmd.string,
                long: "workflow",
                description: "Name of the workflow (step function) to run",
            }) }),
        handler: ({ prefix, id, workflow }) => client.put(`/granules/${id}`)({
            prefix,
            data: { action: "applyWorkflow", workflow },
        }),
    });
}
function granulesUnpublishCmd(client) {
    return Cmd.command({
        name: "unpublish",
        description: "Unpublish a granule from the CMR",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the granule to unpublish",
            }) }),
        handler: ({ prefix, id }) => client.put(`/granules/${id}`)({
            prefix,
            data: { action: "removeFromCmr" },
        }),
    });
}
function granulesDeleteCmd(client) {
    return Cmd.command({
        name: "delete",
        description: "Delete a granule (must first be unpublished)",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the granule to delete",
            }) }),
        handler: ({ prefix, id }) => client.delete(`/granules/${id}`)({ prefix }),
    });
}
function granulesGetCmd(client) {
    return Cmd.command({
        name: "get",
        description: "Get details about a granule",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the granule to fetch",
            }) }),
        handler: ({ prefix, id }) => client.get(`/granules/${id}`)({ prefix }),
    });
}
function list(path) {
    return (client) => {
        return (_a) => __awaiter(this, void 0, void 0, function* () {
            var _b, e_1, _c, _d;
            var { prefix, all = false, limit = 10, page = 1, params = [] } = _a, restOptions = __rest(_a, ["prefix", "all", "limit", "page", "params"]);
            const allItems = [];
            const { data } = restOptions;
            const queryParams = Object.assign(Object.assign(Object.assign({}, Object.fromEntries(params)), fp.omit("data", restOptions)), { limit: all ? "100" : String(limit) });
            const getOrPost = "data" in restOptions ? client.post : client.get;
            const paramsWithPage = (page) => (Object.assign(Object.assign({}, queryParams), { page: `${page}` }));
            const requestPage = (page) => __awaiter(this, void 0, void 0, function* () {
                const options = { prefix, params: paramsWithPage(page), data };
                const response = yield getOrPost(path)(options);
                const results = fp.prop("results", response);
                return Array.isArray(results)
                    ? results.length > 0 && { output: results, input: page + 1 }
                    : Promise.reject(new Error(responseErrorMessage(response)));
            });
            try {
                // eslint-disable-next-line functional/no-loop-statement
                for (var _e = true, _f = __asyncValues((0, unfold_1.asyncUnfold)(requestPage)(page)), _g; _g = yield _f.next(), _b = _g.done, !_b;) {
                    _d = _g.value;
                    _e = false;
                    try {
                        const pageOfItems = _d;
                        // eslint-disable-next-line functional/immutable-data
                        allItems.push(...pageOfItems);
                        if (!all && allItems.length >= limit) {
                            break;
                        }
                    }
                    finally {
                        _e = true;
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_e && !_b && (_c = _f.return)) yield _c.call(_f);
                }
                finally { if (e_1) throw e_1.error; }
            }
            return all || allItems.length <= limit ? allItems : allItems.slice(0, limit);
        });
    };
}
function granulesListCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List granules",
        args: listArgs,
        handler: list("/granules")(client),
    });
}
function granulesReingestCmd(client) {
    return Cmd.command({
        name: "reingest",
        description: "Reingest a granule (https://nasa.github.io/cumulus-api/#reingest-granule)",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the granule to reingest",
            }), executionArn: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "execution-arn",
                description: "ARN of the execution (alternatively, supply workflow-name)",
            }), workflowName: Cmd.option({
                type: Cmd.optional(Cmd.string),
                long: "workflow-name",
                description: "Name of the workflow (step function) (ignored if execution-arn supplied)",
            }) }),
        handler: ({ prefix, id, executionArn, workflowName }) => client.put(`/granules/${id}`)({
            prefix,
            data: { action: "reingest", executionArn, workflowName },
        }),
    });
}
//------------------------------------------------------------------------------
// COMMAND: providers
//------------------------------------------------------------------------------
function providersCmd(client) {
    return Cmd.subcommands({
        name: "providers",
        description: "Show and manage providers",
        cmds: {
            add: addProviderCmd(client),
            replace: replaceProviderCmd(client),
            upsert: upsertProviderCmd(client),
            delete: deleteProviderCmd(client),
            list: listProvidersCmd(client),
        },
    });
}
function addProviderCmd(client) {
    return Cmd.command({
        name: "add",
        description: "Add a provider",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of provider definition",
            }) }),
        handler: addProvider(client),
    });
}
function addProvider(client) {
    return client.post("/providers");
}
function replaceProviderCmd(client) {
    return Cmd.command({
        name: "replace",
        description: "Replace a provider",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of provider definition",
            }) }),
        handler: replaceProvider(client),
    });
}
function replaceProvider(client) {
    return ({ prefix, data }) => {
        const result = safe(JSON.parse)(data);
        return Result.isOk(result)
            ? client.put(`/providers/${result.value.id}`)({
                prefix,
                data: result.value,
            })
            : Promise.reject(result.error);
    };
}
function deleteProviderCmd(client) {
    return Cmd.command({
        name: "delete",
        description: "Delete a provider",
        args: Object.assign(Object.assign({}, globalArgs), { id: Cmd.option({
                type: Cmd.string,
                long: "id",
                description: "ID of the provider to delete",
            }) }),
        handler: ({ prefix, id }) => client.delete(`/providers/${id}`)({ prefix }),
    });
}
function upsertProviderCmd(client) {
    return Cmd.command({
        name: "upsert",
        description: "Update (replace) a provider, or insert (add) it, if not found",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of provider definition",
            }) }),
        handler: upsertProvider(client),
    });
}
function upsertProvider(client) {
    return (params) => replaceProvider(client)(params).catch((error) => error.statusCode === 404 ? addProvider(client)(params) : Promise.reject(error));
}
function listProvidersCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List providers",
        args: listArgs,
        handler: list("/providers")(client),
    });
}
function rulesCmd(client) {
    return Cmd.subcommands({
        name: "rules",
        description: "Show and manage rules",
        cmds: {
            add: addRuleCmd(client),
            replace: replaceRuleCmd(client),
            upsert: upsertRuleCmd(client),
            delete: deleteRuleCmd(client),
            enable: setRuleStateCmd(client, "ENABLED"),
            disable: setRuleStateCmd(client, "DISABLED"),
            run: runRuleCmd(client),
            list: listRulesCmd(client),
        },
    });
}
function addRuleCmd(client) {
    return Cmd.command({
        name: "add",
        description: "Add a rule",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of rule definition",
            }) }),
        handler: addRule(client),
    });
}
function addRule(client) {
    return (params) => client.post("/rules")(params);
}
function deleteRuleCmd(client) {
    return Cmd.command({
        name: "add",
        description: "Delete a rule",
        args: Object.assign(Object.assign({}, globalArgs), { name: Cmd.option({
                type: Cmd.string,
                long: "name",
                short: "n",
                description: "Name of the rule to delete",
            }) }),
        handler: ({ prefix, name }) => client.delete(`/rules/${name}`)({ prefix }),
    });
}
function setRuleStateCmd(client, state) {
    return Cmd.command({
        name: "add",
        description: `Set a rule's state to '${state}'`,
        args: Object.assign(Object.assign({}, globalArgs), { name: Cmd.option({
                type: Cmd.string,
                long: "name",
                short: "n",
                description: "Name of the rule to change",
            }) }),
        handler: setRuleState(client, state),
    });
}
function setRuleState(client, state) {
    return ({ prefix, name, }) => __awaiter(this, void 0, void 0, function* () {
        const rule = (yield client.get(`/rules/${name}`)({ prefix }));
        return client.put(`/rules/${rule.name}`)({
            prefix,
            data: Object.assign(Object.assign({}, rule), { state }),
        });
    });
}
function replaceRuleCmd(client) {
    return Cmd.command({
        name: "replace",
        description: "Replace a rule",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of rule definition",
            }) }),
        handler: replaceRule(client),
    });
}
function replaceRule(client) {
    return ({ prefix, data }) => {
        const result = safe(JSON.parse)(data);
        return Result.isOk(result)
            ? client.put(`/rules/${result.value.name}`)({
                prefix,
                data: result.value,
            })
            : Promise.reject(result.error);
    };
}
function upsertRuleCmd(client) {
    return Cmd.command({
        name: "upsert",
        description: "Update (replace) a rule, or insert (add) it, if not found",
        args: Object.assign(Object.assign({}, globalArgs), { data: Cmd.option({
                type: JSONData,
                long: "data",
                short: "d",
                description: "Path to JSON file, or JSON string of rule definition",
            }) }),
        handler: upsertRule(client),
    });
}
function upsertRule(client) {
    return (params) => replaceRule(client)(params).catch((error) => error.statusCode === 404 ? addRule(client)(params) : Promise.reject(error));
}
function runRuleCmd(client) {
    return Cmd.command({
        name: "add",
        description: "Run a 'onetime' rule",
        args: Object.assign(Object.assign({}, globalArgs), { name: Cmd.option({
                type: Cmd.string,
                long: "name",
                short: "n",
                description: "Name of the 'onetime' rule to run",
            }) }),
        handler: ({ prefix, name }) => client.put(`/rules/${name}`)({ prefix, data: { name, action: "rerun" } }),
    });
}
function listRulesCmd(client) {
    return Cmd.command({
        name: "list",
        description: "List rules",
        args: listArgs,
        handler: list("/rules")(client),
    });
}
//------------------------------------------------------------------------------
// COMMAND: stats
//------------------------------------------------------------------------------
function statsCmd(client) {
    return Cmd.subcommands({
        name: "stats",
        description: "Show object statistics",
        cmds: {
            summary: statsSummaryCmd(client),
            count: statsCountCmd(client),
        },
    });
}
function statsSummaryCmd(client) {
    return Cmd.command({
        name: "summary",
        description: "Show summary of statistics related to granules in the system",
        args: Object.assign({}, globalArgs),
        handler: client.get("/stats"),
    });
}
function statsCountCmd(client) {
    return Cmd.command({
        name: "count",
        description: "Count values for a given field, for a given record type",
        args: Object.assign({}, globalArgs),
        handler: client.get("/stats/aggregate"),
    });
}
//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------
function safe(f) {
    // eslint-disable-next-line functional/functional-parameters
    return (...args) => {
        const value = fp.attempt(() => f(...args));
        return fp.isError(value) ? Result.err(value) : Result.ok(value);
    };
}
function andThen(f) {
    return (promise) => promise.then(f);
}
// function otherwise<T, U>(f: (arg: unknown) => U): (promise: Promise<T>) => Promise<U> {
//   return (promise: Promise<T>) => promise.then(null, f);
// }
function request({ prefix, method, path, params, data, invoke = cumulusApiClient_js_1.invokeApi, }) {
    const body = fp.isUndefined(data) || fp.isString(data) ? data : JSON.stringify(data);
    const payload = Object.assign(Object.assign({ resource: "/{proxy+}", httpMethod: method, path, headers: { "Cumulus-API-Version": "2", "Content-Type": "application/json" } }, (params ? { queryStringParameters: params } : {})), (body ? { body } : {}));
    const invokeParams = {
        prefix,
        payload,
        expectedStatusCodes: NO_RETRY_STATUS_CODES,
        pRetryOptions: {
            onFailedAttempt: fp.pipe(fp.prop("message"), console.error),
        },
    };
    // UGLY HACK!
    const debug = Boolean(process.env.DEBUG);
    if (debug) {
        console.log("REQUEST:", payload);
    }
    return invoke(invokeParams).then(fp.pipe(fp.tap((response) => debug && console.log("RESPONSE:", response)), fp.propOr("{}")("body"), fp.wrap(JSON.parse), fp.attempt, fp.cond([
        [fp.isError, (error) => Promise.reject(error)],
        [
            fp.overEvery([fp.prop("error"), fp.prop("message")]),
            (body) => Promise.reject(Object.assign(new Error(), body)),
        ],
        [fp.stubTrue, fp.identity],
    ])));
}
//------------------------------------------------------------------------------
// Main
//------------------------------------------------------------------------------
const app = mkApp(mkClient());
const isRunnerOutput = (u) => !fp.isNil(u) && fp.isObject(u) && fp.has("command", u) && fp.has("value", u);
const leaf = (output) => {
    if (isRunnerOutput(output)) {
        return leaf(output.value);
    }
    return typeof output === "string" ? output : JSON.stringify(output, null, 2);
};
const success = (message) => new effects_1.Exit({ exitCode: 0, message, into: "stdout" });
const failure = (message) => new effects_1.Exit({ exitCode: 1, message, into: "stderr" });
Cmd.runSafely(app, process.argv)
    .then((result) => (Result.isErr(result) ? result.error : success(leaf(result.value))))
    .catch(({ message }) => failure(`ERROR: ${message}`))
    .then((exit) => exit.run());
