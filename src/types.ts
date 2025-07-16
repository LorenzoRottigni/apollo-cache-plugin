import { RedisOptions } from 'ioredis'

export declare interface CacheEntry {
  filter: string | RegExp
  ttl?: number
}

export declare interface CachePluginOptions {
  entries?: CacheEntry[]
  ttl?: number
  enableQuery?: boolean
  enableHeader?: boolean
  redis?: Partial<RedisOptions>
}
