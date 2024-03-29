#!/usr/bin/env node
import * as FS from "fs";

import { invokeApi } from "@cumulus/api-client/cumulusApiClient.js";
import type {
  ApiGatewayLambdaProxyPayload,
  HttpMethod,
  InvokeApiFunction,
} from "@cumulus/api-client/types";
import * as Cmd from "cmd-ts";
import * as Result from "cmd-ts/dist/cjs/Result";
import { Exit } from "cmd-ts/dist/cjs/effects";
import * as fp from "lodash/fp";

import { asyncUnfold } from "./unfold";

type RequestOptions = {
  readonly prefix: string;
  readonly params?: QueryParams;
  readonly data?: unknown;
};

type RequestFunction = (path: string) => (options: RequestOptions) => Promise<unknown>;

type QueryParams = {
  // This should be readonly, but it's not compatible with
  // ApiGatewayLambdaProxyPayload.queryStringParameters.
  //=> readonly [key: string]: string | readonly string[] | undefined;

  // eslint-disable-next-line functional/prefer-readonly-type
  [key: string]: string | string[] | undefined;
};

type Client = {
  readonly delete: RequestFunction;
  readonly get: RequestFunction;
  readonly post: RequestFunction;
  readonly put: RequestFunction;
  readonly patch: RequestFunction;
};

const NO_RETRY_STATUS_CODES = [
  200,
  201,
  202,
  204,
  ...Array.from({ length: 100 }, (_, k) => 400 + k), // 400-499
];

const JSONData: Cmd.Type<string, string> = {
  description: "Literal JSON value or path to JSON file",
  displayName: "JSON",

  async from(dataOrPath: string) {
    // Parse only to validate, returning original string, not parsed value.
    if (Result.isOk(safe(JSON.parse)(dataOrPath))) {
      return dataOrPath;
    }

    // Invalid JSON, so see if it's a file path
    const stats = safe(FS.statSync)(dataOrPath);
    const result = Result.isOk(stats)
      ? stats.value?.isFile()
        ? safe(() => FS.readFileSync(dataOrPath, "utf8"))()
        : Result.err(new Error("Value is a directory, not a file"))
      : Result.err(new Error("Value is neither a file, nor a valid JSON literal"));

    return Result.isOk(result) ? result.value : Promise.reject(result.error);
  },
};

