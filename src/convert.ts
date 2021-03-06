import { Swagger } from './Swagger';
import { Paths } from './Paths';
import { Property } from './Property';
import { Schema } from './Schema';
import { PathItem } from './PathItem';
import { Operation } from './Operation';
import { Definitions } from './Definitions';
import { Options } from './Options';
import { EntitySet } from './EntitySet';
import { EntityType } from './EntityType';
import { EntityProperty } from './EntityProperty';
import { Parameter } from './Parameter';

const defaultResponse = {
  description: 'Unexpected error',
  schema: {
    $ref: '#/definitions/Error'
  }
}

const registeredOperations = new Set<string>();

function verifyOperationIdUniqueness(operationId: string): string {
  if (registeredOperations.has(operationId)) {
    throw new Error(`${operationId} is a duplicate operationId.`);
  }

  registeredOperations.add(operationId);

  return operationId;
}

function entitySetGet(entitySet: EntitySet, oDataVersion?: string): Operation {
  return {
    operationId: verifyOperationIdUniqueness(`get${entitySet.name}`),
    parameters: [{
      name: '$filter',
      type: 'string',
      required: false,
      in: 'query'
    },
    {
      name: '$top',
      type: 'integer',
      required: false,
      in: 'query'
    },
    {
      name: '$skip',
      type: 'integer',
      required: false,
      in: 'query'
    },
    {
      name: '$orderby',
      type: 'string',
      required: false,
      in: 'query'
    },
    {
      name: '$expand',
      type: 'string',
      required: false,
      in: 'query'
    },
    {
      name: oDataVersion == '4.0' ? '$count' : '$inlinecount',
      type: oDataVersion == '4.0' ? 'boolean' : 'string',
      required: false,
      in: 'query'
    }],
    responses: {
      '200': {
        description: `List of ${entitySet.entityType.name}`,
        schema: {
          type: 'object',
          properties: {
            value: {
              type: 'array',
              items: {
                $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
              }
            }
          }
        }
      },
      default: defaultResponse
    }
  };
}

function entitySetPost(entitySet: EntitySet): Operation {
  return {
    operationId: verifyOperationIdUniqueness(`create${entitySet.entityType.name}`),
    parameters: [
      {
        name: entitySet.entityType.name,
        in: 'body',
        required: true,
        schema: {
          $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
        }
      }
    ],
    responses: {
      '201': {
        description: "Created entity",
        schema: {
          $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
        }
      },
      default: defaultResponse
    }
  }
}

function entitySetOperations(entitySet: EntitySet, oDataVersion?: string): PathItem {
  return {
    get: entitySetGet(entitySet, oDataVersion),
    post: entitySetPost(entitySet)
  };
}

function entityTypeOperations(entitySet: EntitySet): PathItem {
  return {
    get: entityTypeGet(entitySet),
    delete: entityTypeDelete(entitySet),
    patch: entityTypePatch(entitySet)
  };
}

function keyParameters(entitySet: EntitySet): Array<Parameter> {
  return entitySet.entityType.key.map(entityProperty => {
    const { type, format } = property(entityProperty.type);

    const parameter: Parameter = {
      name: entityProperty.name,
      required: true,
      in: 'path',
      type
    };

    if (format) {
      parameter.format = format;
    }

    return parameter;
  });
}

function entityTypeGet(entitySet: EntitySet): Operation {
  return {
    operationId: verifyOperationIdUniqueness(`get${entitySet.entityType.name}ById`),
    parameters: keyParameters(entitySet),
    responses: {
      '200': {
        description: `A ${entitySet.entityType.name}.`,
        schema: {
          $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
        }
      },
      default: defaultResponse
    }
  };
}

