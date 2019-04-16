import { aquire, Aquire } from './aquire'
import { mergeWithDefaultOptions } from './util'
import { LockingProtocol, AquireOptions } from './lockingProtocol'
import uuid from 'uuid/v4'
import * as lockingProtocol from './lockingProtocol'
import * as util from './util';
import * as eventDispatcher from './eventDispatcher';

// ----------- Hopefully all you need -----------------
export default function aquireFactory(protocol: LockingProtocol = newInMemoryLockingProtocol()): Aquire {
    const boundAquire = aquire(protocol)
    return (resouceGuid: string, lockerGuid: string = uuid(), options?: AquireOptions) =>
        boundAquire(resouceGuid, lockerGuid, mergeWithDefaultOptions(options))
}

// ----------- High-level APIs ------------------------
export { aquire } from './aquire'
export { Lock, LockState, LockHeldState } from './release'
export { aquireAll } from './lockOps'
export const protocol = lockingProtocol

// ----------- Low-level internal helpers -------------

export const events = eventDispatcher
import { newInMemoryLockingProtocol } from './inMemLocking';
export const utils = util