const QueryStringParameter: Cmd.Type<string, readonly [string, string]> = {
  description: "Query string parameter",
  displayName: "NAME=VALUE",

  async from(param) {
    const [name, value, ...rest] = param.split("=");

    return !name?.length || !value?.length || rest.length
      ? Promise.reject(new Error("Option must be of the form NAME=VALUE"))
      : [name, value];
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

const listArgs = {
  ...globalArgs,
  all: Cmd.flag({
    long: "all",
    description: "List ALL records, regardless of --limit",
  }),
  limit: Cmd.option({
    type: Cmd.number,
    long: "limit",
    description: "Number of records to return",
    defaultValue: () => 10,
    defaultValueIsSerializable: true,
  }),
  page: Cmd.option({
    type: Cmd.number,
    long: "page",
    description: "Page number (1-based)",
    defaultValue: () => 1,
    defaultValueIsSerializable: true,
  }),
  sort_by: Cmd.option({
    type: Cmd.string,
    long: "sort-by",
    description: "Name of field to sort records by",
    defaultValue: () => "timestamp",
    defaultValueIsSerializable: true,
  }),
  order: Cmd.option({
    type: Cmd.oneOf(["asc", "desc"]),
    long: "order",
    description: "Name of field to sort records by",
    defaultValue: (): "asc" | "desc" => "asc",
    defaultValueIsSerializable: true,
  }),
  params: Cmd.multioption({
    type: Cmd.array(QueryStringParameter),
    long: "param",
    short: "?",
    description: "Query string parameter (may be specified multiple times)",
  }),
  fields: Cmd.option({
    type: Cmd.optional(Cmd.string),
    long: "fields",
    description:
      "Comma-separated list of field names to return in each record" +
      " (if not specified, all fields are returned)",
  }),
};

function responseErrorMessage(response: unknown) {
  const reasons = fp.map(
    fp.prop("reason"),
    fp.pathOr([], ["meta", "body", "error", "root_cause"], response)
  );

  return reasons.join(" | ") || JSON.stringify(response);
}

function mkClient(invoke?: InvokeApiFunction) {
  const mkMethod =
    (method: HttpMethod): RequestFunction =>
    (path: string) =>
    ({ prefix, params, data }: RequestOptions) =>
      request({ prefix, method, path, params, data, invoke });

  return {
    delete: mkMethod("DELETE"),
    get: mkMethod("GET"),
    post: mkMethod("POST"),
    put: mkMethod("PUT"),
    patch: mkMethod("PATCH"),
  };
}

function mkApp(client: Client) {
  return Cmd.binary(
    Cmd.subcommands({
      name: "cumulus",
      description: "Cumulus API Command-Line Interface",
      cmds: {
        "async-operations": asyncOperationsCmd(client),
        collections: collectionsCmd(client),
        "dead-letter-archive": deadLetterArchiveCmd(client),
        elasticsearch: elasticsearchCmd(client),
        executions: executionsCmd(client),
        granules: granulesCmd(client),
        providers: providersCmd(client),
        "reconciliation-reports": reconciliationReportsCmd(client),
        rules: rulesCmd(client),
        stats: statsCmd(client),
        version: Cmd.command({
          name: "version",
          description: "Show the Cumulus API version",
          args: globalArgs,
          handler: client.get(`/version`),
        }),
      },
    })
  );
}

//------------------------------------------------------------------------------
// COMMAND: async-operations
//------------------------------------------------------------------------------

function asyncOperationsCmd(client: Client) {
  return Cmd.subcommands({
    name: "async-operations",
    description: "Show async operations",
    cmds: {
      get: getAsyncOperationCmd(client),
      list: listAsyncOperationsCmd(client),
    },
  });
}

function getAsyncOperationCmd(client: Client) {
  return Cmd.command({
    name: "get",
    description: "Get information about an async operation",
    args: {
      ...globalArgs,
      id: Cmd.option({
        type: Cmd.string,
        long: "id",
        description: "ID of an async operation",
      }),
    },
    handler: ({ prefix, id }) => client.get(`/asyncOperations/${id}`)({ prefix }),
  });
}

function listAsyncOperationsCmd(client: Client) {
  return Cmd.command({
    name: "list",
    description: "List async operations",
    args: listArgs,
    handler: ({ fields = "id", ...rest }) =>
      list("/asyncOperations")(client)({ ...rest, fields }),
  });
}

//------------------------------------------------------------------------------
// COMMAND: collections
//------------------------------------------------------------------------------

function collectionsCmd(client: Client) {
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

function addCollectionCmd(client: Client) {
  return Cmd.command({
    name: "add",
    description: "Add a collection",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
      }),
    },
    handler: addCollection(client),
  });
}

function addCollection(client: Client) {
  return (params: { readonly prefix: string; readonly data: string }) =>
    client.post("/collections")(params);
}

function deleteCollectionCmd(client: Client) {
  return Cmd.command({
    name: "delete",
    description: "Delete a collection",
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the collection to delete",
      }),
      version: Cmd.option({
        type: Cmd.string,
        long: "version",
        short: "v",
        description: "Version of the collection to delete",
      }),
    },
    handler: ({ prefix, name, version }) =>
      client.delete(`/collections/${name}/${version}`)({ prefix }),
  });
}

function replaceCollectionCmd(client: Client) {
  return Cmd.command({
    name: "replace",
    description: "Replace a collection",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "path to JSON file, or JSON string of collection definition",
      }),
    },
    handler: replaceCollection(client),
  });
}

