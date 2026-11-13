/**
 * OpenAPI 3.0 specification for the LumiBase v0.1 API.
 *
 * Hand-written because our request/response types are TypeScript + Zod,
 * not auto-generated from JSON Schema. This document is the machine-
 * readable companion to specs/payments/*.json; if either changes, this
 * must be updated alongside.
 *
 * Served at GET /openapi.json (spec) and GET /docs (Swagger UI). Both
 * require no auth — API documentation is intentionally public so
 * developers can read it before obtaining a key.
 */

import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { OpenAPIV3 } from 'openapi-types';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'LumiBase API',
    version: '0.1.0',
    description:
      'Open-source developer toolkit for building applications on Base. ' +
      'Payment endpoints follow specs/payments/*.json exactly.',
  },
  servers: [{ url: '/api/v1', description: 'Versioned API' }],
  components: {
    securitySchemes: {
      ApplicationKey: {
        type: 'http',
        scheme: 'bearer',
        description: 'Application API key. Format: `Authorization: Bearer lb_<base64url>`.',
      },
      AdminKey: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'Admin key. Format: `Authorization: Admin <API_SECRET>`.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
        },
      },
      Payment: {
        type: 'object',
        required: [
          'id',
          'applicationId',
          'chainId',
          'token',
          'amount',
          'recipient',
          'status',
          'expiresAt',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          applicationId: { type: 'string', format: 'uuid' },
          chainId: { type: 'integer' },
          token: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          amount: { type: 'string', pattern: '^[1-9][0-9]*$' },
          recipient: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          payer: { type: 'string', nullable: true },
          reference: { type: 'string', nullable: true },
          status: {
            type: 'string',
            enum: [
              'pending',
              'processing',
              'confirmed',
              'expired',
              'failed',
              'cancelled',
              'underpaid',
              'overpaid',
            ],
          },
          expiresAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          metadata: { type: 'object', nullable: true },
        },
      },
    },
  },
  paths: {
    '/applications': {
      post: {
        summary: 'Create an application (admin only)',
        security: [{ AdminKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string', maxLength: 100 } },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Application created. Plaintext key returned once.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    application: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        name: { type: 'string' },
                        status: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                    key: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid body',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Missing or invalid admin key',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/payments': {
      post: {
        summary: 'Create a payment request',
        security: [{ ApplicationKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount', 'chainId', 'token', 'recipient', 'expiresIn'],
                properties: {
                  amount: {
                    type: 'string',
                    description: "Base units, e.g. '1500000' for 1.5 USDC",
                  },
                  chainId: { type: 'integer', description: '84532 for Base Sepolia' },
                  token: { type: 'string', description: 'ERC-20 contract address' },
                  recipient: { type: 'string', description: 'EVM address' },
                  payer: { type: 'string', nullable: true },
                  reference: { type: 'string', nullable: true },
                  expiresIn: { type: 'integer', description: 'Seconds from now' },
                  metadata: { type: 'object', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Payment created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
          '400': {
            description: 'Invalid body',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '422': {
            description: 'Unsupported chain or token',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
      get: {
        summary: 'List payments for the calling application',
        security: [{ ApplicationKey: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'reference', in: 'query', schema: { type: 'string' } },
          { name: 'chainId', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'Payments list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    payments: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid query',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/payments/{id}': {
      get: {
        summary: 'Retrieve a payment',
        security: [{ ApplicationKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Payment',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
          '404': {
            description: 'Not found or not yours',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/payments/{id}/status': {
      get: {
        summary: 'Lightweight status lookup (no blockchain calls)',
        security: [{ ApplicationKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    status: { type: 'string' },
                    updatedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/payments/{id}/confirm': {
      post: {
        summary: 'Submit a transaction hash for verification',
        description:
          'Independently verifies the transaction against the payment request. ' +
          'The payment is confirmed only when a single transaction matches the ' +
          'recipient, token, network, optional payer, and exact amount, and ' +
          "satisfies the chain's confirmation policy.",
        security: [{ ApplicationKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transactionHash'],
                properties: {
                  transactionHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Payment state after verification. `error` is null on success or ' +
              'a code from specs/payments/errors.json when the payment remained ' +
              'pending due to a rejected attempt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    payment: { $ref: '#/components/schemas/Payment' },
                    error: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid transactionHash',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '404': {
            description: 'Payment not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/payments/{id}/cancel': {
      post: {
        summary: 'Cancel a pending payment',
        description:
          'Idempotent: cancelling an already-cancelled payment returns its current state.',
        security: [{ ApplicationKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Cancelled payment',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '409': {
            description: 'Invalid state for cancellation',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
};

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    mode: 'static',
    specification: { document: spec as unknown as OpenAPIV3.Document },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });

  // @fastify/swagger in static mode loads the document for swagger-ui but
  // does NOT expose it as a route. We expose the same spec at the
  // conventional /openapi.json path explicitly.
  app.get('/openapi.json', async () => spec);
}
