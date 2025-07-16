import { GraphQLResponse, GraphQLResponseBody } from '@apollo/server/dist/esm/externalTypes/graphql'
import { BaseContext, GraphQLRequestContext, HeaderMap } from '@apollo/server'

export const response = <T>(
  body: GraphQLResponseBody<T>,
  status = 200,
  headers = new HeaderMap(),
): GraphQLResponse<T> => ({
  body,
  http: { status, headers },
})

export const getLocale = (ctx: GraphQLRequestContext<BaseContext>): string | 'default' =>
  ctx.request.http?.search
    ? (new URLSearchParams(ctx.request.http.search).get('languageCode')) ||
      'default'
    : 'default'

export const getCacheKey = (ctx: GraphQLRequestContext<BaseContext>) =>
  [
    'gql',
    ctx.operationName,
    getLocale(ctx),
    (ctx.request.query || '').split('').filter((c: string) => !['', ' ', '\n', '\r'].includes(c))
      .length,
    Buffer.from(JSON.stringify(ctx.request.variables)).toString('base64'),
  ].join(':')