function replaceCollection(client: Client) {
  return ({ prefix, data }: { readonly prefix: string; readonly data: string }) => {
    const result = safe(JSON.parse)(data);
    if (Result.isErr(result)) {
      return Promise.reject(result.error);
    }
    const { name, version } = result.value;
    return client.put(`/collections/${name}/${version}`)({ prefix, data });
  };
}

function listCollectionsCmd(client: Client) {
  return Cmd.command({
    name: "list",
    description: "List collections",
    args: listArgs,
    handler: list("/collections")(client),
  });
}

function upsertCollectionCmd(client: Client) {
  return Cmd.command({
    name: "upsert",
    description: "Update (replace) a collection, or insert (add) it, if not found",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "path to JSON file, or JSON string of collection definition",
      }),
    },
    handler: upsertCollection(client),
  });
}

function upsertCollection(client: Client) {
  return (params: { readonly prefix: string; readonly data: string }) =>
    replaceCollection(client)(params).catch((error) =>
      error.statusCode === 404 ? addCollection(client)(params) : Promise.reject(error)
    );
}

//------------------------------------------------------------------------------
// COMMAND: elasticsearch
//------------------------------------------------------------------------------

function elasticsearchCmd(client: Client) {
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

function elasticsearchChangeIndexCmd(client: Client) {
  return Cmd.command({
    name: "current-index",
    description: "Change current Elasticsearch index",
    args: {
      ...globalArgs,
      currentIndex: Cmd.option({
        type: Cmd.string,
        long: "current-index",
        description: "Index to change the alias from",
      }),
      newIndex: Cmd.option({
        type: Cmd.string,
        long: "new-index",
        description: "Index to change the alias to",
      }),
      aliasName: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "alias-name",
        description: "alias to use for --new-index (default index if not provided)",
      }),
      deleteSource: Cmd.flag({
        long: "delete-source",
        defaultValue: () => false,
        description: "Delete the index specified for --current-index",
      }),
    },
    handler: ({ prefix, ...data }) =>
      client
        .post("/elasticsearch/change-index")({ prefix, data })
        .then(fp.prop("message")),
  });
}

function elasticsearchCurrentIndexCmd(client: Client) {
  return Cmd.command({
    name: "current-index",
    description:
      "shows the current aliased index being" +
      " used by the Cumulus Elasticsearch instance",
    args: { ...globalArgs },
    handler: client.get("/elasticsearch/current-index"),
  });
}

function elasticsearchIndexFromDatabaseCmd(client: Client) {
  return Cmd.command({
    name: "index-from-database",
    description:
      "Re-index Elasticsearch from the database" +
      " (NOTE: after completion, you must run change-index to use the new index)",
    args: {
      ...globalArgs,
      indexName: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "index",
        description: "Name of an empty index",
        defaultValue: () => `cumulus-${new Date().toISOString().split("T")[0]}`,
        defaultValueIsSerializable: true,
      }),
    },
    handler: ({ prefix, ...data }) =>
      client
        .post("/elasticsearch/index-from-database")({ prefix, data })
        .then(fp.prop("message")),
  });
}

function elasticsearchIndicesStatusCmd(client: Client) {
  return Cmd.command({
    name: "indices-status",
    description: "Display information about Elasticsearch indices",
    args: { ...globalArgs },
    handler: fp.pipe(
      client.get("/elasticsearch/indices-status"),
      andThen(fp.prop("body"))
    ),
  });
}

//------------------------------------------------------------------------------
// COMMAND: executions
//------------------------------------------------------------------------------

