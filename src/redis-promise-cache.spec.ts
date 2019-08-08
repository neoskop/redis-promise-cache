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
        cache = new RedisPromiseCache({ resourceTag: 'test' }, { db: 15 });
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

        await sleep(1050);
        expect(await cache.get('foo')).toBeNull();
        expect(Date.now() - start).toBeCloseTo(1050, -2.5);
    });

    it('should expire after given ttl', async () => {
        await cache.set('foo', 'bar', { ttl: 3 });

        await sleep(3050);
        expect(await cache.get('foo')).toBeNull();
    })

    describe('getResource()', () => {
        it('should resole with synchrone value', async () => {
            expect(await cache.getResource('test', () => 'foobar')).toBe('foobar');
        })
        it('should resole with asynchrone value', async () => {
            expect(await cache.getResource('test2', () => resolveIn('foobar2', 500))).toBe('foobar2');
        })
        it('should resole with delayed value and not call second resolver', async () => {
            const fn = jest.fn();
            cache.getResource('test3', () => resolveIn('foobar3', 500));
            await sleep(10);
            expect(await cache.getResource('test3', fn)).toBe('foobar3');
            expect(fn).not.toHaveBeenCalled();
        })
    })

    describe('flush()', () => {
        it('should delete all entries for this cache', async () => {
            const cache2 = new RedisPromiseCache({ resourceTag: 'test2' }, { db: 15 });
            await cache.set('test', 'foo');
            await cache2.set('test', 'bar');

            expect(await cache.get('test')).toBe('foo');
            expect(await cache2.get('test')).toBe('bar');

            await cache.flush();

            expect(await cache.get('test')).toBeNull();
            expect(await cache2.get('test')).toBe('bar');

            cache2.client.quit();
            cache2.subscriber.quit();
        })
    });

    describe('values()', () => {
        it('should return all values', async () => {
            await cache.set('foo', 1);
            await cache.set('bar', 2);
            await cache.set('baz', 3);
            await cache.set('foobar', resolveIn(4, 1000));

            expect((await cache.values()).sort()).toEqual([ 1, 2, 3, null ].sort());
        })
    });

    describe('entries()', () => {
        it('should return all values', async () => {
            await cache.set('foo', 1);
            await cache.set('bar', 2);
            await cache.set('baz', 3);
            await cache.set('foobar', resolveIn(4, 1000));

            expect((await cache.entries()).sort()).toEqual([ [ 'foo', 1], [ 'bar', 2 ], [ 'baz', 3 ], [ 'foobar', null] ].sort());
        })
    });
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
