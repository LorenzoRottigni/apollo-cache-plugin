import { BaseContext, GraphQLRequestContext } from '@apollo/server'
import { CachePluginOptions } from './types'
import { Redis } from 'ioredis'

export default class CacheService {
  private options: CachePluginOptions
  private redis: Redis
  constructor(options: CachePluginOptions, redis: Redis) {
    this.options = options
    this.redis = redis
  }

  /**
   * @description Determine if a request is cacheable:
   * - Has a GraphQL operation name
   * - Has a GraphQL operation body
   * - It's a GraphQL query
   * - Cache whitelist has the operation name
   * - If enabled, checks if cache is disabled by HTTP header 'cache-control': 'no-cache'
   * - If enabled checks if cache is diabled by query params ?cache=false
   *
   * Note: GraphQL operation is ready at responseForOperation and willSendResponse,
   * trying to access ctx.operation at requestDidStart won't work.
   */
  public isCacheable(ctx: GraphQLRequestContext<BaseContext>): boolean {
    return (
      !!ctx.operationName &&
      !!ctx.request.query &&
      ctx.operation?.operation === 'query' &&
      (this.options?.entries || []).some(({ filter }) =>
        typeof filter === 'string'
          ? filter === ctx.operationName
          : filter instanceof RegExp && ctx.operationName
            ? filter.test(ctx.operationName)
            : false,
      ) &&
      (this.options?.enableHeader
        ? ctx.request?.http?.headers.get('cache-control') !== 'no-cache'
        : true) &&
      (this.options?.enableQuery
        ? new URLSearchParams(ctx.request.http?.search).get('cache') !== 'false'
        : true)
    )
  }

  /** @description Polls Redis every 1s for up to `maxAttempts` to retrieve a cached response */
  public async pollCacheLoad(key: string, maxAttempts: number): Promise<string | null> {
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const data = await this.redis.get(key)
      if (data && data !== 'loading') return data
    }
    return null
  }
}