function executionsCmd(client: Client) {
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
function findExecutionsByGranulesListCmd(client: Client) {
  return Cmd.command({
    name: "find-by-list",
    description: "Find executions associated with specified list of granules",
    args: {
      ...globalArgs,
      ...listArgs,
      collectionId: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "collection-id",
        description: "ID of the granule's collection",
      }),
      granuleId: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "granule-id",
        description: "ID of the granule",
      }),
      data: Cmd.option({
        type: Cmd.optional(JSONData),
        long: "data",
        short: "d",
      }),
    },
    handler: async ({ collectionId, granuleId, data, ...restOptions }) => {
      // The /executions/search-by-granules endpoint does not support field
      // selection, so we need to manually select fields, if supplied.
      const fields = restOptions.fields?.split(",").map((field) => field.trim());
      const executions = await list("/executions/search-by-granules")(client)({
        ...restOptions,
        data: data ?? { granules: [{ collectionId, granuleId }] },
      });

      return fields ? executions.map(fp.pick(fields)) : executions;
    },
  });
}

function listExecutionsCmd(client: Client) {
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

function granulesCmd(client: Client) {
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

function granulesProcessCmd(client: Client) {
  return Cmd.command({
    name: "process",
    description: "Process a granule via a workflow",
    args: {
      ...globalArgs,
      collectionId: Cmd.option({
        type: Cmd.string,
        long: "collection-id",
        description: "ID of the collection containing the granule",
      }),
      granuleId: Cmd.option({
        type: Cmd.string,
        long: "granule-id",
        description: "ID of the granule to process",
      }),
      workflow: Cmd.option({
        type: Cmd.string,
        long: "workflow",
        description: "Name of the workflow (step function) to run",
      }),
    },
    handler: ({ prefix, collectionId, granuleId, workflow }) =>
      client.patch(`/granules/${collectionId}/${granuleId}`)({
        prefix,
        data: { action: "applyWorkflow", workflow },
      }),
  });
}

function granulesUnpublishCmd(client: Client) {
  return Cmd.command({
    name: "unpublish",
    description: "Unpublish a granule from the CMR",
    args: {
      ...globalArgs,
      collectionId: Cmd.option({
        type: Cmd.string,
        long: "collection-id",
        description: "ID of the collection containing the granule",
      }),
      granuleId: Cmd.option({
        type: Cmd.string,
        long: "granule-id",
        description: "ID of the granule to unpublish",
      }),
    },
    handler: ({ prefix, collectionId, granuleId }) =>
      client.patch(`/granules/${collectionId}/${granuleId}`)({
        prefix,
        data: { action: "removeFromCmr" },
      }),
  });
}

function granulesDeleteCmd(client: Client) {
  return Cmd.command({
    name: "delete",
    description: "Delete a granule (must first be unpublished)",
    args: {
      ...globalArgs,
      collectionId: Cmd.option({
        type: Cmd.string,
        long: "collection-id",
        description: "ID of the collection containing the granule",
      }),
      granuleId: Cmd.option({
        type: Cmd.string,
        long: "granule-id",
        description: "ID of the granule to delete",
      }),
    },
    handler: ({ prefix, collectionId, granuleId }) =>
      client.delete(`/granules/${collectionId}/${granuleId}`)({ prefix }),
  });
}

function granulesGetCmd(client: Client) {
  return Cmd.command({
    name: "get",
    description: "Get details about a granule",
    args: {
      ...globalArgs,
      collectionId: Cmd.option({
        type: Cmd.string,
        long: "collection-id",
        description: "ID of the collection to which the granule belongs",
      }),
      granuleId: Cmd.option({
        type: Cmd.string,
        long: "granule-id",
        description: "ID of the granule to fetch",
      }),
    },
    handler: ({ prefix, collectionId, granuleId }) =>
      client.get(`/granules/${collectionId}/${granuleId}`)({ prefix }),
  });
}

function list(path: string) {
  return (client: Client) => {
    return async ({
      prefix,
      all = false,
      limit = 10,
      page = 1,
      params = [],
      ...restOptions
    }: {
      readonly prefix: string;
      readonly all?: boolean;
      readonly limit?: number;
      readonly page?: number;
      readonly params?: readonly (readonly [string, string])[];
      readonly data?: unknown;
      readonly [key: string]: unknown;
    }) => {
      const allItems = [];
      const { data } = restOptions;
      const queryParams = {
        ...Object.fromEntries(params),
        ...fp.omit("data", restOptions),
        limit: all ? "100" : String(limit),
      };
      const getOrPost = "data" in restOptions ? client.post : client.get;
      const paramsWithPage = (page: number) => ({ ...queryParams, page: `${page}` });
      const requestPage = async (page: number) => {
        const options = { prefix, params: paramsWithPage(page), data };
        const response = await getOrPost(path)(options);
        const results = fp.prop("results", response);

        return Array.isArray(results)
          ? results.length > 0 && { output: results, input: page + 1 }
          : Promise.reject(new Error(responseErrorMessage(response)));
      };

      // eslint-disable-next-line functional/no-loop-statement
      for await (const pageOfItems of asyncUnfold(requestPage)(page)) {
        // eslint-disable-next-line functional/immutable-data
        allItems.push(...pageOfItems);
        if (!all && allItems.length >= limit) {
          break;
        }
      }

      return all || allItems.length <= limit ? allItems : allItems.slice(0, limit);
    };
  };
}

function granulesListCmd(client: Client) {
  return Cmd.command({
    name: "list",
    description: "List granules",
    args: listArgs,
    handler: list("/granules")(client),
  });
}

function granulesReingestCmd(client: Client) {
  return Cmd.command({
    name: "reingest",
    description:
      "Reingest a granule (https://nasa.github.io/cumulus-api/#reingest-granule)",
    args: {
      ...globalArgs,
      collectionId: Cmd.option({
        type: Cmd.string,
        long: "collection-id",
        description: "ID of the collection containing the granule to reingest",
      }),
      granuleId: Cmd.option({
        type: Cmd.string,
        long: "granule-id",
        description: "ID of the granule to reingest",
      }),
      executionArn: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "execution-arn",
        description: "ARN of the execution (alternatively, supply workflow-name)",
      }),
      workflowName: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "workflow-name",
        description:
          "Name of the workflow (step function) (ignored if execution-arn supplied)",
      }),
    },
    handler: ({ prefix, collectionId, granuleId, executionArn, workflowName }) =>
      client.patch(`/granules/${collectionId}/${granuleId}`)({
        prefix,
        data: { action: "reingest", executionArn, workflowName },
      }),
  });
}

