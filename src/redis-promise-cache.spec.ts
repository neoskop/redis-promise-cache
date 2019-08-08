import { RedisPromiseCache } from "./redis-promise-cache";
import RedisClient, { Redis } from "ioredis";

describe('RedisPromiseCache', () => {
    let client : Redis;
    let cache : RedisPromiseCache;

    beforeEach(async () => {
        client = new RedisClient({
            db: 15
        });
        client.flushall();
        cache = new RedisPromiseCache({ db: 15, resourceTag: 'test' });
        await sleep(100);
    });

    afterEach(async () => {
        await sleep(1000);
        client.quit();
        cache.client.quit();
        cache.subscriber.quit();
        await sleep(50);
    });

    it('should write and read value', async () => {
        await cache.set('foobar', 'baz');
        expect(await cache.get('foobar')).toBe('baz');
    });

    it('should write and read value from promise', async () => {
        await cache.set('foobar', Promise.resolve('baz'));
        expect(await cache.get('foobar')).toBe('baz');
    });

    it('should return undefined when entry not found', async () => {
        expect(await cache.get('foobar')).toBeNull();
    });

    it('should resolve delayed promise', async () => {
        const start = Date.now();
        await cache.set('foo', resolveIn('bar', 2500));

        expect(await cache.get('foo')).toBe('bar');
        expect(Date.now() - start).toBeCloseTo(2500, -2.5);
    });

    it('should resolve undefined for delayed rejected promise', async () => {
        const start = Date.now();
        await cache.set('foo', rejectIn(new Error('Foobar'), 2500));

        expect(await cache.get('foo')).toBeNull();
        expect(Date.now() - start).toBeCloseTo(2500, -2.5);
    });

    it('should return undefined after timeout', async () => {
        const start = Date.now();
        await cache.set('foo', resolveIn('bar', 1750), { timeout: 1 });

        await sleep(1000);
        expect(await cache.get('foo')).toBeNull();
        expect(Date.now() - start).toBeCloseTo(1000, -2.5);
    })
});


function sleep(ms : number) : Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    })
}

function resolveIn<T>(value : T, ms : number) : Promise<T> {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(value);
        }, ms);
    })
}

function rejectIn(err : Error, ms : number) : Promise<any> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(err);
        }, ms);
    })
}
