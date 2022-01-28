import { RedisPromiseCache } from "./redis-promise-cache";
import RedisClient, { Redis } from "ioredis";

jest.setTimeout(11000);

describe('RedisPromiseCache', () => {
    let client: Redis;
    let cache: RedisPromiseCache;

    beforeEach(async () => {
        client = new RedisClient({
            db: 15
        });
        await client.flushall();
        cache = new RedisPromiseCache({ resourceTag: 'test' }, { db: 15 });
        await sleep(100);
    });

    afterEach(async () => {
        await sleep(1000);
        try {
            await client.quit();
            await cache.client.quit();
            await cache.subscriber.quit();
        } catch { }
        await sleep(50);
    });

    it('should write and read value', async () => {
        await cache.set('foobar', 'baz');
        expect(await cache.get('foobar')).toBe('baz');
    });

    it('should write and read value from promise', async () => {
        await cache.set('foobar2', Promise.resolve('baz'));
        expect(await cache.get('foobar2')).toBe('baz');
    });

    it('should return null when entry not found', async () => {
        expect(await cache.get('foobar3')).toBeNull();
    });

    it('should resolve delayed promise', async () => {
        const start = Date.now();
        await cache.set('foo1', resolveIn('bar', 2500));

        expect(await cache.get('foo1')).toBe('bar');
        expect(Date.now() - start).toBeCloseTo(2500, -2.5);
    });

    it('should resolve null for delayed rejected promise', async () => {
        const start = Date.now();
        await cache.set('foo2', rejectIn(new Error('Foobar'), 2500));

        expect(await cache.get('foo2')).toBeNull();
        expect(Date.now() - start).toBeCloseTo(2500, -2.5);
    });

    it('should return null after timeout', async () => {
        const start = Date.now();
        await cache.set('foo3', resolveIn('bar', 1750), { timeout: 1 });

        await sleep(1050);
        expect(await cache.get('foo3')).toBeNull();
        expect(Date.now() - start).toBeCloseTo(1050, -2.5);
    });

    it('should expire after given ttl', async () => {
        await cache.set('foo4', 'bar', { ttl: 3 });

        await sleep(3050);
        expect(await cache.get('foo4')).toBeNull();
    })

    it('should delete an entry', async () => {
        await cache.set('foo5', 'bar');

        await cache.del('foo5');
        expect(await cache.get('foo5')).toBeNull();
    })

    describe('getResource()', () => {
        it('should resolve with synchrone value', async () => {
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
            await cache.set('test4', 'foo');
            await cache2.set('test4', 'bar');

            expect(await cache.get('test4')).toBe('foo');
            expect(await cache2.get('test4')).toBe('bar');

            await cache.flush();

            expect(await cache.get('test4')).toBeNull();
            expect(await cache2.get('test4')).toBe('bar');

            cache2.client.quit();
            cache2.subscriber.quit();
        })
    });

    describe('values()', () => {
        it('should return all values', async () => {
            await cache.set('fooA', 1);
            await cache.set('barA', 2);
            await cache.set('bazA', 3);
            await cache.set('foobarA', resolveIn(4, 1000));

            expect((await cache.values()).sort()).toEqual([1, 2, 3, null].sort());
        })
    });

    describe('entries()', () => {
        it('should return all values', async () => {
            await cache.set('fooB', 1);
            await cache.set('barB', 2);
            await cache.set('bazB', 3);
            await cache.set('foobarB', resolveIn(4, 1000));

            expect((await cache.entries()).sort()).toEqual([['fooB', 1], ['barB', 2], ['bazB', 3], ['foobarB', null]].sort());
        })
    });
});


function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    })
}

function resolveIn<T>(value: T, ms: number): Promise<T> {
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