//------------------------------------------------------------------------------
// COMMAND: providers
//------------------------------------------------------------------------------

function providersCmd(client: Client) {
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

function addProviderCmd(client: Client) {
  return Cmd.command({
    name: "add",
    description: "Add a provider",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of provider definition",
      }),
    },
    handler: addProvider(client),
  });
}

function addProvider(client: Client) {
  return client.post("/providers");
}

function replaceProviderCmd(client: Client) {
  return Cmd.command({
    name: "replace",
    description: "Replace a provider",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of provider definition",
      }),
    },
    handler: replaceProvider(client),
  });
}

function replaceProvider(client: Client) {
  return ({ prefix, data }: { readonly prefix: string; readonly data: string }) => {
    const result = safe(JSON.parse)(data);

    return Result.isOk(result)
      ? client.put(`/providers/${result.value.id}`)({
          prefix,
          data: result.value,
        })
      : Promise.reject(result.error);
  };
}

function deleteProviderCmd(client: Client) {
  return Cmd.command({
    name: "delete",
    description: "Delete a provider",
    args: {
      ...globalArgs,
      id: Cmd.option({
        type: Cmd.string,
        long: "id",
        description: "ID of the provider to delete",
      }),
    },
    handler: ({ prefix, id }) => client.delete(`/providers/${id}`)({ prefix }),
  });
}

function upsertProviderCmd(client: Client) {
  return Cmd.command({
    name: "upsert",
    description: "Update (replace) a provider, or insert (add) it, if not found",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of provider definition",
      }),
    },
    handler: upsertProvider(client),
  });
}

function upsertProvider(client: Client) {
  return (params: { readonly prefix: string; readonly data: string }) =>
    replaceProvider(client)(params).catch((error) =>
      error.statusCode === 404 ? addProvider(client)(params) : Promise.reject(error)
    );
}

