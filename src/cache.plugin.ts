import {
  ApolloServerPlugin,
  BaseContext,
  GraphQLRequestListener,
  GraphQLResponse,
} from '@apollo/server'
import { Redis, type RedisOptions } from 'ioredis'
import { CachePluginOptions } from './types'
import { getCacheKey, response } from './utils'
import CacheService from './cache.service'

export class ApolloCachePlugin implements ApolloServerPlugin<BaseContext> {
  private redis: Redis
  private cacheService: CacheService

  constructor(private options: CachePluginOptions) {
    this.redis = new Redis({
      host: options?.redis?.host || process.env.REDIS_HOST,
      port:
        options?.redis?.port ||
        (process.env.REDIS_PORT ? Number.parseInt(process.env.REDIS_PORT) : 6379),
      username: options?.redis?.username || process.env.REDIS_USERNAME,
      password: options?.redis?.password || process.env.REDIS_PASSWORD,
      connectTimeout: options?.redis?.connectTimeout || 20000,
    } as RedisOptions)

    this.cacheService = new CacheService(options, this.redis)
  }

  /** @description request reached the graphql server */
  async requestDidStart(): Promise<void | GraphQLRequestListener<BaseContext>> {
    return {
      /**
       * @description Executed before resolver execution. Returning null will trigger associated resolver.
       * @returns {null|GraphQLResponse} null will trigger associated resolver execution, GraphQLResponse will override default resolver.
       */
      responseForOperation: async (ctx): Promise<GraphQLResponse | null> => {
        /* Skip request if not eligible to be cached. */
        if (
          !this.cacheService.isCacheable(ctx) ||
          /* Force response computation on cache-control: must-revalidate. */
          ctx.request?.http?.headers.get('cache-control') === 'must-revalidate'
        ) {
          return null
        }

        const key: string = getCacheKey(ctx)
        const cachedData = await this.redis.get(key)

        console.info(`[apollo-cache]: intercept <${key}>`)

        if (!cachedData) {
          /* Set a loading state while cache is recomputing (cache timeout of 2min). */
          await this.redis.set(key, 'loading', 'EX', 120)
          return null
        }

        if (cachedData === 'loading') {
          console.info(`[apollo-cache]: polling for ongoing computation <${key}>`)

          /* Polling mechanism to wait for data */
          const delayedData = await Promise.race([
            this.cacheService.pollCacheLoad(key, 30), // Max 30s polling
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)), // Timeout fallback
          ])

          if (delayedData) console.info(`[apollo-cache]: delayed override <${key}>`)
          else console.warn(`[apollo-cache]: reached polling timeout <${key}>`)

          return delayedData ? response(JSON.parse(delayedData)) : null
        }

        /* Override response computation with cached data. */
        console.info(`[apollo-cache]: override <${key}>`)
        return response(JSON.parse(cachedData))
      },

      /** @description Executed after data computation, before returning. */
      willSendResponse: async (ctx) => {
        /* Skip cache assignment for ineligible requests. */
        if (!this.cacheService.isCacheable(ctx)) return
        const key: string = getCacheKey(ctx)

        const currentData = await this.redis.get(key)

        /* Skip cache assignment if TTL isn't expired yet and the cache-control is not 'must-revalidate'. */
        if (
          currentData &&
          currentData !== 'loading' &&
          ctx.request?.http?.headers.get('cache-control') !== 'must-revalidate'
        )
          return

        const ttl =
          this.options.entries?.find(({ filter }) =>
            typeof filter === 'string'
              ? filter === ctx.operationName
              : filter instanceof RegExp && ctx.operationName
                ? filter.test(ctx.operationName)
                : false,
          )?.ttl ||
          this.options?.ttl ||
          60 * 60 * 24

        console.info(`[apollo-cache]: caching <${key}> (${ttl}s)`)

        await this.redis.set(key, JSON.stringify(ctx.response.body), 'EX', ttl)
      },
    }
  }
}
