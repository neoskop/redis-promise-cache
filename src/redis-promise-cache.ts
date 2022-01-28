import RedisClient, { Redis, RedisOptions } from 'ioredis';
import { concat, from, Observable, of } from 'rxjs';
import { filter, first, map, share, switchMap } from 'rxjs/operators';

const PROMISE_VALUE = '<!-PROMISE_VALUE-!>';

export interface JsonObject {
    [key: string]: Json;
}
export interface JsonArray extends Array<Json> { }
export type Json = JsonObject | JsonArray | string | number | boolean | null;

export class PublishEvent {
    constructor(public readonly key: string,
        public readonly value: string) { }
}

export class RedisEvent {
    constructor(public readonly type: string,
        public readonly key: string) { }
}

export interface RedisPromiseCacheOptions {
    resourceTag: string;
    ttl?: number;
}

const REDIS_KEYEVENT_REGEXP = /^__keyevent@(\d+)__:(.+)$/;

export class RedisPromiseCache<R = Json> {
    client: Redis;
    subscriber: Redis;

    events: Observable<RedisEvent> = new Observable<RedisEvent>(sub => {
        this.subscriber.psubscribe(`__keyevent@${this.clientOptions?.db || 0}__:*`)
            .then(
                () => {
                    this.subscriber.on('pmessage', (_, event, key) => {
                        const type = REDIS_KEYEVENT_REGEXP.exec(event)![2];
                        sub.next(new RedisEvent(type, key));
                    })
                },
                err => {
                    sub.error(err);
                }
            );
    }).pipe(share());

    constructor(protected readonly options: RedisPromiseCacheOptions,
        protected readonly clientOptions?: RedisOptions) {
        this.client = new RedisClient(clientOptions);
        this.client.config('SET', 'notify-keyspace-events', 'g$Ex');
        this.subscriber = new RedisClient(clientOptions);
        this.events.subscribe();
    }

    protected getKey(key: string) {
        return `urn:${this.options.resourceTag}:${key}`;
    }

    async get<T extends R = R>(key: string): Promise<T | null> {
        key = this.getKey(key);

        return concat(of(null), this.events.pipe(
            filter(e => e.key === key && ['set', 'del', 'expire'].includes(e.type))
        )).pipe(
            switchMap(() => from(this._get(key))),
            first(res => res !== PROMISE_VALUE),
            map(res => !res ? null : JSON.parse(res) as T)
        ).toPromise();
    }

    async set(key: string, value: R | Promise<R>, { timeout = 10, ttl = this.options.ttl }: { timeout?: number, ttl?: number } = {}): Promise<void> {
        key = this.getKey(key);
        if (isPromise(value)) {
            await this._set(key, PROMISE_VALUE, { ttl: timeout });
            (async () => {
                try {
                    const strValue = JSON.stringify(await value);
                    await this._set(key, strValue, { ttl });
                } catch {
                    await this.del(key);
                }
            })()
        } else {
            await this._set(key, JSON.stringify(value), { ttl });
        }
    }

    protected _get(key: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            this.client.get(key, (err: Error | null, res: string | null) => {
                /* istanbul ignore if */
                if (err) {
                    return reject(err);
                }
                resolve(res || null)
            })
        });
    }

    protected _set(key: string, value: string, { ttl }: { ttl?: number }): Promise<void> {
        return new Promise((resolve, reject) => {
            const cb = (err: Error | null) => {
                /* istanbul ignore if */
                if (err) {
                    return reject(err);
                }
                resolve();
            };
            if (ttl) {
                this.client.set(key, value, 'EX', ttl, cb);
            } else {
                this.client.set(key, value, cb)
            }
        })
    }

    async del(key: string) {
        await this.client.del(key);
    }

    async flush() {
        const pipeline = this.client.pipeline();
        for (const key of await this.keys()) {
            pipeline.del(key);
        }

        return pipeline.exec();
    }

    keys() {
        return this.client.keys(this.getKey('*'));
    }

    async values(): Promise<(Json | null)[]> {
        const pipeline = this.client.pipeline();
        for (const key of await this.keys()) {
            pipeline.get(key);
        }

        const result = await pipeline.exec();

        return result.map(([err, result]: [any, string]) => {
            /* istanbul ignore if */
            if (err) {
                throw err;
            }
            if (result === PROMISE_VALUE) {
                return null;
            } else {
                return JSON.parse(result);
            }
        })
    }

    async entries(): Promise<[string, Json | null][]> {
        const pipeline = this.client.pipeline();
        const keys = await this.keys();
        for (const key of keys) {
            pipeline.get(key);
        }

        const result = await pipeline.exec();

        const length = this.getKey('').length;

        return result.map(([err, result]: [any, string], index: number) => {
            /* istanbul ignore if */
            if (err) {
                throw err;
            }
            if (result === PROMISE_VALUE) {
                return [keys[index].substr(length), null];
            } else {
                return [keys[index].substr(length), JSON.parse(result)];
            }
        })
    }

    async getResource<T extends R = R>(id: string, resolver: () => T | Promise<T>, options: { noCache?: boolean } = {}): Promise<T> {
        if (!options.noCache) {
            const cached = await this.get<T>(id);
            if (cached) {
                return cached;
            }
        }

        const promise = resolver();
        this.set(id, promise);
        return promise;
    }
}

function isPromise(v: any): v is Promise<any> {
    return v && v.then && v.catch;
}