function listProvidersCmd(client: Client) {
  return Cmd.command({
    name: "list",
    description: "List providers",
    args: listArgs,
    handler: list("/providers")(client),
  });
}

//------------------------------------------------------------------------------
// COMMAND: rules
//------------------------------------------------------------------------------

function rulesCmd(client: Client) {
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

function addRuleCmd(client: Client) {
  return Cmd.command({
    name: "add",
    description: "Add a rule",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of rule definition",
      }),
    },
    handler: addRule(client),
  });
}

function addRule(client: Client) {
  return (params: { readonly prefix: string; readonly data: string }) =>
    client.post("/rules")(params);
}

function deleteRuleCmd(client: Client) {
  return Cmd.command({
    name: "add",
    description: "Delete a rule",
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the rule to delete",
      }),
    },
    handler: ({ prefix, name }) => client.delete(`/rules/${name}`)({ prefix }),
  });
}

function setRuleStateCmd(client: Client, state: "ENABLED" | "DISABLED") {
  return Cmd.command({
    name: "add",
    description: `Set a rule's state to '${state}'`,
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the rule to change",
      }),
    },
    handler: ({ prefix, name }) =>
      client.patch(`/rules/${name}`)({
        prefix,
        data: { state },
      }),
  });
}

function replaceRuleCmd(client: Client) {
  return Cmd.command({
    name: "replace",
    description: "Replace a rule",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of rule definition",
      }),
    },
    handler: replaceRule(client),
  });
}

function replaceRule(client: Client) {
  return ({ prefix, data }: { readonly prefix: string; readonly data: string }) => {
    const result = safe(JSON.parse)(data);

    return Result.isOk(result)
      ? client.put(`/rules/${result.value.name}`)({
          prefix,
          data: result.value,
        })
      : Promise.reject(result.error);
  };
}

function upsertRuleCmd(client: Client) {
  return Cmd.command({
    name: "upsert",
    description: "Update (replace) a rule, or insert (add) it, if not found",
    args: {
      ...globalArgs,
      data: Cmd.option({
        type: JSONData,
        long: "data",
        short: "d",
        description: "Path to JSON file, or JSON string of rule definition",
      }),
    },
    handler: upsertRule(client),
  });
}

function upsertRule(client: Client) {
  return (params: { readonly prefix: string; readonly data: string }) =>
    replaceRule(client)(params).catch((error) =>
      error.statusCode === 404 ? addRule(client)(params) : Promise.reject(error)
    );
}

function runRuleCmd(client: Client) {
  return Cmd.command({
    name: "add",
    description: "Run a 'onetime' rule",
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the 'onetime' rule to run",
      }),
    },
    handler: ({ prefix, name }) =>
      client.patch(`/rules/${name}`)({ prefix, data: { action: "rerun" } }),
  });
}

function listRulesCmd(client: Client) {
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

function statsCmd(client: Client) {
  return Cmd.subcommands({
    name: "stats",
    description: "Show object statistics",
    cmds: {
      summary: statsSummaryCmd(client),
      count: statsCountCmd(client),
    },
  });
}

function statsSummaryCmd(client: Client) {
  return Cmd.command({
    name: "summary",
    description: "Show summary of statistics related to granules in the system",
    args: {
      ...globalArgs,
    },
    handler: client.get("/stats"),
  });
}

function statsCountCmd(client: Client) {
  return Cmd.command({
    name: "count",
    description: "Count values for a given field, for a given record type",
    args: {
      ...globalArgs,
    },
    handler: client.get("/stats/aggregate"),
  });
}

//------------------------------------------------------------------------------
// COMMAND: deadLetterArchive
//------------------------------------------------------------------------------

function deadLetterArchiveCmd(client: Client) {
  return Cmd.subcommands({
    name: "deadLetterArchive",
    description: "Manage the dead letter archive",
    cmds: {
      "recover-cumulus-messages": recoverCumulusMessagesCmd(client),
    },
  });
}

function recoverCumulusMessagesCmd(client: Client) {
  return Cmd.command({
    name: "recover-cumulus-messages",
    description:
      "Recover S3 dead letter objects written when DB updates of granule statuses fail",
    args: {
      ...globalArgs,
      bucket: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "bucket",
        description: "The bucket to read records from (default: system bucket)",
      }),
      path: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "path",
        description:
          "The S3 prefix (path) to read DLQ records from (default: <prefix>/dead-letter-archive/sqs/)",
      }),
    },
    handler: ({ prefix, bucket, path }) => {
      const data =
        bucket && path
          ? { bucket, path }
          : bucket
          ? { bucket }
          : path
          ? { path }
          : undefined;

      return client.post("/deadLetterArchive/recoverCumulusMessages")({ prefix, data });
    },
  });
}

