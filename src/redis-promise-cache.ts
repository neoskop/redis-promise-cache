import RedisClient, { Redis, RedisOptions } from 'ioredis';
import { Observable } from 'rxjs';
import { filter, first, map } from 'rxjs/operators';

const PROMISE_VALUE = '<!-PROMISE_VALUE-!>';

export interface JsonObject {
    [key: string]: Json;
}
export interface JsonArray extends Array<Json> { }
export type Json = JsonObject | JsonArray | string | number | boolean | null;

export class PublishEvent {
    constructor(public readonly key : string,
        public readonly value : string) {}
}

export interface RedisPromiseCacheOptions {
    resourceTag: string;
    ttl?: number;
}

export class RedisPromiseCache<R = Json> {
    client: Redis;
    subscriber: Redis;

    events = new Observable<PublishEvent>(sub => {
        const listener = (_: string, channel: string, message: string) => {
            sub.next(new PublishEvent(channel, message))
        };
        this.subscriber.on('pmessage', listener);
        this.subscriber.psubscribe(`notify/urn:${this.options.resourceTag}:*`);
    });

    constructor(protected readonly options: RedisPromiseCacheOptions,
        protected readonly clientOptions?: RedisOptions) {
        this.client = new RedisClient(clientOptions);
        this.subscriber = new RedisClient(clientOptions);
    }

    protected getKey(key : string) {
        return `urn:${this.options.resourceTag}:${key}`;
    }

    protected getNotificationKey(key : string) {
        return `notify/${key}`
    }

    async get<T extends R = R>(key: string): Promise<T | null> {
        key = this.getKey(key);
        const res = await this._get(key);

        if (!res) {
            return null;
        }

        if (res === PROMISE_VALUE) {
            return this.events.pipe(
                filter(e => e.key === this.getNotificationKey(key)),
                first(),
                map(e => e.value ? JSON.parse(e.value) : null)
            ).toPromise();
        }

        return JSON.parse(res) as T;
    }

    async set(key: string, value: R | Promise<R>, { timeout = 10, ttl = this.options.ttl }: { timeout?: number, ttl?: number } = {}): Promise<void> {
        key = this.getKey(key);
        if (isPromise(value)) {
            await this._set(key, PROMISE_VALUE, { ttl: timeout });
            (async () => {
                try {
                    const strValue = JSON.stringify(await value);
                    await this._set(key, strValue , { ttl });
                    await this.client.publish(this.getNotificationKey(key), strValue);
                } catch {
                    await this.del(key);
                    await this.client.publish(this.getNotificationKey(key), '');
                }
            })()
        } else {
            await this._set(key, JSON.stringify(value), { ttl });
        }
    }

    protected _get(key: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            this.client.get(key, (err: Error, res: string|null) => {
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
            const cb = (err: Error) => {
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
        for(const key of await this.client.keys(this.getKey('*'))) {
            pipeline.del(key);
        }

        return pipeline.exec();
    }

    async getResource<T extends R = R>(id : string, resolver : () => T|Promise<T>) : Promise<T> {
        const cached = await this.get<T>(id);
        if(cached) {
            return cached;
        }

        const promise = resolver();
        this.set(id, promise);
        return promise;
    }
}

function isPromise(v : any) : v is Promise<any> {
    return v && v.then && v.catch;
}
