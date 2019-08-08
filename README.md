# @neoskop/redis-promise-cache  

[![Build](https://travis-ci.org/neoskop/redis-promise-cache.svg?branch=master)](https://travis-ci.org/neoskop/redis-promise-cache)
[![Coverage](https://coveralls.io/repos/github/neoskop/redis-promise-cache/badge.svg?branch=master)](https://coveralls.io/github/neoskop/redis-promise-cache)

Store promises and synchrone values in redis.

Prevents multiple redundant calls to the same (expensive) resource. 
See [here](https://redislabs.com/blog/caches-promises-locks/) for more details.

## Usage

```typescript
import { RedisPromiseCache } from '@neoskop/redis-promise-cache'

const cache = new RedisPromiseCache({ resourceTag: 'db' });
const db : any;

/**
 *  with helper method 
 */
async function getResource(id : string) {
    return cache.getResource(id, () => db.get(id));
}

/**
 *  with "low level" api
 */
async function getResource2(id : string) {
    const cacheEntry = cache.get(id);
    if(cacheEntry) {
        return cacheEntry;
    }

    const promise = db.get(id);
    cache.set(id, promise);

    return promise;
}
```

## Testing

Run tests with `yarn test`. See [package.json](./package.json) for additional test scripts.

## Versioning

This package follows [SemVer](https://semver.org/) and uses [@neoskop/flow-bump](https://github.com/neoskop/flow-bump) for versioning.

## License

This project is licensed under the MIT License - see the [LICENSE.md](./LICENSE.md) file for details