//------------------------------------------------------------------------------
// COMMAND: reconciliationReports
//------------------------------------------------------------------------------

function reconciliationReportsCmd(client: Client) {
  return Cmd.subcommands({
    name: "reconciliationReports",
    description: "Manage reconciliation reports",
    cmds: {
      create: reconciliationReportsCreateCmd(client),
      get: reconciliationReportsGetCmd(client),
      delete: reconciliationReportsDeleteCmd(client),
      list: reconciliationReportsListCmd(client),
    },
  });
}

function reconciliationReportsListCmd(client: Client) {
  return Cmd.command({
    name: "list",
    description: "List reconciliation reports",
    args: listArgs,
    handler: ({ fields, ...rest }) =>
      list("/reconciliationReports")(client)({ ...rest, fields }),
  });
}

function reconciliationReportsGetCmd(client: Client) {
  return Cmd.command({
    name: "get",
    description: "Get a reconciliation report",
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the report to retrieve",
      }),
    },
    handler: ({ prefix, name }) =>
      client.get(`/reconciliationReports/${name}`)({ prefix }),
  });
}

function reconciliationReportsDeleteCmd(client: Client) {
  return Cmd.command({
    name: "get",
    description: "Delete a reconciliation report",
    args: {
      ...globalArgs,
      name: Cmd.option({
        type: Cmd.string,
        long: "name",
        short: "n",
        description: "Name of the report to delete",
      }),
    },
    handler: ({ prefix, name }) =>
      client.delete(`/reconciliationReports/${name}`)({ prefix }),
  });
}

function reconciliationReportsCreateCmd(client: Client) {
  return Cmd.command({
    name: "create",
    description: "Create a reconciliation report",
    args: {
      ...globalArgs,
      reportName: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "report-name",
        short: "n",
        description:
          "Name of the report (default: combination of report-type and creation date/time)",
      }),
      reportType: Cmd.option({
        type: Cmd.optional(
          Cmd.oneOf([
            "Inventory",
            "Granule Inventory",
            "Granule Not Found",
            "ORCA Backup",
            "Internal",
          ])
        ),
        long: "report-type",
        short: "t",
        description: "Type of report to create",
        defaultValue: () => "Inventory",
        defaultValueIsSerializable: true,
      }),
      collectionIds: Cmd.multioption({
        type: Cmd.optional(Cmd.array(Cmd.string)),
        long: "collection-id",
        short: "c",
        description:
          "Collection ID(s) for comparison of collection and granule holdings",
      }),
      granuleIds: Cmd.multioption({
        type: Cmd.optional(Cmd.array(Cmd.string)),
        long: "granule-id",
        short: "g",
        description: "Granule ID(s) for comparison of collection and granule holdings",
      }),
      providers: Cmd.multioption({
        type: Cmd.optional(Cmd.array(Cmd.string)),
        long: "provider",
        short: "p",
        description: "Provider names(s) for comparison of granule holdings",
      }),
      status: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "status",
        short: "s",
        description: "Status filter for Granule Inventory reports",
      }),
      startTimestamp: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "start-timestamp",
        description:
          "Data older than this will be ignored in the generated report." +
          " Any input valid for a JavaScript Date contstructor, including ISO8601.",
      }),
      endTimestamp: Cmd.option({
        type: Cmd.optional(Cmd.string),
        long: "end-timestamp",
        description:
          "Data newer than this will be ignored in the generated report." +
          " Any input valid for a JavaScript Date contstructor, including ISO8601.",
      }),
    },
    handler: ({ prefix, collectionIds, granuleIds, providers, ...data }) => {
      return client.post("/reconciliationReports")({
        prefix,
        data,
        // Ensure that empty arrays are not sent to the API, otherwise the API
        // will construct a DB query with a syntax error, since it seems not to
        // bother to check whether the array is empty before constructing the
        // query.
        ...(collectionIds?.length ? { collectionId: collectionIds } : {}),
        ...(granuleIds?.length ? { granuleId: granuleIds } : {}),
        ...(providers?.length ? { provider: providers } : {}),
      });
    },
  });
}

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