function entityTypeDelete(entitySet: EntitySet): Operation {
  return {
    operationId: verifyOperationIdUniqueness(`delete${entitySet.entityType.name}`),
    parameters: keyParameters(entitySet),
    responses: {
      '204': {
        description: `Empty response.`,
      },
      default: defaultResponse
    }
  };
}
function entityTypePatch(entitySet: EntitySet): Operation {
  const parameters = keyParameters(entitySet);

  parameters.push({
    name: entitySet.entityType.name,
    in: 'body',
    required: true,
    schema: {
      $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
    }
  });

  return {
    operationId: verifyOperationIdUniqueness(`update${entitySet.entityType.name}`),
    parameters,
    responses: {
      '200': {
        description: `A ${entitySet.entityType.name}.`,
        schema: {
          $ref: `#/definitions/${entitySet.namespace}.${entitySet.entityType.name}`
        }
      },
      '204': {
        description: `Empty response.`,
      },
      default: defaultResponse
    }
  };
}

function paths(entitySets: Array<EntitySet>, oDataVersion?: string): Paths {
  const paths: Paths = {};

  entitySets.forEach(entitySet => {
    paths[`/${entitySet.name}`] = entitySetOperations(entitySet, oDataVersion);

    if (entitySet.entityType.key) {
      const keys = entitySet.entityType.key.map(property => {
        switch (property.type) {
          case 'Edm.Int16':
          case 'Edm.Int32':
          case 'Edm.Int64':
          case 'Edm.Double':
          case 'Edm.Single':
          case 'Edm.Decimal':
            return `{${property.name}}`
        }

        return `'{${property.name}}'`
      });

      const path = `/${entitySet.name}(${keys.join(',')})`

      paths[path] = entityTypeOperations(entitySet)
    }
  });

  return paths;
}

function definitions(entitySets: Array<EntitySet>): Definitions {
  const definitions: Definitions = {
    'Error': {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: {
              type: 'string'
            },
            message: {
              type: 'string'
            }
          }
        }
      }
    }
  };

  entitySets.forEach(entitySet => {
    const type = `${entitySet.namespace}.${entitySet.entityType.name}`;

    definitions[type] = schema(entitySet.entityType);

  });

  return definitions;
}

function schema(entityType: EntityType): Schema {
  const required = entityType.properties.filter(property => property.required).map(property => property.name);

  const schema: Schema = {
    type: 'object',
    properties: properties(entityType.properties),
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

function properties(properties: Array<EntityProperty>): { [name: string]: Property } {
  const result: { [name: string]: Property } = {};

  properties.forEach(({ name, type }) => {
    result[name] = property(type);
  })

  return result;
}

function property(type: string): Property {
  const property: Property = {
    type: type == 'array' ? 'array' : 'object'
  };

  switch (type) {
    case 'Edm.Int16':
    case 'Edm.Int32':
      property.type = 'integer';
      property.format = 'int32';
      break;
    case 'Edm.Int64':
      property.type = 'integer';
      property.format = 'int64';
      break;
    case 'Edm.Boolean':
      property.type = 'boolean';
      break;
    case 'Edm.String':
      property.type = 'string';
      break;
    case 'Edm.Byte':
      property.type = 'string';
      property.format = 'byte';
      break;
    case 'Edm.Binary':
      property.type = 'string';
      property.format = 'base64';
      break;      
    case 'Edm.DateTime':
    case 'Edm.DateTimeOffset':
      property.type = 'string';
      property.format = 'date-time';
      break;
    case 'Edm.Decimal':
    case 'Edm.Double':
      property.type = 'number';
      property.format = 'double';
      break;
    case 'Edm.Guid':
      property.type = 'string';
      property.format = 'uuid';
      break;
    case 'Edm.Single':
      property.type = 'number';
      property.format = 'single';
      break;
  }

  return property;
}

function filter(entitySets: Array<EntitySet>, wanted: Array<string>): Array<EntitySet> {
  return entitySets.filter(entitySet => wanted.includes(entitySet.name))
}

function convert(entitySets: Array<EntitySet>, options: Options, oDataVersion?: string): Swagger {
  registeredOperations.clear();

  return {
    swagger: '2.0',
    host: options.host,
    produces: ['application/json'],
    basePath: options.basePath || '/',
    info: {
      title: 'OData Service',
      version: '0.0.1',
      ['x-odata-version']: oDataVersion
    },
    paths: paths(options.include ? filter(entitySets, options.include) : entitySets, oDataVersion),
    definitions: definitions(entitySets)
  };
}

export default convert;