function safe<T extends readonly unknown[], U>(f: (...args: T) => U) {
  // eslint-disable-next-line functional/functional-parameters
  return (...args: T): Result.Result<Error, U> => {
    const value = fp.attempt(() => f(...args));
    return fp.isError(value) ? Result.err(value) : Result.ok(value);
  };
}

function andThen<T, U>(f: (arg: T) => U): (promise: Promise<T>) => Promise<U> {
  return (promise: Promise<T>) => promise.then(f);
}

// function otherwise<T, U>(f: (arg: unknown) => U): (promise: Promise<T>) => Promise<U> {
//   return (promise: Promise<T>) => promise.then(null, f);
// }

function request({
  prefix,
  method,
  path,
  params,
  data,
  invoke = invokeApi,
}: {
  readonly prefix: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly params?: QueryParams | undefined;
  readonly data?: unknown;
  readonly invoke: InvokeApiFunction | undefined;
}) {
  const body = fp.isUndefined(data) || fp.isString(data) ? data : JSON.stringify(data);
  const payload: ApiGatewayLambdaProxyPayload = {
    resource: "/{proxy+}",
    httpMethod: method,
    path,
    headers: { "Cumulus-API-Version": "2", "Content-Type": "application/json" },
    ...(params ? { queryStringParameters: params } : {}),
    ...(body ? { body } : {}),
  };
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
    console.error("REQUEST:", payload);
  }

  return invoke(invokeParams).then(
    fp.pipe(
      fp.tap((response) => debug && console.error("RESPONSE:", response)),
      fp.propOr("{}")("body"),
      fp.wrap(JSON.parse),
      fp.attempt,
      fp.cond([
        [fp.isError, (error) => Promise.reject(error)],
        [
          fp.overEvery([fp.prop("error"), fp.prop("message")]),
          (body) => Promise.reject(Object.assign(new Error(), body)),
        ],
        [fp.stubTrue, fp.identity],
      ])
    )
  );
}

//------------------------------------------------------------------------------
// Main
//------------------------------------------------------------------------------

const app = mkApp(mkClient());

type RunnerOutput = {
  readonly command: string;
  readonly value: unknown;
};

const isRunnerOutput = (u: unknown): u is RunnerOutput =>
  !fp.isNil(u) && fp.isObject(u) && fp.has("command", u) && fp.has("value", u);

const leaf = (output: unknown): string => {
  if (isRunnerOutput(output)) {
    return leaf(output.value);
  }
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
};

const success = (message: string) => new Exit({ exitCode: 0, message, into: "stdout" });

const failure = (message: string) => new Exit({ exitCode: 1, message, into: "stderr" });

Cmd.runSafely(app, process.argv)
  .then((result) => (Result.isErr(result) ? result.error : success(leaf(result.value))))
  .catch(({ message }) => failure(`ERROR: ${message}`))
  .then((exit) => exit.run());
